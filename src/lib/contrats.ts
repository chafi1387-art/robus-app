import "server-only";
import { db } from "@/db";
import { appareils, clients, prestationAppareils, prestations, prestationsCatalogue, projets } from "@/db/schema";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { genererPassagesContrat } from "@/lib/garantie-passages";

// ==========================================================================
// Phase 24 — Prestations « contrat à passages ».
// Le catalogue fixe la durée, le nombre de passages, le type de mission, la
// checklist et le délai de création ; ajoutée à un projet, la prestation en
// garde une copie figée et reçoit son échéancier (par appareil).
// ==========================================================================

export const JOURS_ALERTE_FIN_CONTRAT = 60;

type Catalogue = typeof prestationsCatalogue.$inferSelect;

export function finDeContrat(debut: Date, dureeMois: number) {
  const fin = new Date(debut);
  fin.setMonth(fin.getMonth() + dureeMois);
  return fin;
}

/** Crée le contrat sur le projet, rattache les appareils et génère les passages. */
export async function creerContratProjet(params: {
  projetId: string;
  catalogue: Catalogue;
  dateDebut: Date;
  appareilIds: string[];
  titre?: string | null;
  prixEstime?: string | null;
}) {
  const c = params.catalogue;
  if (c.mode !== "contrat" || !c.dureeMois || !c.nbPassages) throw new Error("Cette prestation n'est pas un contrat à passages.");
  const debut = new Date(params.dateDebut);
  debut.setHours(8, 0, 0, 0);
  const [p] = await db
    .insert(prestations)
    .values({
      projetId: params.projetId,
      catalogueId: c.id,
      description: params.titre?.trim() || c.nom,
      prixEstime: params.prixEstime ?? c.prixIndicatif,
      mode: "contrat",
      dateDebut: debut,
      dateFin: finDeContrat(debut, c.dureeMois),
      nbPassages: c.nbPassages,
      typeMission: c.typeMission ?? "preventive",
      anticipationJours: c.anticipationJours,
      checklistModeleId: c.checklistModeleId,
      statutContrat: "actif",
    })
    .returning();
  const ids = [...new Set(params.appareilIds)];
  if (ids.length) await db.insert(prestationAppareils).values(ids.map((appareilId) => ({ prestationId: p.id, appareilId }))).onConflictDoNothing();
  await genererPassagesContrat(p.id);
  return p;
}

/** Ajoute un appareil à un contrat existant (et crée ses passages). */
export async function ajouterAppareilAuContrat(prestationId: string, appareilId: string) {
  await db.insert(prestationAppareils).values({ prestationId, appareilId }).onConflictDoNothing();
  return genererPassagesContrat(prestationId, appareilId);
}

/** Contrats d'un projet avec leurs appareils. */
export async function contratsDuProjet(projetId: string) {
  const liste = await db
    .select()
    .from(prestations)
    .where(and(eq(prestations.projetId, projetId), eq(prestations.mode, "contrat")))
    .orderBy(asc(prestations.dateDebut));
  if (!liste.length) return [];
  const apps = await db
    .select({ prestationId: prestationAppareils.prestationId, appareilId: appareils.id, numero: appareils.numeroInterne })
    .from(prestationAppareils)
    .innerJoin(appareils, eq(prestationAppareils.appareilId, appareils.id))
    .where(inArray(prestationAppareils.prestationId, liste.map((p) => p.id)))
    .orderBy(asc(appareils.numeroInterne));
  return liste.map((p) => ({ ...p, appareils: apps.filter((a) => a.prestationId === p.id) }));
}

/** Contrats qui couvrent un appareil (fiche appareil, observateur, technicien). */
export async function contratsDeLAppareil(appareilId: string) {
  return db
    .select({
      id: prestations.id,
      titre: prestations.description,
      dateDebut: prestations.dateDebut,
      dateFin: prestations.dateFin,
      nbPassages: prestations.nbPassages,
      statutContrat: prestations.statutContrat,
      projetId: projets.id,
      projetRef: projets.reference,
    })
    .from(prestationAppareils)
    .innerJoin(prestations, eq(prestationAppareils.prestationId, prestations.id))
    .innerJoin(projets, eq(prestations.projetId, projets.id))
    .where(eq(prestationAppareils.appareilId, appareilId))
    .orderBy(asc(prestations.dateDebut));
}

export type EtatContrat = "actif" | "fin_proche" | "termine" | "renouvele" | "a_venir";

export function etatContrat(c: { dateDebut: Date | null; dateFin: Date | null; statutContrat: string | null }, maintenant = Date.now()): EtatContrat {
  if (c.statutContrat === "renouvele") return "renouvele";
  if (c.dateDebut && c.dateDebut.getTime() > maintenant) return "a_venir";
  if (c.dateFin && c.dateFin.getTime() < maintenant) return "termine";
  if (c.dateFin && c.dateFin.getTime() - maintenant <= JOURS_ALERTE_FIN_CONTRAT * 86400000) return "fin_proche";
  return "actif";
}

export const ETAT_CONTRAT: Record<EtatContrat, { label: string; tone: "ok" | "warn" | "crit" | "neutral" }> = {
  actif: { label: "En cours", tone: "ok" },
  a_venir: { label: "Commence bientôt", tone: "neutral" },
  fin_proche: { label: "Se termine bientôt", tone: "warn" },
  termine: { label: "Terminé — à renouveler ?", tone: "crit" },
  renouvele: { label: "Renouvelé", tone: "neutral" },
};

/** Contrats à renouveler : se terminent dans 60 jours (ou déjà terminés), pas encore renouvelés. */
export async function contratsARenouveler() {
  const limite = new Date(Date.now() + JOURS_ALERTE_FIN_CONTRAT * 86400000);
  return db
    .select({
      id: prestations.id,
      titre: prestations.description,
      dateFin: prestations.dateFin,
      projetId: projets.id,
      projetRef: projets.reference,
      client: clients.raisonSociale,
    })
    .from(prestations)
    .innerJoin(projets, eq(prestations.projetId, projets.id))
    .innerJoin(clients, eq(projets.clientId, clients.id))
    .where(
      and(
        eq(prestations.mode, "contrat"),
        eq(prestations.statutContrat, "actif"),
        isNull(prestations.renouveleeParId),
        lte(prestations.dateFin, limite),
        // On n'insiste plus 6 mois après la fin.
        sql`${prestations.dateFin} > now() - interval '180 days'`
      )
    )
    .orderBy(asc(prestations.dateFin));
}

/** Renouvelle un contrat pour la même durée, sur les mêmes appareils, à partir de sa date de fin. */
export async function renouvelerContrat(prestationId: string) {
  const [ancien] = await db.select().from(prestations).where(eq(prestations.id, prestationId)).limit(1);
  if (!ancien || ancien.mode !== "contrat" || !ancien.dateDebut || !ancien.dateFin || !ancien.nbPassages) throw new Error("Contrat introuvable.");
  if (ancien.renouveleeParId || ancien.statutContrat === "renouvele") throw new Error("Ce contrat a déjà été renouvelé.");
  const apps = await db.select({ appareilId: prestationAppareils.appareilId }).from(prestationAppareils).where(eq(prestationAppareils.prestationId, prestationId));
  // Même durée que le contrat d'origine (en mois, arrondie).
  const dureeMois = Math.max(1, Math.round((ancien.dateFin.getTime() - ancien.dateDebut.getTime()) / (30.4375 * 86400000)));
  const debut = new Date(ancien.dateFin);
  const [nouveau] = await db
    .insert(prestations)
    .values({
      projetId: ancien.projetId,
      catalogueId: ancien.catalogueId,
      description: ancien.description,
      prixEstime: ancien.prixEstime,
      mode: "contrat",
      dateDebut: debut,
      dateFin: finDeContrat(debut, dureeMois),
      nbPassages: ancien.nbPassages,
      typeMission: ancien.typeMission,
      anticipationJours: ancien.anticipationJours,
      checklistModeleId: ancien.checklistModeleId,
      statutContrat: "actif",
    })
    .returning();
  if (apps.length) await db.insert(prestationAppareils).values(apps.map((a) => ({ prestationId: nouveau.id, appareilId: a.appareilId })));
  await genererPassagesContrat(nouveau.id);
  await db.update(prestations).set({ statutContrat: "renouvele", renouveleeParId: nouveau.id }).where(eq(prestations.id, prestationId));
  return { ancien, nouveau, dureeMois };
}
