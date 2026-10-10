import "server-only";
import { db } from "@/db";
import { appareils, garantiePassages, interventions, prestations, projets, rapports, users } from "@/db/schema";
import { NOM_PRESTATION_MISSION } from "@/lib/cible-mission";
import { and, asc, desc, eq, gte, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { DROIT_HISTO_12_MOIS, type ContexteObservateur } from "@/lib/observateur";

// Phase 18 : lectures de l'espace Observateur (toujours limitées aux
// appareils autorisés ; aucune donnée interne : prix, NC, commentaires bureau).

export const STATUTS_FINIS = ["terminee", "validee", "cloturee"] as const;

export function prenom(nom: string | null) {
  return nom ? nom.trim().split(/\s+/)[0] : null;
}

const colonnes = {
  id: interventions.id,
  appareilId: interventions.appareilId,
  type: interventions.type,
  statut: interventions.statut,
  technicienId: interventions.technicienId,
  dateProgrammee: interventions.dateProgrammee,
  dateDebut: interventions.dateDebut,
  dateFin: interventions.dateFin,
  valideeLe: interventions.valideeLe,
  createdAt: interventions.createdAt,
  numero: appareils.numeroInterne,
  technicien: users.nom,
};

export async function interventionsEnCours(appareilIds: string[]) {
  if (!appareilIds.length) return [];
  return db
    .select(colonnes)
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(users, eq(interventions.technicienId, users.id))
    .where(and(inArray(interventions.appareilId, appareilIds), notInArray(interventions.statut, [...STATUTS_FINIS])))
    .orderBy(asc(interventions.dateProgrammee));
}

export async function interventionsTerminees(ctx: ContexteObservateur, appareilIds: string[], limite = 100) {
  if (!appareilIds.length) return [];
  const debut = ctx.droits.has(DROIT_HISTO_12_MOIS) ? new Date(new Date().setFullYear(new Date().getFullYear() - 1)) : null;
  return db
    .select({ ...colonnes, rapportId: rapports.id })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(users, eq(interventions.technicienId, users.id))
    .leftJoin(rapports, eq(rapports.interventionId, interventions.id))
    .where(
      and(
        inArray(interventions.appareilId, appareilIds),
        inArray(interventions.statut, [...STATUTS_FINIS]),
        debut ? gte(interventions.dateFin, debut) : undefined
      )
    )
    .orderBy(desc(interventions.dateFin))
    .limit(limite);
}

export async function prochainesVisites(appareilIds: string[]) {
  if (!appareilIds.length) return [];
  const maintenant = new Date();
  const [missions, regles] = await Promise.all([
    db
      .select({ appareilId: interventions.appareilId, date: interventions.dateProgrammee, type: interventions.type })
      .from(interventions)
      .where(
        and(
          inArray(interventions.appareilId, appareilIds),
          notInArray(interventions.statut, [...STATUTS_FINIS, "en_cours"]),
          gte(interventions.dateProgrammee, maintenant)
        )
      ),
    // Phase 24 : passages (garantie et contrats) pas encore transformés en mission.
    db
      .select({
        appareilId: garantiePassages.appareilId,
        date: garantiePassages.datePrevue,
        type: sql<"preventive" | "corrective" | "systematique">`coalesce(${prestations.typeMission}::text, 'preventive')`,
      })
      .from(garantiePassages)
      .leftJoin(prestations, eq(garantiePassages.prestationId, prestations.id))
      .where(
        and(
          inArray(garantiePassages.appareilId, appareilIds),
          eq(garantiePassages.statut, "a_venir"),
          isNull(garantiePassages.interventionId),
          gte(garantiePassages.datePrevue, maintenant)
        )
      ),
  ]);
  return [...missions, ...regles]
    .filter((v): v is { appareilId: string; date: Date; type: "preventive" | "corrective" | "systematique" } => !!v.date)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ---------- Phase 29 : missions « à la carte » (prestation, sans appareil) ----------
// Visibles par les observateurs du client du projet (nettoyage, démolition…).

/** Missions à la carte du client : en cours et terminées (même règles de droits). */
export async function travauxDuClient(ctx: ContexteObservateur, limite = 50) {
  const voirEnCours = ctx.droits.has("temps_reel");
  const voirFinies = ctx.droits.has("historique");
  if (!voirEnCours && !voirFinies) return [];
  const debut = ctx.droits.has(DROIT_HISTO_12_MOIS) ? new Date(new Date().setFullYear(new Date().getFullYear() - 1)) : null;
  const filtreStatut = voirEnCours && voirFinies
    ? undefined
    : voirEnCours
      ? notInArray(interventions.statut, [...STATUTS_FINIS])
      : inArray(interventions.statut, [...STATUTS_FINIS]);
  return db
    .select({
      ...colonnes,
      numero: sql<string>`coalesce(${NOM_PRESTATION_MISSION}, 'Prestation')`,
      projetRef: projets.reference,
      projetTitre: projets.titre,
      rapportId: rapports.id,
    })
    .from(interventions)
    .innerJoin(projets, eq(interventions.projetId, projets.id))
    .leftJoin(users, eq(interventions.technicienId, users.id))
    .leftJoin(rapports, eq(rapports.interventionId, interventions.id))
    .where(
      and(
        isNull(interventions.appareilId),
        eq(projets.clientId, ctx.clientId),
        filtreStatut,
        debut ? or(notInArray(interventions.statut, [...STATUTS_FINIS]), gte(interventions.dateFin, debut)) : undefined
      )
    )
    .orderBy(desc(sql`coalesce(${interventions.dateFin}, ${interventions.dateProgrammee}, ${interventions.createdAt})`))
    .limit(limite);
}

/** Accès d'un observateur à une mission : appareil autorisé, ou mission à la carte de son client. */
export async function observateurPeutVoirMission(ctx: ContexteObservateur, m: { appareilId: string | null; projetId: string | null }) {
  if (m.appareilId) return ctx.appareilIds.includes(m.appareilId);
  if (!m.projetId) return false;
  const [p] = await db.select({ clientId: projets.clientId }).from(projets).where(eq(projets.id, m.projetId)).limit(1);
  return p?.clientId === ctx.clientId;
}
