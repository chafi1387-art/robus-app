import "server-only";
import { attribuerChecklists, attribuerParDefaut } from "@/lib/checklists";
import { db } from "@/db";
import {
  appareils,
  clients,
  garantiePassages,
  garanties,
  interventions,
  prestationAppareils,
  prestations,
  projetAppareils,
  projets,
  users,
} from "@/db/schema";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

// ==========================================================================
// Phase 19 — Échéancier des passages de garantie (par appareil).
// Phase 24 — même échéancier pour les prestations « contrat à passages »
// (table commune : un passage a soit garantie_id, soit prestation_id).
// N passages sur la durée : chacun au MILIEU de sa période
// (ex. 6 passages / 24 mois -> 2, 6, 10, 14, 18 et 22 mois).
// ==========================================================================

export const JOURS_BIENTOT = 30;
export const JOURS_A_PLANIFIER = 7;

export function datesPassages(dateDebut: Date, dateFin: Date, n: number) {
  const duree = dateFin.getTime() - dateDebut.getTime();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(dateDebut.getTime() + ((i + 0.5) * duree) / n);
    d.setHours(9, 0, 0, 0);
    return d;
  });
}

/** Crée les passages manquants d'une garantie (tous ses appareils, ou un seul). */
export async function genererPassages(garantieId: string, appareilId?: string) {
  const [g] = await db.select().from(garanties).where(eq(garanties.id, garantieId)).limit(1);
  if (!g || g.interventionsIncluses <= 0) return 0;
  const apps = appareilId
    ? [{ appareilId }]
    : await db.select({ appareilId: projetAppareils.appareilId }).from(projetAppareils).where(eq(projetAppareils.projetId, g.projetId));
  const dates = datesPassages(g.dateDebut, g.dateFin, g.interventionsIncluses);
  let crees = 0;
  for (const a of apps) {
    const rows = await db
      .insert(garantiePassages)
      .values(
        dates.map((d, i) => ({
          garantieId,
          appareilId: a.appareilId,
          numero: i + 1,
          total: g.interventionsIncluses,
          datePrevue: d,
          dateInitiale: d,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: garantiePassages.id });
    crees += rows.length;
  }
  return crees;
}

/** Phase 24 : crée les passages manquants d'un contrat (tous ses appareils, ou un seul). */
export async function genererPassagesContrat(prestationId: string, appareilId?: string) {
  const [c] = await db.select().from(prestations).where(eq(prestations.id, prestationId)).limit(1);
  if (!c || c.mode !== "contrat" || !c.dateDebut || !c.dateFin || !c.nbPassages || c.nbPassages <= 0) return 0;
  const apps = appareilId
    ? [{ appareilId }]
    : await db.select({ appareilId: prestationAppareils.appareilId }).from(prestationAppareils).where(eq(prestationAppareils.prestationId, prestationId));
  const dates = datesPassages(c.dateDebut, c.dateFin, c.nbPassages);
  let crees = 0;
  for (const a of apps) {
    if (!dates.length) break;
    const rows = await db
      .insert(garantiePassages)
      .values(
        dates.map((d, i) => ({
          prestationId,
          appareilId: a.appareilId,
          numero: i + 1,
          total: c.nbPassages!,
          datePrevue: d,
          dateInitiale: d,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: garantiePassages.id });
    crees += rows.length;
  }
  return crees;
}

/** Le compteur « restantes » de la garantie suit les passages réellement faits. */
export async function recalculerRestantes(garantieId: string) {
  const [r] = await db
    .select({
      nbApps: sql<number>`count(distinct ${garantiePassages.appareilId})::int`,
      restants: sql<number>`count(*) filter (where ${garantiePassages.statut} <> 'realise')::int`,
    })
    .from(garantiePassages)
    .where(eq(garantiePassages.garantieId, garantieId));
  if (!r || !r.nbApps) return;
  await db
    .update(garanties)
    .set({ interventionsRestantes: Math.ceil(r.restants / r.nbApps) })
    .where(eq(garanties.id, garantieId));
}

export type EtatPassage = "realise" | "planifie" | "a_venir" | "bientot" | "a_planifier" | "retard";

export const ETAT_PASSAGE: Record<EtatPassage, { label: string; tone: "ok" | "warn" | "crit" | "neutral"; couleur: string }> = {
  realise: { label: "Réalisé", tone: "ok", couleur: "bg-green-ink" },
  planifie: { label: "Planifié", tone: "neutral", couleur: "bg-blue" },
  a_venir: { label: "À venir", tone: "neutral", couleur: "bg-[#cbd5e1]" },
  bientot: { label: "Bientôt", tone: "warn", couleur: "bg-orange-ink" },
  a_planifier: { label: "À planifier", tone: "crit", couleur: "bg-red-ink" },
  retard: { label: "En retard", tone: "crit", couleur: "bg-red-ink" },
};

export function etatPassage(
  p: { statut: string; datePrevue: Date },
  m: { technicienId: string | null; dateProgrammee: Date | null; statut: string } | null,
  maintenant = Date.now()
): EtatPassage {
  if (p.statut === "realise" || (m && ["terminee", "validee", "cloturee"].includes(m.statut))) return "realise";
  if (m && m.technicienId && m.dateProgrammee) {
    return maintenant > m.dateProgrammee.getTime() + 86400000 && m.statut !== "en_cours" ? "retard" : "planifie";
  }
  const jours = (p.datePrevue.getTime() - maintenant) / 86400000;
  if (jours < 0) return "retard";
  if (jours <= JOURS_A_PLANIFIER) return "a_planifier";
  if (jours <= JOURS_BIENTOT) return "bientot";
  return "a_venir";
}

const colonnes = {
  id: garantiePassages.id,
  garantieId: garantiePassages.garantieId,
  prestationId: garantiePassages.prestationId,
  // « Garantie » ou le nom du contrat (ex. « Abonnement Confort »).
  libelle: sql<string>`coalesce(${prestations.description}, 'Garantie')`,
  appareilId: garantiePassages.appareilId,
  numero: garantiePassages.numero,
  total: garantiePassages.total,
  datePrevue: garantiePassages.datePrevue,
  dateInitiale: garantiePassages.dateInitiale,
  motifDecalage: garantiePassages.motifDecalage,
  statut: garantiePassages.statut,
  realiseLe: garantiePassages.realiseLe,
  interventionId: garantiePassages.interventionId,
  numeroAppareil: appareils.numeroInterne,
  mTechnicienId: interventions.technicienId,
  mDate: interventions.dateProgrammee,
  mStatut: interventions.statut,
  technicien: users.nom,
  projetId: projets.id,
  projetRef: projets.reference,
  client: clients.raisonSociale,
};

function enrichir<T extends { statut: string; datePrevue: Date; mTechnicienId: string | null; mDate: Date | null; mStatut: string | null }>(rows: T[]) {
  const maintenant = Date.now();
  return rows.map((r) => ({
    ...r,
    etat: etatPassage(r, r.mStatut ? { technicienId: r.mTechnicienId, dateProgrammee: r.mDate, statut: r.mStatut } : null, maintenant),
  }));
}

function requete() {
  return db
    .select(colonnes)
    .from(garantiePassages)
    .innerJoin(appareils, eq(garantiePassages.appareilId, appareils.id))
    .leftJoin(garanties, eq(garantiePassages.garantieId, garanties.id))
    .leftJoin(prestations, eq(garantiePassages.prestationId, prestations.id))
    .innerJoin(projets, sql`${projets.id} = coalesce(${garanties.projetId}, ${prestations.projetId})`)
    .innerJoin(clients, eq(projets.clientId, clients.id))
    .leftJoin(interventions, eq(garantiePassages.interventionId, interventions.id))
    .leftJoin(users, eq(interventions.technicienId, users.id));
}

export async function passagesDeGaranties(garantieIds: string[]) {
  if (!garantieIds.length) return [];
  return enrichir(
    await requete()
      .where(inArray(garantiePassages.garantieId, garantieIds))
      .orderBy(asc(appareils.numeroInterne), asc(garantiePassages.numero))
  );
}

export async function passagesDePrestations(prestationIds: string[]) {
  if (!prestationIds.length) return [];
  return enrichir(
    await requete()
      .where(inArray(garantiePassages.prestationId, prestationIds))
      .orderBy(asc(appareils.numeroInterne), asc(garantiePassages.numero))
  );
}

/** Tous les passages du même échéancier (garantie ou contrat) qu'un passage donné. */
export async function passagesDuMemeEchancier(passageId: string) {
  const [b] = await db
    .select({ garantieId: garantiePassages.garantieId, prestationId: garantiePassages.prestationId })
    .from(garantiePassages)
    .where(eq(garantiePassages.id, passageId))
    .limit(1);
  if (!b) return [];
  return b.garantieId ? passagesDeGaranties([b.garantieId]) : passagesDePrestations([b.prestationId!]);
}

/** Ce qu'il faut pour créer la mission d'un passage (garantie ou contrat). */
export async function infoMissionPassage(passageId: string) {
  const [p] = await db
    .select({
      p: garantiePassages,
      projetId: sql<string>`coalesce(${garanties.projetId}, ${prestations.projetId})`,
      libelle: sql<string>`coalesce(${prestations.description}, 'Passage de garantie')`,
      typeMission: prestations.typeMission,
      checklistModeleId: prestations.checklistModeleId,
      numeroAppareil: appareils.numeroInterne,
    })
    .from(garantiePassages)
    .leftJoin(garanties, eq(garantiePassages.garantieId, garanties.id))
    .leftJoin(prestations, eq(garantiePassages.prestationId, prestations.id))
    .innerJoin(appareils, eq(garantiePassages.appareilId, appareils.id))
    .where(eq(garantiePassages.id, passageId))
    .limit(1);
  return p ?? null;
}

/** Crée la mission « à affecter » d'un passage, avec la checklist du contrat ou la plus adaptée. */
export async function creerMissionPassage(passageId: string, dateProgrammee?: Date) {
  const info = await infoMissionPassage(passageId);
  if (!info) return null;
  const { p } = info;
  const [m] = await db
    .insert(interventions)
    .values({
      appareilId: p.appareilId,
      projetId: info.projetId,
      type: info.typeMission ?? "preventive",
      statut: "creee",
      priorite: "normale",
      description: `${info.libelle} — passage ${p.numero}/${p.total} — prévu vers le ${p.datePrevue.toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels" })}`,
      dateProgrammee: dateProgrammee ?? p.datePrevue,
    })
    .returning({ id: interventions.id });
  if (info.checklistModeleId) {
    try {
      const n = await attribuerChecklists(m.id, [info.checklistModeleId], null);
      if (!n) await attribuerParDefaut(m.id);
    } catch {
      await attribuerParDefaut(m.id);
    }
  } else {
    await attribuerParDefaut(m.id);
  }
  await db.update(garantiePassages).set({ interventionId: m.id }).where(and(eq(garantiePassages.id, passageId), isNull(garantiePassages.interventionId)));
  return { id: m.id, projetId: info.projetId, numeroAppareil: info.numeroAppareil, numero: p.numero, total: p.total, libelle: info.libelle };
}

export async function passagesDAppareils(appareilIds: string[]) {
  if (!appareilIds.length) return [];
  return enrichir(
    await requete()
      .where(inArray(garantiePassages.appareilId, appareilIds))
      .orderBy(asc(garantiePassages.datePrevue))
  );
}

/** Pour le tableau de bord : passages non réalisés dans les 30 jours, ou en retard. */
export async function passagesAVenirTableauDeBord() {
  const rows = enrichir(
    await requete()
      .where(and(eq(garantiePassages.statut, "a_venir"), delaiAtteint()))
      .orderBy(asc(garantiePassages.datePrevue))
      .limit(200)
  );
  return rows.filter((r) => r.etat !== "realise");
}

/** Passage dont la date entre dans le délai d'anticipation (30 j garantie, réglage du contrat sinon). */
function delaiAtteint() {
  return sql`${garantiePassages.datePrevue} <= now() + make_interval(days => coalesce(${prestations.anticipationJours}, ${JOURS_BIENTOT}))`;
}

/**
 * Tâche planifiée (cron) : à l'approche d'un passage (garantie : 30 jours ;
 * contrat : son délai), crée la mission à affecter (une seule fois).
 */
export async function creerMissionsPassagesProches() {
  const aCreer = await db
    .select({ id: garantiePassages.id })
    .from(garantiePassages)
    .leftJoin(prestations, eq(garantiePassages.prestationId, prestations.id))
    .where(and(eq(garantiePassages.statut, "a_venir"), isNull(garantiePassages.interventionId), delaiAtteint()))
    .limit(200);
  const crees: { numeroAppareil: string; numero: number; total: number; libelle: string }[] = [];
  for (const p of aCreer) {
    const m = await creerMissionPassage(p.id);
    if (m) crees.push(m);
  }
  return crees;
}

/** Appelé quand une mission est terminée : le passage lié devient « réalisé ». */
export async function marquerPassageRealise(interventionId: string) {
  const rows = await db
    .update(garantiePassages)
    .set({ statut: "realise", realiseLe: new Date() })
    .where(and(eq(garantiePassages.interventionId, interventionId), eq(garantiePassages.statut, "a_venir")))
    .returning({ garantieId: garantiePassages.garantieId });
  for (const r of rows) if (r.garantieId) await recalculerRestantes(r.garantieId);
}
