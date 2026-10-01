import "server-only";
import { db } from "@/db";
import {
  appareils,
  documentsFormations,
  habilitationsCatalogue,
  habilitationsTechnicien,
  interventions,
  projets,
  users,
} from "@/db/schema";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";

// ==========================================================================
// Phase 19 — Habilitations : statuts, exigences par mission, contrôle à
// l'affectation (ISO 9001 §7.2 Compétences + sécurité).
// ==========================================================================

export const CATEGORIES_HABILITATION: Record<string, string> = {
  electrique: "Électrique",
  hauteur: "Travail en hauteur",
  secourisme: "Secourisme",
  securite: "Sécurité chantier",
  constructeur: "Constructeur",
  interne: "Interne ROBUS",
};

/** Types de mission pour lesquels une habilitation peut être exigée. */
export const EXIGENCES_MISSION: Record<string, string> = {
  toutes: "Toutes les missions",
  preventive: "Maintenance préventive",
  corrective: "Dépannage / corrective",
  systematique: "Contrôle systématique",
  installation: "Projets d'installation",
  modernisation: "Projets de modernisation",
};

export type StatutHab = "valide" | "bientot" | "expiree" | "sans_certificat" | "en_attente" | "absente";

export const STATUT_HAB: Record<StatutHab, { label: string; tone: "ok" | "warn" | "crit" | "neutral"; pastille: string }> = {
  valide: { label: "Valide", tone: "ok", pastille: "🟢" },
  bientot: { label: "Expire bientôt", tone: "warn", pastille: "🟠" },
  expiree: { label: "Expirée", tone: "crit", pastille: "🔴" },
  sans_certificat: { label: "Certificat manquant", tone: "neutral", pastille: "⚪" },
  en_attente: { label: "En attente de validation", tone: "neutral", pastille: "⏳" },
  absente: { label: "Absente", tone: "neutral", pastille: "—" },
};

export function statutHabilitation(
  h: { statut: string; dateExpiration: Date | null; certificatUrl: string | null },
  cat: { alerteJours: number; certificatObligatoire: number } | null,
  maintenant = Date.now()
): StatutHab {
  if (h.statut === "en_attente") return "en_attente";
  if (h.dateExpiration && h.dateExpiration.getTime() <= maintenant) return "expiree";
  if (cat?.certificatObligatoire && !h.certificatUrl) return "sans_certificat";
  if (h.dateExpiration && h.dateExpiration.getTime() <= maintenant + (cat?.alerteJours ?? 60) * 86400000) return "bientot";
  return "valide";
}

/** Une habilitation « en règle » autorise la mission (valide ou expire bientôt). */
export function estEnRegle(s: StatutHab) {
  return s === "valide" || s === "bientot";
}

export function calculerExpiration(dateObtention: Date, validiteMois: number | null) {
  if (!validiteMois) return null;
  const d = new Date(dateObtention);
  d.setMonth(d.getMonth() + validiteMois);
  return d;
}

/** Habilitations en cours (hors remplacées / refusées) de un ou plusieurs techniciens. */
export async function habilitationsCourantes(technicienIds?: string[]) {
  if (technicienIds && !technicienIds.length) return [];
  const rows = await db
    .select({
      id: habilitationsTechnicien.id,
      technicienId: habilitationsTechnicien.technicienId,
      catalogueId: habilitationsTechnicien.catalogueId,
      statut: habilitationsTechnicien.statut,
      dateObtention: habilitationsTechnicien.dateObtention,
      dateExpiration: habilitationsTechnicien.dateExpiration,
      organisme: habilitationsTechnicien.organisme,
      numeroCertificat: habilitationsTechnicien.numeroCertificat,
      certificatUrl: habilitationsTechnicien.certificatUrl,
      commentaire: habilitationsTechnicien.commentaire,
      createdAt: habilitationsTechnicien.createdAt,
      nomCatalogue: habilitationsCatalogue.nom,
      categorie: habilitationsCatalogue.categorie,
      alerteJours: habilitationsCatalogue.alerteJours,
      certificatObligatoire: habilitationsCatalogue.certificatObligatoire,
      nomDocument: documentsFormations.titre,
    })
    .from(habilitationsTechnicien)
    .leftJoin(habilitationsCatalogue, eq(habilitationsTechnicien.catalogueId, habilitationsCatalogue.id))
    .leftJoin(documentsFormations, eq(habilitationsTechnicien.documentId, documentsFormations.id))
    .where(
      and(
        notInArray(habilitationsTechnicien.statut, ["remplacee", "refusee", "retiree"]),
        technicienIds ? inArray(habilitationsTechnicien.technicienId, technicienIds) : undefined
      )
    )
    .orderBy(asc(habilitationsCatalogue.nom));
  const maintenant = Date.now();
  return rows.map((r) => {
    const cat = r.catalogueId ? { alerteJours: r.alerteJours ?? 60, certificatObligatoire: r.certificatObligatoire ?? 0 } : null;
    return { ...r, nom: r.nomCatalogue ?? r.nomDocument ?? "Habilitation", etat: statutHabilitation(r, cat, maintenant) };
  });
}

/** Habilitations obligatoires pour une mission donnée. */
export function exigencesPour(
  catalogue: { id: string; nom: string; obligatoire: number; typesMission: string[]; marques: string[]; actif: number }[],
  m: { type: string; typeProjet: string | null; marque: string | null }
) {
  return catalogue.filter((c) => {
    if (!c.actif || !c.obligatoire) return false;
    const t = c.typesMission;
    const typeOk = t.includes("toutes") || t.includes(m.type) || (!!m.typeProjet && t.includes(m.typeProjet));
    if (!typeOk) return false;
    if (c.marques.length === 0) return true;
    return !!m.marque && c.marques.some((x) => x.trim().toLowerCase() === m.marque!.trim().toLowerCase());
  });
}

export type Manque = { mission: string; habilitation: string; raison: string };

/**
 * Contrôle de sécurité à l'affectation : renvoie les habilitations
 * obligatoires manquantes, expirées ou non validées pour ces missions.
 * Liste vide = le technicien peut recevoir les missions.
 */
export async function controlerHabilitations(technicienId: string, interventionIds: string[]): Promise<Manque[]> {
  if (!interventionIds.length) return [];
  const missions = await db
    .select({ type: interventions.type, numero: appareils.numeroInterne, marque: appareils.marque, typeProjet: projets.typeProjet })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .where(inArray(interventions.id, interventionIds));
  return controlerHabilitationsSpecs(technicienId, missions);
}

/** Même contrôle pour une mission pas encore enregistrée (création). */
export async function controlerHabilitationsSpecs(
  technicienId: string,
  missions: { type: string; numero: string; marque: string | null; typeProjet: string | null }[]
): Promise<Manque[]> {
  if (!missions.length) return [];
  const [catalogue, habs] = await Promise.all([
    db.select().from(habilitationsCatalogue).where(and(eq(habilitationsCatalogue.actif, 1), eq(habilitationsCatalogue.obligatoire, 1))),
    habilitationsCourantes([technicienId]),
  ]);
  const manques: Manque[] = [];
  for (const m of missions) {
    for (const c of exigencesPour(catalogue, { type: m.type, typeProjet: m.typeProjet ?? null, marque: m.marque })) {
      const h = habs.filter((x) => x.catalogueId === c.id).sort((a, b) => b.dateObtention.getTime() - a.dateObtention.getTime())[0];
      if (!h) manques.push({ mission: m.numero, habilitation: c.nom, raison: "absente" });
      else if (!estEnRegle(h.etat)) manques.push({ mission: m.numero, habilitation: c.nom, raison: STATUT_HAB[h.etat].label.toLowerCase() });
    }
  }
  return manques;
}

export async function nomUtilisateur(id: string) {
  const [u] = await db.select({ nom: users.nom }).from(users).where(eq(users.id, id)).limit(1);
  return u?.nom ?? "Ce technicien";
}

export function messageManques(nomTechnicien: string, manques: Manque[]) {
  const uniques = [...new Map(manques.map((m) => [`${m.habilitation}|${m.raison}`, m])).values()];
  return `${nomTechnicien} ne peut pas recevoir cette mission : ${uniques
    .map((m) => `${m.habilitation} (${m.raison})`)
    .join(", ")}. Mettez à jour ses habilitations (fiche technicien) ou choisissez un autre technicien.`;
}
