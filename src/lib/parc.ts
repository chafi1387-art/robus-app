import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appareilEtats,
  appareils,
  clients,
  demandesClient,
  devis,
  garantiePassages,
  garanties,
  interventions,
  prestationAppareils,
  prestations,
  projetAppareils,
  projets,
  sites,
  users,
} from "@/db/schema";

// ==========================================================================
// Phase 26 — Parc d'appareils : état, durée d'arrêt, priorités.
//
// P1 Critique   : personne bloquée ; appareil à l'arrêt (en panne / hors
//                 service) sans technicien qui a accepté la mission.
// P2 Urgent     : à l'arrêt avec un technicien qui a accepté / sur place ;
//                 mission en retard.
// P3 À surveiller : sous surveillance, en travaux, ≥ 3 pannes en 90 jours,
//                 contrat / garantie qui se termine dans moins de 60 jours,
//                 devis accepté à planifier, mission à affecter.
// ==========================================================================

export const ETATS_ARRET = ["en_panne", "hors_service"] as const;
export const estArret = (s: string) => (ETATS_ARRET as readonly string[]).includes(s);
const FINIS = ["terminee", "validee", "cloturee"] as const;
const JOUR = 86400000;

export type Priorite = 1 | 2 | 3 | 4;
export const PRIORITES: Record<Priorite, { code: string; label: string }> = {
  1: { code: "P1", label: "Critique" },
  2: { code: "P2", label: "Urgent" },
  3: { code: "P3", label: "À surveiller" },
  4: { code: "OK", label: "RAS" },
};

export type MissionOuverte = {
  id: string;
  appareilId: string;
  statut: string;
  type: string;
  technicienId: string | null;
  technicien: string | null;
  dateProgrammee: Date | null;
  dateDebut: Date | null;
  envoyeeLe: Date | null;
  vueLe: Date | null;
  accepteeLe: Date | null;
  refuseeLe: Date | null;
};

export type LigneParc = {
  id: string;
  numero: string;
  marque: string | null;
  modele: string | null;
  annee: number | null;
  niveaux: number | null;
  statut: string;
  statutDepuis: Date | null;
  client: string | null;
  adresse: string | null;
  missions: MissionOuverte[];
  mission: MissionOuverte | null;
  pannes90: number;
  prochaineVisite: Date | null;
  couvertureFin: Date | null;
  devisAPlanifier: { id: string; numero: string } | null;
  personneBloquee: { id: string; numero: string; createdAt: Date } | null;
  priorite: Priorite;
  raison: string;
  detail: string | null;
  action: { label: string; href: string; fort: boolean } | null;
};

/** « 2 j 4 h », « 3 h 10 », « 25 min ». */
export function duree(depuis: Date | null | undefined, maintenant = new Date()) {
  if (!depuis) return null;
  const min = Math.max(0, Math.round((maintenant.getTime() - depuis.getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")}`;
  const j = Math.floor(h / 24);
  return h % 24 ? `${j} j ${h % 24} h` : `${j} j`;
}

export function heure(d: Date | null | undefined) {
  return d ? d.toLocaleTimeString("fr-BE", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit" }) : "";
}
export function jourCourt(d: Date | null | undefined) {
  return d ? d.toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit" }) : "";
}

/** Mission la plus « avancée » : sur place > acceptée > envoyée > à affecter. */
function missionPrincipale(ms: MissionOuverte[]) {
  const rang = (m: MissionOuverte) => (m.statut === "en_cours" ? 0 : m.accepteeLe ? 1 : m.technicienId ? 2 : 3);
  return [...ms].sort((a, b) => rang(a) - rang(b) || (a.dateProgrammee?.getTime() ?? 0) - (b.dateProgrammee?.getTime() ?? 0))[0] ?? null;
}

function classer(l: Omit<LigneParc, "priorite" | "raison" | "detail" | "action">, maintenant: Date): Pick<LigneParc, "priorite" | "raison" | "detail" | "action"> {
  const m = l.mission;
  const lienMission = m ? `/responsable/missions/${m.id}` : null;
  const lienCreer = `/responsable/appareils/${l.id}?tab=mission`;
  const arret = estArret(l.statut);

  if (l.personneBloquee) {
    return {
      priorite: 1,
      raison: `Personne bloquée signalée · ${heure(l.personneBloquee.createdAt)}`,
      detail: m?.technicien ? `${m.technicien}${m.statut === "en_cours" ? " sur place" : m.accepteeLe ? " a accepté" : " prévenu, pas encore accepté"}` : "Aucun technicien affecté",
      action: m?.technicienId ? { label: "Voir la mission", href: lienMission!, fort: true } : { label: "Affecter maintenant", href: lienMission ?? `/responsable/demandes/${l.personneBloquee.id}`, fort: true },
    };
  }
  if (arret) {
    if (!m) return { priorite: 1, raison: "Aucune mission en cours", detail: null, action: { label: "Créer une mission", href: lienCreer, fort: true } };
    if (!m.technicienId) return { priorite: 1, raison: "Mission sans technicien", detail: m.dateProgrammee ? `Prévue le ${jourCourt(m.dateProgrammee)}` : null, action: { label: "Affecter maintenant", href: lienMission!, fort: true } };
    if (m.refuseeLe && !m.accepteeLe) return { priorite: 1, raison: `Mission refusée par ${m.technicien}`, detail: "À réaffecter", action: { label: "Décider", href: lienMission!, fort: true } };
    if (m.statut === "en_cours") return { priorite: 2, raison: `Technicien sur place — ${m.technicien}`, detail: m.dateDebut ? `Depuis ${heure(m.dateDebut)}` : null, action: { label: "Suivre en direct", href: lienMission!, fort: false } };
    if (!m.accepteeLe) {
      return {
        priorite: 1,
        raison: m.vueLe ? `Mission vue par ${m.technicien}, pas encore acceptée` : m.envoyeeLe ? "Mission envoyée · pas encore vue" : "Mission affectée · pas encore envoyée",
        detail: `${m.technicien}${m.envoyeeLe ? ` · envoyée il y a ${duree(m.envoyeeLe, maintenant)}` : ""}`,
        action: { label: "Relancer / réaffecter", href: lienMission!, fort: false },
      };
    }
    const retard = m.dateProgrammee && m.dateProgrammee.getTime() < maintenant.getTime() - 3600000;
    return {
      priorite: 2,
      raison: retard ? `Intervention en retard (prévue le ${jourCourt(m.dateProgrammee)})` : `Intervention prévue le ${jourCourt(m.dateProgrammee)} à ${heure(m.dateProgrammee)}`,
      detail: `${m.technicien} a accepté`,
      action: { label: retard ? "Replanifier" : "Voir la mission", href: lienMission!, fort: false },
    };
  }
  // Appareil en marche : missions en retard, puis points à surveiller.
  const enRetard = l.missions.find((x) => x.statut !== "en_cours" && x.dateProgrammee && x.dateProgrammee.getTime() < maintenant.getTime() - 3600000);
  if (enRetard) {
    return {
      priorite: 2,
      raison: `${enRetard.type === "preventive" ? "Préventive" : "Mission"} en retard de ${duree(enRetard.dateProgrammee, maintenant)}`,
      detail: `Prévue le ${jourCourt(enRetard.dateProgrammee)}${enRetard.technicien ? ` · ${enRetard.technicien}` : " · sans technicien"}`,
      action: { label: "Replanifier", href: `/responsable/missions/${enRetard.id}`, fort: false },
    };
  }
  const p3: { raison: string; detail: string | null; action: LigneParc["action"] }[] = [];
  if (l.devisAPlanifier) p3.push({ raison: `Devis ${l.devisAPlanifier.numero} accepté — travaux à planifier`, detail: null, action: { label: "Planifier", href: `/responsable/devis/${l.devisAPlanifier.id}#travaux`, fort: false } });
  const sansTech = l.missions.find((x) => !x.technicienId);
  if (sansTech) p3.push({ raison: "Mission à affecter", detail: sansTech.dateProgrammee ? `Prévue le ${jourCourt(sansTech.dateProgrammee)}` : "Sans date", action: { label: "Affecter", href: `/responsable/missions/${sansTech.id}`, fort: false } });
  if (l.statut === "sous_surveillance") p3.push({ raison: "Sous surveillance", detail: l.statutDepuis ? `Depuis ${duree(l.statutDepuis, maintenant)}` : null, action: { label: "Voir l'appareil", href: `/responsable/appareils/${l.id}`, fort: false } });
  if (l.statut === "en_travaux") p3.push({ raison: "En travaux", detail: l.statutDepuis ? `Depuis ${duree(l.statutDepuis, maintenant)}` : null, action: { label: "Voir l'appareil", href: `/responsable/appareils/${l.id}`, fort: false } });
  if (l.pannes90 >= 3) p3.push({ raison: `${l.pannes90} pannes en 90 jours`, detail: "Pannes répétées", action: { label: "Voir l'historique", href: `/responsable/appareils/${l.id}`, fort: false } });
  if (l.couvertureFin && l.couvertureFin.getTime() - maintenant.getTime() < 60 * JOUR) p3.push({ raison: `Contrat / garantie jusqu'au ${l.couvertureFin.toLocaleDateString("fr-BE")}`, detail: "Se termine dans moins de 60 jours", action: { label: "Renouveler", href: `/responsable/appareils/${l.id}?tab=contrats`, fort: false } });
  if (p3.length) return { priorite: 3, ...p3[0], detail: [p3[0].detail, ...p3.slice(1).map((x) => x.raison)].filter(Boolean).join(" · ") || null };
  return { priorite: 4, raison: "", detail: null, action: null };
}

/** Tout le parc (ou un appareil) avec sa priorité. Une seule vague de requêtes. */
export async function chargerParc(ids?: string[]): Promise<LigneParc[]> {
  const maintenant = new Date();
  const filtre = <T,>(col: T) => (ids ? inArray(col as never, ids) : undefined);
  const il90 = new Date(maintenant.getTime() - 90 * JOUR);
  const [base, liens, missions, pannes, bloquees, passages, couvertureContrats, couvertureGaranties, devisAcc] = await Promise.all([
    db
      .select({
        id: appareils.id,
        numero: appareils.numeroInterne,
        marque: appareils.marque,
        modele: appareils.modele,
        annee: appareils.anneeInstallation,
        niveaux: appareils.niveaux,
        statut: appareils.statut,
        statutDepuis: appareils.statutDepuis,
        siteAdresse: sites.adresse,
        siteClient: clients.raisonSociale,
      })
      .from(appareils)
      .leftJoin(sites, eq(appareils.siteId, sites.id))
      .leftJoin(clients, eq(sites.clientId, clients.id))
      .where(filtre(appareils.id))
      .orderBy(asc(appareils.numeroInterne)),
    db
      .select({ appareilId: projetAppareils.appareilId, adresse: projets.adresse, client: clients.raisonSociale, createdAt: projets.createdAt })
      .from(projetAppareils)
      .innerJoin(projets, eq(projetAppareils.projetId, projets.id))
      .innerJoin(clients, eq(projets.clientId, clients.id))
      .where(filtre(projetAppareils.appareilId))
      .orderBy(desc(projets.createdAt)),
    db
      .select({
        id: interventions.id,
        appareilId: interventions.appareilId,
        statut: interventions.statut,
        type: interventions.type,
        technicienId: interventions.technicienId,
        technicien: users.nom,
        dateProgrammee: interventions.dateProgrammee,
        dateDebut: interventions.dateDebut,
        envoyeeLe: interventions.envoyeeLe,
        vueLe: interventions.vueLe,
        accepteeLe: interventions.accepteeLe,
        refuseeLe: interventions.refuseeLe,
      })
      .from(interventions)
      .leftJoin(users, eq(interventions.technicienId, users.id))
      .where(and(notInArray(interventions.statut, [...FINIS]), filtre(interventions.appareilId)))
      .orderBy(asc(interventions.dateProgrammee)),
    db
      .select({ appareilId: interventions.appareilId, n: sql<number>`count(*)::int` })
      .from(interventions)
      .where(and(eq(interventions.type, "corrective"), gte(interventions.createdAt, il90), filtre(interventions.appareilId)))
      .groupBy(interventions.appareilId),
    db
      .select({ id: demandesClient.id, numero: demandesClient.numero, appareilId: demandesClient.appareilId, createdAt: demandesClient.createdAt })
      .from(demandesClient)
      .where(and(eq(demandesClient.personneBloquee, 1), notInArray(demandesClient.statut, ["resolue", "cloturee"]), filtre(demandesClient.appareilId))),
    db
      .select({ appareilId: garantiePassages.appareilId, date: sql<Date>`min(${garantiePassages.datePrevue})` })
      .from(garantiePassages)
      .where(and(eq(garantiePassages.statut, "a_venir"), isNull(garantiePassages.interventionId), gte(garantiePassages.datePrevue, maintenant), filtre(garantiePassages.appareilId)))
      .groupBy(garantiePassages.appareilId),
    db
      .select({ appareilId: prestationAppareils.appareilId, fin: sql<Date | null>`max(${prestations.dateFin})` })
      .from(prestationAppareils)
      .innerJoin(prestations, eq(prestationAppareils.prestationId, prestations.id))
      .where(and(eq(prestations.mode, "contrat"), or(isNull(prestations.statutContrat), sql`${prestations.statutContrat} <> 'renouvele'`), filtre(prestationAppareils.appareilId)))
      .groupBy(prestationAppareils.appareilId),
    db
      .select({ appareilId: projetAppareils.appareilId, fin: sql<Date | null>`max(${garanties.dateFin})` })
      .from(garanties)
      .innerJoin(projetAppareils, eq(projetAppareils.projetId, garanties.projetId))
      .where(filtre(projetAppareils.appareilId))
      .groupBy(projetAppareils.appareilId),
    db
      .select({ id: devis.id, numero: devis.numero, appareilId: devis.appareilId })
      .from(devis)
      .where(and(eq(devis.statut, "accepte"), isNull(devis.travauxPlanifiesLe), filtre(devis.appareilId))),
  ]);

  const parAppareil = <T extends { appareilId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.appareilId) m.set(r.appareilId, [...(m.get(r.appareilId) ?? []), r]);
    return m;
  };
  const liensA = parAppareil(liens);
  const missionsA = parAppareil(missions);
  const pannesA = new Map(pannes.map((p) => [p.appareilId, p.n]));
  const bloqueesA = parAppareil(bloquees);
  const passagesA = new Map(passages.map((p) => [p.appareilId, p.date ? new Date(p.date) : null]));
  const finA = new Map<string, Date>();
  for (const c of [...couvertureContrats, ...couvertureGaranties]) {
    if (!c.fin) continue;
    const d = new Date(c.fin);
    const x = finA.get(c.appareilId);
    if (!x || d > x) finA.set(c.appareilId, d);
  }
  const devisA = parAppareil(devisAcc);

  const lignes = base.map((a) => {
    const lien = liensA.get(a.id)?.[0];
    const ms = (missionsA.get(a.id) ?? []) as MissionOuverte[];
    const prochaineMission = ms.filter((m) => m.dateProgrammee && m.dateProgrammee >= maintenant && m.statut !== "en_cours").map((m) => m.dateProgrammee!)[0] ?? null;
    const passage = passagesA.get(a.id) ?? null;
    const prochaineVisite = [prochaineMission, passage].filter((d): d is Date => !!d).sort((x, y) => x.getTime() - y.getTime())[0] ?? null;
    const bloq = bloqueesA.get(a.id)?.[0];
    const dv = devisA.get(a.id)?.[0];
    const partiel = {
      id: a.id,
      numero: a.numero,
      marque: a.marque,
      modele: a.modele,
      annee: a.annee,
      niveaux: a.niveaux,
      statut: a.statut,
      statutDepuis: a.statutDepuis,
      client: lien?.client ?? a.siteClient ?? null,
      adresse: lien?.adresse ?? a.siteAdresse ?? null,
      missions: ms,
      mission: missionPrincipale(ms),
      pannes90: pannesA.get(a.id) ?? 0,
      prochaineVisite,
      couvertureFin: finA.get(a.id) ?? null,
      devisAPlanifier: dv ? { id: dv.id, numero: dv.numero } : null,
      personneBloquee: bloq ? { id: bloq.id, numero: bloq.numero, createdAt: bloq.createdAt } : null,
    };
    return { ...partiel, ...classer(partiel, maintenant) };
  });

  // Priorité, puis l'arrêt le plus long en premier, puis le numéro.
  return lignes.sort(
    (x, y) =>
      x.priorite - y.priorite ||
      (estArret(x.statut) && estArret(y.statut) ? (x.statutDepuis?.getTime() ?? 0) - (y.statutDepuis?.getTime() ?? 0) : 0) ||
      x.numero.localeCompare(y.numero, "fr", { numeric: true })
  );
}

/** Indicateurs du parc (compteurs du haut de page). */
export function indicateursParc(lignes: LigneParc[]) {
  const maintenant = Date.now();
  const dans7 = maintenant + 7 * JOUR;
  const toutes = lignes.flatMap((l) => l.missions);
  return {
    total: lignes.length,
    horsService: lignes.filter((l) => l.statut === "hors_service").length,
    enPanne: lignes.filter((l) => l.statut === "en_panne").length,
    surveillance: lignes.filter((l) => l.statut === "sous_surveillance").length,
    repetees: lignes.filter((l) => l.statut === "sous_surveillance" && l.pannes90 >= 3).length,
    enTravaux: lignes.filter((l) => l.statut === "en_travaux").length,
    installation: lignes.filter((l) => l.statut === "installation").length,
    enService: lignes.filter((l) => l.statut === "en_service").length,
    missionsEnCours: toutes.filter((m) => m.statut === "en_cours").length,
    techniciensSurPlace: new Set(toutes.filter((m) => m.statut === "en_cours" && m.technicienId).map((m) => m.technicienId)).size,
    aAffecter: toutes.filter((m) => !m.technicienId).length,
    visites7: lignes.filter((l) => l.prochaineVisite && l.prochaineVisite.getTime() <= dans7).length,
    sansContrat: lignes.filter((l) => !l.couvertureFin || l.couvertureFin.getTime() < maintenant).length,
    p1: lignes.filter((l) => l.priorite === 1).length,
    p2: lignes.filter((l) => l.priorite === 2).length,
    p3: lignes.filter((l) => l.priorite === 3).length,
  };
}

/** Nombre d'appareils à l'arrêt (pastille du menu). */
export async function nbAppareilsArret() {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int`, panne: sql<number>`count(*) filter (where ${appareils.statut} = 'en_panne')::int` })
    .from(appareils)
    .where(inArray(appareils.statut, [...ETATS_ARRET]));
  return { total: r?.n ?? 0, enPanne: r?.panne ?? 0, horsService: (r?.n ?? 0) - (r?.panne ?? 0) };
}

/** Disponibilité, pannes et délai de remise en service sur 12 mois (fiche appareil). */
export async function statistiquesAppareil(appareilId: string) {
  const maintenant = new Date();
  const debut12 = new Date(maintenant.getTime() - 365 * JOUR);
  const [etats, missions12] = await Promise.all([
    db
      .select()
      .from(appareilEtats)
      .where(and(eq(appareilEtats.appareilId, appareilId), or(isNull(appareilEtats.fin), gte(appareilEtats.fin, debut12))))
      .orderBy(asc(appareilEtats.debut)),
    db
      .select({ type: interventions.type, statut: interventions.statut, createdAt: interventions.createdAt, dateFin: interventions.dateFin })
      .from(interventions)
      .where(and(eq(interventions.appareilId, appareilId), or(gte(interventions.createdAt, debut12), gte(interventions.dateFin, debut12)))),
  ]);
  // Période observée : 12 mois, ou depuis le premier état connu.
  const premier = etats[0]?.debut ?? maintenant;
  const origine = premier > debut12 ? premier : debut12;
  const periode = Math.max(1, maintenant.getTime() - origine.getTime());
  let arret = 0;
  const arretsClos: number[] = [];
  for (const e of etats) {
    if (!estArret(e.statut)) continue;
    const d = Math.max(e.debut.getTime(), origine.getTime());
    const f = (e.fin ?? maintenant).getTime();
    if (f > d) arret += f - d;
    if (e.fin && e.fin >= debut12) arretsClos.push(e.fin.getTime() - e.debut.getTime());
  }
  const pannes = missions12.filter((m) => m.type === "corrective" && m.createdAt >= debut12);
  // 12 derniers mois (graphique).
  const mois: { cle: string; label: string; pannes: number; preventives: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    mois.push({ cle: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("fr-BE", { month: "short" }).replace(".", ""), pannes: 0, preventives: 0 });
  }
  const indice = (d: Date) => mois.findIndex((m) => m.cle === `${d.getFullYear()}-${d.getMonth()}`);
  for (const m of pannes) {
    const i = indice(m.createdAt);
    if (i >= 0) mois[i].pannes++;
  }
  for (const m of missions12) {
    if (m.type === "corrective" || !m.dateFin || !(FINIS as readonly string[]).includes(m.statut)) continue;
    const i = indice(m.dateFin);
    if (i >= 0) mois[i].preventives++;
  }
  const estime = etats.some((e) => e.estime === 1 && estArret(e.statut));
  return {
    disponibilite: Math.round((1 - arret / periode) * 1000) / 10,
    jours: Math.round(periode / JOUR),
    pannes12: pannes.length,
    delaiMoyen: arretsClos.length ? arretsClos.reduce((a, b) => a + b, 0) / arretsClos.length : null,
    mois,
    estime,
  };
}

export function dureeMs(ms: number | null) {
  if (ms === null) return "—";
  return duree(new Date(Date.now() - ms)) ?? "—";
}
