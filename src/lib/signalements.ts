import "server-only";
import { after } from "next/server";
import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { appareils, interventions, projets, signalements, users, type FichierJoint } from "@/db/schema";
import { journaliser } from "@/lib/journal";
import { notifierBureau, notifierUtilisateurs } from "@/lib/push";
import { envoyerAlerteDemande } from "@/lib/mail";
import { destinatairesAlertes } from "@/lib/demandes";
import { GRAVITES_SIGNALEMENT, TYPES_SIGNALEMENT, graviteSignalement } from "@/lib/signalements-types";

// Phase 21 : signalements du technicien (accident, véhicule, météo…).
// Création, numérotation SG-AAAA-NNNN, alertes au bureau (notification +
// email), réponses du bureau au technicien.

const base = () => process.env.NEXTAUTH_URL || "https://robuswork.tech";
const fmt = (d: Date) => d.toLocaleString("fr-BE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short" });

async function prochainNumero() {
  const annee = new Date().getFullYear();
  const [dernier] = await db
    .select({ numero: signalements.numero })
    .from(signalements)
    .where(like(signalements.numero, `SG-${annee}-%`))
    .orderBy(desc(signalements.numero))
    .limit(1);
  const n = dernier ? Number(dernier.numero.split("-")[2]) || 0 : 0;
  return `SG-${annee}-${String(n + 1).padStart(4, "0")}`;
}

export type NouveauSignalement = {
  technicienId: string;
  technicienNom: string;
  type: string;
  description: string;
  lieu?: string | null;
  blesse: boolean;
  bloquant: boolean;
  interventionId?: string | null;
  photos: string[];
  fichiers: FichierJoint[];
};

export async function creerSignalement(p: NouveauSignalement) {
  // Mission liée : on retrouve le projet et l'appareil (et on vérifie qu'elle
  // appartient bien au technicien).
  let projetId: string | null = null;
  let appareilId: string | null = null;
  let contexte: { numero: string | null; projetRef: string | null; client: string | null } = { numero: null, projetRef: null, client: null };
  if (p.interventionId) {
    const [m] = await db
      .select({ technicienId: interventions.technicienId, projetId: interventions.projetId, appareilId: interventions.appareilId, numero: appareils.numeroInterne, projetRef: projets.reference, projetTitre: projets.titre })
      .from(interventions)
      .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
      .leftJoin(projets, eq(interventions.projetId, projets.id))
      .where(eq(interventions.id, p.interventionId))
      .limit(1);
    if (!m || m.technicienId !== p.technicienId) throw new Error("Mission introuvable.");
    projetId = m.projetId;
    appareilId = m.appareilId;
    contexte = { numero: m.numero, projetRef: m.projetRef, client: m.projetTitre };
  }
  const gravite = graviteSignalement(p.type, p.blesse, p.bloquant);
  let id = "";
  let numero = "";
  for (let essai = 0; essai < 4 && !id; essai++) {
    numero = await prochainNumero();
    try {
      const [row] = await db
        .insert(signalements)
        .values({
          numero,
          technicienId: p.technicienId,
          type: p.type,
          description: p.description,
          lieu: p.lieu || null,
          blesse: p.blesse ? 1 : 0,
          bloquant: p.bloquant ? 1 : 0,
          gravite,
          photos: p.photos,
          fichiers: p.fichiers,
          interventionId: p.interventionId || null,
          projetId,
          appareilId,
        })
        .returning({ id: signalements.id });
      id = row.id;
    } catch (e) {
      if (!String((e as Error).message).includes("signalements_numero_idx") && !String((e as { code?: string }).code).includes("23505")) throw e;
    }
  }
  if (!id) throw new Error("Signalement non enregistré, réessayez.");

  const t = TYPES_SIGNALEMENT[p.type];
  await journaliser({ entite: "signalement", entiteId: id, action: "cree", utilisateurId: p.technicienId, details: `${numero} — ${t?.label ?? p.type}${p.blesse ? " — blessé" : ""}` });

  const urgent = gravite === "critique";
  const titre = `${urgent ? "🚨 URGENT — " : "⚠️ "}${t?.label ?? "Signalement"} — ${p.technicienNom}`;
  const lien = `${base()}/responsable/signalements/${id}`;
  after(async () => {
    try {
      await notifierBureau({
        titre,
        corps: `${numero}${p.blesse ? " · personne blessée" : ""}${p.bloquant ? " · bloquant" : ""}${contexte.numero ? ` · ${contexte.numero}` : ""} — ${p.description.slice(0, 120)}`,
        url: `/responsable/signalements/${id}`,
        tag: `signalement-${id}`,
      });
      const lignes: [string, string][] = [
        ["Numéro", numero],
        ["Type", t?.label ?? p.type],
        ["Gravité", GRAVITES_SIGNALEMENT[gravite]?.label ?? gravite],
        ["Technicien", p.technicienNom],
        ["Date", fmt(new Date())],
      ];
      if (p.blesse) lignes.push(["Blessé", "OUI"]);
      if (p.bloquant) lignes.push(["Bloquant", t?.questionBloquant ?? "Oui"]);
      if (p.lieu) lignes.push(["Lieu", p.lieu]);
      if (contexte.numero) lignes.push(["Mission", `${contexte.numero}${contexte.projetRef ? ` · projet ${contexte.projetRef}` : ""}`]);
      if (p.photos.length || p.fichiers.length) lignes.push(["Pièces jointes", `${p.photos.length} photo(s), ${p.fichiers.length} document(s)`]);
      await envoyerAlerteDemande({
        destinataires: await destinatairesAlertes(),
        sujet: `${urgent ? "URGENT — " : ""}Signalement ${numero} : ${t?.label ?? p.type} (${p.technicienNom})`,
        lignes,
        description: p.description,
        lien,
        urgence: urgent,
        bouton: "Ouvrir le signalement",
      });
    } catch (e) {
      console.error("Alerte signalement", e);
    }
  });
  return { id, numero, gravite };
}

/** Le bureau prend en charge / répond / clôture : le technicien est prévenu. */
export async function notifierTechnicienSignalement(id: string, titre: string, corps: string) {
  const [s] = await db.select({ technicienId: signalements.technicienId }).from(signalements).where(eq(signalements.id, id)).limit(1);
  if (!s) return;
  after(() => notifierUtilisateurs([s.technicienId], { titre, corps, url: `/technicien/signalements/${id}`, tag: `signalement-${id}` }));
}

/** Liste pour une fiche (technicien, projet, mission). */
export async function signalementsDe(filtre: { technicienId?: string; projetId?: string; interventionId?: string }, limite = 50) {
  const cond = filtre.technicienId
    ? eq(signalements.technicienId, filtre.technicienId)
    : filtre.projetId
      ? eq(signalements.projetId, filtre.projetId)
      : filtre.interventionId
        ? eq(signalements.interventionId, filtre.interventionId)
        : undefined;
  if (!cond) return [];
  return db
    .select({
      id: signalements.id,
      numero: signalements.numero,
      type: signalements.type,
      gravite: signalements.gravite,
      statut: signalements.statut,
      description: signalements.description,
      blesse: signalements.blesse,
      bloquant: signalements.bloquant,
      createdAt: signalements.createdAt,
      technicien: users.nom,
      appareil: appareils.numeroInterne,
      interventionId: signalements.interventionId,
    })
    .from(signalements)
    .innerJoin(users, eq(signalements.technicienId, users.id))
    .leftJoin(appareils, eq(signalements.appareilId, appareils.id))
    .where(and(cond))
    .orderBy(desc(signalements.createdAt))
    .limit(limite);
}
