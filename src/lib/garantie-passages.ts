import "server-only";
import { attribuerParDefaut } from "@/lib/checklists";
import { db } from "@/db";
import {
  appareils,
  clients,
  garantiePassages,
  garanties,
  interventions,
  projetAppareils,
  projets,
  users,
} from "@/db/schema";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";

// ==========================================================================
// Phase 19 — Échéancier des passages de garantie (par appareil).
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
    .innerJoin(garanties, eq(garantiePassages.garantieId, garanties.id))
    .innerJoin(projets, eq(garanties.projetId, projets.id))
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
  const limite = new Date(Date.now() + JOURS_BIENTOT * 86400000);
  const rows = enrichir(
    await requete()
      .where(and(eq(garantiePassages.statut, "a_venir"), lte(garantiePassages.datePrevue, limite)))
      .orderBy(asc(garantiePassages.datePrevue))
      .limit(200)
  );
  return rows.filter((r) => r.etat !== "realise");
}

/**
 * Tâche planifiée (cron) : 30 jours avant un passage, crée la mission
 * « Passage de garantie k/N » à affecter (une seule fois).
 */
export async function creerMissionsPassagesProches() {
  const limite = new Date(Date.now() + JOURS_BIENTOT * 86400000);
  const aCreer = await db
    .select({
      id: garantiePassages.id,
      appareilId: garantiePassages.appareilId,
      numero: garantiePassages.numero,
      total: garantiePassages.total,
      datePrevue: garantiePassages.datePrevue,
      projetId: garanties.projetId,
      numeroAppareil: appareils.numeroInterne,
    })
    .from(garantiePassages)
    .innerJoin(garanties, eq(garantiePassages.garantieId, garanties.id))
    .innerJoin(appareils, eq(garantiePassages.appareilId, appareils.id))
    .where(and(eq(garantiePassages.statut, "a_venir"), isNull(garantiePassages.interventionId), lte(garantiePassages.datePrevue, limite)))
    .limit(200);
  const crees: { numeroAppareil: string; numero: number; total: number }[] = [];
  for (const p of aCreer) {
    const [m] = await db
      .insert(interventions)
      .values({
        appareilId: p.appareilId,
        projetId: p.projetId,
        type: "preventive",
        statut: "creee",
        priorite: "normale",
        description: `Passage de garantie ${p.numero}/${p.total} — prévu vers le ${p.datePrevue.toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels" })}`,
        dateProgrammee: p.datePrevue,
      })
      .returning({ id: interventions.id });
    await attribuerParDefaut(m.id);
    await db.update(garantiePassages).set({ interventionId: m.id }).where(and(eq(garantiePassages.id, p.id), isNull(garantiePassages.interventionId)));
    crees.push(p);
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
  for (const r of rows) await recalculerRestantes(r.garantieId);
}
