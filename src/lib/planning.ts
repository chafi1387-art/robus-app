import "server-only";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appareils,
  clients,
  formationsParticipants,
  formationsSessions,
  interventions,
  missionJournal,
  projets,
  rapports,
  users,
} from "@/db/schema";
import { progressionMissions } from "@/lib/checklists";

// ==========================================================================
// Phase 27 — Planning des missions (maquette validée le 08/10/2026).
//
// Une seule source pour : le planning (jour / semaine / mois), les compteurs,
// « Sur le terrain maintenant », « À traiter » et la pastille du menu.
// Les jours sont ceux de Bruxelles (les dates sont stockées en UTC).
// ==========================================================================

export const TZ = "Europe/Brussels";
const MIN = 60000;
const HEURE = 60 * MIN;
export const DELAI_NON_VUE = 30 * MIN;
/** Même règle que la tâche planifiée « missions en retard » : 1 h après l'heure prévue. */
export const DELAI_RETARD = HEURE;

export const NON_COMMENCES = ["creee", "planifiee", "affectee"] as const;
export const OUVERTS = [...NON_COMMENCES, "en_cours"] as const;
const estNonCommencee = (s: string) => (NON_COMMENCES as readonly string[]).includes(s);

export const TYPES_MISSION: Record<string, string> = {
  preventive: "Préventive",
  corrective: "Dépannage",
  systematique: "Systématique",
};

// ---------- Jours et heures ----------
//
// Attention : les heures PROGRAMMÉES (missions, formations) sont saisies dans
// un champ « date et heure » et enregistrées telles quelles (heure murale de
// Bruxelles, sans fuseau) — on les affiche donc sans conversion (UTC).
// Les instants réels (envoyée, vue, sur place, rapport…) sont de vrais
// instants : on les affiche à l'heure de Bruxelles.

/** Instant présent exprimé en « heure murale de Bruxelles » (comparable aux heures programmées). */
export function mur(maintenant: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(maintenant))
      .map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}
/** Jour (AAAA-MM-JJ) d'une heure programmée. */
export function cleJour(d: Date) {
  return d.toISOString().slice(0, 10);
}
/** Jour (AAAA-MM-JJ) d'aujourd'hui à Bruxelles. */
export function aujourdhui(maintenant: number) {
  return cleJour(new Date(mur(maintenant)));
}
function versDate(cle: string) {
  return new Date(`${cle}T12:00:00Z`);
}
export function ajouterJours(cle: string, n: number) {
  const d = versDate(cle);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function ajouterMois(cle: string, n: number) {
  const d = versDate(cle.slice(0, 7) + "-01");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
/** Lundi de la semaine de ce jour. */
export function lundiDe(cle: string) {
  const j = versDate(cle).getUTCDay(); // 0 = dimanche
  return ajouterJours(cle, j === 0 ? -6 : 1 - j);
}
export function cleValide(c: string | undefined | null): c is string {
  return !!c && /^\d{4}-\d{2}-\d{2}$/.test(c) && !Number.isNaN(versDate(c).getTime());
}
export function libelleJour(cle: string, format: "court" | "long" | "titre" = "court") {
  const d = versDate(cle);
  if (format === "court") {
    const j = d.toLocaleDateString("fr-BE", { timeZone: "UTC", weekday: "short" }).replace(".", "");
    return `${j.charAt(0).toUpperCase()}${j.slice(1)} ${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const t = d.toLocaleDateString("fr-BE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", ...(format === "titre" ? {} : { year: "numeric" }) });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export function libelleMois(cle: string) {
  const t = versDate(cle).toLocaleDateString("fr-BE", { timeZone: "UTC", month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
/** Heure d'un instant réel (Bruxelles). */
export function heure(d: Date | null | undefined) {
  return d ? d.toLocaleTimeString("fr-BE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) : "";
}
/** Heure programmée (telle que saisie). */
export function heureProg(d: Date | null | undefined) {
  return d ? d.toLocaleTimeString("fr-BE", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" }) : "";
}
/** « 1 h 05 », « 25 min », « 2 j 4 h » depuis un instant réel. */
export function duree(depuis: Date | null | undefined, maintenant: number) {
  if (!depuis) return "";
  const min = Math.max(0, Math.round((maintenant - depuis.getTime()) / MIN));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")}`;
  const j = Math.floor(h / 24);
  return h % 24 ? `${j} j ${h % 24} h` : `${j} j`;
}
/** « aujourd'hui 10:00 », « jeu. 09/10 08:30 » — pour une heure programmée. */
export function quand(d: Date | null | undefined, maintenant: number) {
  if (!d) return "sans date";
  const c = cleJour(d);
  const auj = aujourdhui(maintenant);
  if (c === auj) return `aujourd'hui ${heureProg(d)}`;
  if (c === ajouterJours(auj, 1)) return `demain ${heureProg(d)}`;
  if (c === ajouterJours(auj, -1)) return `hier ${heureProg(d)}`;
  return `${d.toLocaleDateString("fr-BE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" })} ${heureProg(d)}`;
}

// ---------- Missions ----------

export type MissionPlanning = {
  id: string;
  statut: string;
  type: string;
  priorite: string;
  passage: number;
  dateProgrammee: Date | null;
  dateDebut: Date | null;
  dateFin: Date | null;
  envoyeeLe: Date | null;
  vueLe: Date | null;
  accepteeLe: Date | null;
  refuseeLe: Date | null;
  refusMotif: string | null;
  envoiEmail: string | null;
  envoiPush: number | null;
  valideeLe: Date | null;
  technicienId: string | null;
  technicien: string | null;
  appareilId: string;
  numero: string;
  appareilStatut: string;
  appareilDepuis: Date | null;
  client: string | null;
  projetId: string | null;
  projetRef: string | null;
  projetTitre: string | null;
  // Enrichissements
  rapportEnvoyeLe: Date | null;
  photos: number;
  checklist: { total: number; faites: number; nok: number } | null;
};

const COLONNES = {
  id: interventions.id,
  statut: interventions.statut,
  type: interventions.type,
  priorite: interventions.priorite,
  passage: interventions.passage,
  dateProgrammee: interventions.dateProgrammee,
  dateDebut: interventions.dateDebut,
  dateFin: interventions.dateFin,
  envoyeeLe: interventions.envoyeeLe,
  vueLe: interventions.vueLe,
  accepteeLe: interventions.accepteeLe,
  refuseeLe: interventions.refuseeLe,
  refusMotif: interventions.refusMotif,
  envoiEmail: interventions.envoiEmail,
  envoiPush: interventions.envoiPush,
  valideeLe: interventions.valideeLe,
  technicienId: interventions.technicienId,
  technicien: users.nom,
  appareilId: interventions.appareilId,
  numero: appareils.numeroInterne,
  appareilStatut: appareils.statut,
  appareilDepuis: appareils.statutDepuis,
  client: clients.raisonSociale,
  projetId: interventions.projetId,
  projetRef: projets.reference,
  projetTitre: projets.titre,
};

function requeteMissions() {
  return db
    .select(COLONNES)
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .leftJoin(clients, eq(projets.clientId, clients.id))
    .leftJoin(users, eq(interventions.technicienId, users.id));
}

/** Les « états visuels » communs à tout le planning (légende unique). */
export type EtatVisuel = "en_cours" | "refusee" | "non_vue" | "a_accepter" | "acceptee" | "a_affecter" | "non_envoyee" | "terminee" | "validee";

export function etatVisuel(m: Pick<MissionPlanning, "statut" | "technicienId" | "envoyeeLe" | "vueLe" | "accepteeLe" | "refuseeLe">): EtatVisuel {
  if (m.statut === "en_cours") return "en_cours";
  if (m.statut === "validee" || m.statut === "cloturee") return "validee";
  if (m.statut === "terminee") return "terminee";
  if (!m.technicienId) return "a_affecter";
  if (m.refuseeLe && !m.accepteeLe) return "refusee";
  if (m.accepteeLe) return "acceptee";
  if (m.vueLe) return "a_accepter";
  if (m.envoyeeLe) return "non_vue";
  return "non_envoyee";
}

export function estEnRetard(m: Pick<MissionPlanning, "statut" | "dateProgrammee">, maintenant: number) {
  return estNonCommencee(m.statut) && !!m.dateProgrammee && m.dateProgrammee.getTime() < mur(maintenant) - DELAI_RETARD;
}
export function estNonVueLongtemps(m: Pick<MissionPlanning, "statut" | "technicienId" | "envoyeeLe" | "vueLe" | "accepteeLe" | "refuseeLe">, maintenant: number) {
  return etatVisuel(m) === "non_vue" && !!m.envoyeeLe && maintenant - m.envoyeeLe.getTime() > DELAI_NON_VUE;
}

async function enrichir(rows: Omit<MissionPlanning, "rapportEnvoyeLe" | "photos" | "checklist">[]): Promise<MissionPlanning[]> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const enCours = rows.filter((r) => r.statut === "en_cours").map((r) => r.id);
  const finis = rows.filter((r) => ["terminee", "validee", "cloturee"].includes(r.statut)).map((r) => r.id);
  const [progression, photos, rap] = await Promise.all([
    progressionMissions(ids),
    enCours.length
      ? db
          .select({ id: missionJournal.interventionId, n: sql<number>`coalesce(sum(cardinality(${missionJournal.photos})), 0)::int` })
          .from(missionJournal)
          .innerJoin(interventions, eq(missionJournal.interventionId, interventions.id))
          .where(and(inArray(missionJournal.interventionId, enCours), sql`${missionJournal.createdAt} >= coalesce(${interventions.dateDebut}, ${interventions.createdAt})`))
          .groupBy(missionJournal.interventionId)
      : Promise.resolve([] as { id: string; n: number }[]),
    finis.length
      ? db.select({ id: rapports.interventionId, d: rapports.dateEnvoi }).from(rapports).where(inArray(rapports.interventionId, finis))
      : Promise.resolve([] as { id: string; d: Date | null }[]),
  ]);
  const nbPhotos = new Map(photos.map((p) => [p.id, Number(p.n)]));
  const dateRapport = new Map(rap.map((r) => [r.id, r.d]));
  return rows.map((r) => {
    const p = progression.get(r.id);
    return { ...r, photos: nbPhotos.get(r.id) ?? 0, rapportEnvoyeLe: dateRapport.get(r.id) ?? null, checklist: p && p.total ? p : null };
  });
}

export type FormationPlanning = { id: string; titre: string; debut: Date; dureeHeures: number | null; technicienId: string };

export type Vue = "jour" | "semaine" | "mois" | "projet";

export type Compteurs = {
  enCours: number;
  pasAcceptees: number;
  nonVues30: number;
  refusees: number;
  aAffecter: number;
  enRetard: number;
  aujourdhui: number;
  aujourdhuiTerminees: number;
  periode: number;
  techniciensPeriode: number;
};

export type LigneATraiter = {
  m: MissionPlanning;
  priorite: 1 | 2 | 3;
  raison: string;
  detail: string | null;
  action: "affecter" | "decider" | "relancer" | "replanifier" | "voir";
};

/** Compteurs de la pastille du menu (requête légère, appelée à chaque page du bureau). */
export async function compteursMenuPlanning(maintenant = Date.now()) {
  const [r] = await db
    .select({
      enCours: sql<number>`count(*) filter (where ${interventions.statut} = 'en_cours')::int`,
      aAffecter: sql<number>`count(*) filter (where ${interventions.statut} in ('creee','planifiee','affectee') and ${interventions.technicienId} is null)::int`,
      enRetard: sql<number>`count(*) filter (where ${interventions.statut} in ('creee','planifiee','affectee') and ${interventions.dateProgrammee} < ${new Date(mur(maintenant) - DELAI_RETARD).toISOString()}::timestamp)::int`,
    })
    .from(interventions)
    .where(inArray(interventions.statut, [...OUVERTS]));
  return { enCours: Number(r?.enCours ?? 0), aAffecter: Number(r?.aAffecter ?? 0), enRetard: Number(r?.enRetard ?? 0) };
}

/** Bornes (jours de Bruxelles) de la vue demandée. */
export function bornesVue(vue: Vue, jour: string) {
  if (vue === "jour") return { debut: jour, fin: jour };
  if (vue === "mois") {
    const premier = jour.slice(0, 7) + "-01";
    const dernier = ajouterJours(ajouterMois(premier, 1), -1);
    // Grille complète : du lundi de la 1re semaine au dimanche de la dernière.
    return { debut: lundiDe(premier), fin: ajouterJours(lundiDe(dernier), 6) };
  }
  const lundi = lundiDe(jour);
  return { debut: lundi, fin: ajouterJours(lundi, 6) };
}

export async function chargerPlanning(params: { vue: Vue; jour: string; technicienId?: string | null; type?: string | null; maintenant: number }) {
  const { debut, fin } = bornesVue(params.vue === "projet" ? "semaine" : params.vue, params.jour);
  // Marge d'un jour de chaque côté (fuseau), puis filtre exact sur le jour de Bruxelles.
  const de = new Date(`${ajouterJours(debut, -1)}T00:00:00Z`);
  const a = new Date(`${ajouterJours(fin, 2)}T00:00:00Z`);

  const filtres = [
    params.technicienId ? eq(interventions.technicienId, params.technicienId) : undefined,
    params.type ? eq(interventions.type, params.type as "preventive") : undefined,
  ].filter(Boolean);

  const [periodeBrut, ouvertesBrut, techniciens, formations] = await Promise.all([
    requeteMissions()
      .where(and(gte(interventions.dateProgrammee, de), lt(interventions.dateProgrammee, a), ...filtres))
      .orderBy(interventions.dateProgrammee),
    // Missions ouvertes (toutes dates) : compteurs, terrain, à traiter.
    requeteMissions()
      .where(and(inArray(interventions.statut, [...OUVERTS]), ...filtres))
      .orderBy(interventions.dateProgrammee),
    db
      .select({ id: users.id, nom: users.nom })
      .from(users)
      .where(and(eq(users.role, "technicien"), eq(users.actif, 1), params.technicienId ? eq(users.id, params.technicienId) : undefined))
      .orderBy(users.nom),
    db
      .select({
        id: formationsSessions.id,
        titre: formationsSessions.titre,
        debut: formationsSessions.dateDebut,
        dureeHeures: formationsSessions.dureeHeures,
        technicienId: formationsParticipants.technicienId,
      })
      .from(formationsParticipants)
      .innerJoin(formationsSessions, eq(formationsParticipants.sessionId, formationsSessions.id))
      .where(
        and(
          gte(formationsSessions.dateDebut, de),
          lt(formationsSessions.dateDebut, a),
          sql`${formationsSessions.statut} <> 'annulee'`,
          params.technicienId ? eq(formationsParticipants.technicienId, params.technicienId) : undefined
        )
      ),
  ]);

  const dansPeriode = (d: Date | null) => {
    if (!d) return false;
    const c = cleJour(d);
    return c >= debut && c <= fin;
  };
  const periodeFiltree = periodeBrut.filter((m) => dansPeriode(m.dateProgrammee));
  // Une seule passe d'enrichissement pour les deux listes.
  const tous = new Map<string, (typeof periodeBrut)[number]>();
  for (const m of [...periodeFiltree, ...ouvertesBrut]) tous.set(m.id, m);
  const enrichies = new Map((await enrichir([...tous.values()])).map((m) => [m.id, m]));
  const periode = periodeFiltree.map((m) => enrichies.get(m.id)!);
  const ouvertes = ouvertesBrut.map((m) => enrichies.get(m.id)!);

  const n = params.maintenant;
  const auj = aujourdhui(n);
  const pasAcceptees = ouvertes.filter((m) => estNonCommencee(m.statut) && m.technicienId && !m.accepteeLe);
  const duJour = [...tous.values()].filter((m) => m.dateProgrammee && cleJour(m.dateProgrammee) === auj);
  const compteurs: Compteurs = {
    enCours: ouvertes.filter((m) => m.statut === "en_cours").length,
    pasAcceptees: pasAcceptees.length,
    nonVues30: pasAcceptees.filter((m) => estNonVueLongtemps(m, n)).length,
    refusees: pasAcceptees.filter((m) => m.refuseeLe).length,
    aAffecter: ouvertes.filter((m) => estNonCommencee(m.statut) && !m.technicienId).length,
    enRetard: ouvertes.filter((m) => estEnRetard(m, n)).length,
    aujourdhui: duJour.length,
    aujourdhuiTerminees: duJour.filter((m) => ["terminee", "validee", "cloturee"].includes(m.statut)).length,
    periode: periode.length,
    techniciensPeriode: new Set(periode.map((m) => m.technicienId).filter(Boolean)).size,
  };

  const terrain = ouvertes
    .filter((m) => m.statut === "en_cours")
    .sort((x, y) => (x.dateDebut?.getTime() ?? 0) - (y.dateDebut?.getTime() ?? 0));

  return {
    debut,
    fin,
    periode,
    ouvertes,
    terrain,
    aTraiter: lignesATraiter(ouvertes, n),
    compteurs,
    techniciens,
    formations: formations
      .filter((f) => dansPeriode(f.debut))
      .map((f) => ({ ...f, dureeHeures: f.dureeHeures === null ? null : Number(f.dureeHeures) })) as FormationPlanning[],
  };
}

const ARRET = new Set(["en_panne", "hors_service"]);

/** « À traiter » : ce qui demande une action du bureau, par priorité (P1 → P3). */
export function lignesATraiter(ouvertes: MissionPlanning[], maintenant: number): LigneATraiter[] {
  const lignes: LigneATraiter[] = [];
  for (const m of ouvertes) {
    if (!estNonCommencee(m.statut)) continue;
    const etat = etatVisuel(m);
    const arret = ARRET.has(m.appareilStatut);
    const retard = estEnRetard(m, maintenant);
    const proche = !!m.dateProgrammee && m.dateProgrammee.getTime() < mur(maintenant) + 48 * HEURE;
    if (etat === "refusee") {
      lignes.push({ m, priorite: 1, raison: `Refusée par ${m.technicien ?? "le technicien"}`, detail: "À réaffecter ou renvoyer", action: "decider" });
    } else if (etat === "a_affecter") {
      lignes.push({
        m,
        priorite: arret || retard || proche ? 1 : 3,
        raison: m.dateProgrammee ? `À affecter · prévue ${quand(m.dateProgrammee, maintenant)}` : "À affecter · sans date",
        detail: arret ? "Appareil à l'arrêt" : retard ? "Date dépassée" : null,
        action: "affecter",
      });
    } else if (etat === "non_vue" && estNonVueLongtemps(m, maintenant)) {
      lignes.push({
        m,
        priorite: 1,
        raison: `Envoyée il y a ${duree(m.envoyeeLe, maintenant)} · pas encore vue`,
        detail: [m.envoiEmail === "ok" ? "Email ✓" : m.envoiEmail === "echec" ? "Email non parti" : null, m.envoiPush ? "téléphone ✓" : m.envoiPush === 0 ? "téléphone non notifié" : null].filter(Boolean).join(" · ") || null,
        action: "relancer",
      });
    } else if (etat === "non_envoyee") {
      lignes.push({ m, priorite: 2, raison: "Technicien choisi, mission pas encore envoyée", detail: null, action: "relancer" });
    } else if (retard) {
      lignes.push({ m, priorite: 2, raison: `En retard · prévue ${quand(m.dateProgrammee, maintenant)}`, detail: etat === "acceptee" ? "Acceptée, pas encore commencée" : "Pas encore acceptée", action: "replanifier" });
    } else if (etat === "a_accepter" && arret) {
      lignes.push({ m, priorite: 2, raison: "Vue, pas encore acceptée", detail: "Appareil à l'arrêt", action: "relancer" });
    } else if (etat === "a_accepter" && m.vueLe && maintenant - m.vueLe.getTime() > 2 * HEURE) {
      lignes.push({ m, priorite: 3, raison: `Vue il y a ${duree(m.vueLe, maintenant)}, pas encore acceptée`, detail: null, action: "relancer" });
    }
  }
  return lignes.sort((a, b) => a.priorite - b.priorite || (a.m.dateProgrammee?.getTime() ?? Infinity) - (b.m.dateProgrammee?.getTime() ?? Infinity));
}

/** Missions sans date (non placées dans la grille). */
export function sansDate(ouvertes: MissionPlanning[]) {
  return ouvertes.filter((m) => !m.dateProgrammee && estNonCommencee(m.statut));
}

/** Pour les filtres de la page (missions affichées). */
export function filtrerParEtat(ms: MissionPlanning[], f: string | null, maintenant: number) {
  if (!f) return ms;
  return ms.filter((m) => {
    const e = etatVisuel(m);
    if (f === "encours") return e === "en_cours";
    if (f === "pasacceptees") return estNonCommencee(m.statut) && !!m.technicienId && !m.accepteeLe;
    if (f === "affecter") return e === "a_affecter";
    if (f === "retard") return estEnRetard(m, maintenant);
    return true;
  });
}

