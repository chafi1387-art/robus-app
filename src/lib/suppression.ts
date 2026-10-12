import "server-only";
import { after } from "next/server";
import { and, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appareils,
  demandesClient,
  devis,
  documentsFormations,
  garantiePassages,
  interventions,
  mouvementsStock,
  pieces,
  projetAppareils,
  projetTechniciens,
  projets,
  users,
} from "@/db/schema";
import { CIBLE_MISSION } from "@/lib/cible-mission";
import { journaliser } from "@/lib/journal";
import { recalculerRestantes } from "@/lib/garantie-passages";
import { notifierUtilisateurs } from "@/lib/push";
import { envoyerAvisSimple } from "@/lib/mail";

// ==========================================================================
// Phase 31 — Annuler / supprimer une mission ou un projet (administrateur).
//
// Demande de Chafi : l'administrateur doit pouvoir corriger une erreur en
// retirant complètement une mission ou un projet du système. La suppression
// est définitive, mais :
//   - une trace reste au journal d'activité (qui, quand, motif, résumé) ;
//   - le stock est rétabli (pièces sorties sur la mission remises en stock) ;
//   - un passage de garantie / contrat lié redevient « à planifier » ;
//   - une demande client liée revient « prise en charge » (à replanifier) ;
//   - le technicien est prévenu si la mission n'était pas terminée.
// Les photos restent sur le disque du serveur (non visibles dans l'application).
// ==========================================================================

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const FINIS = ["terminee", "validee", "cloturee"];
const base = () => process.env.NEXTAUTH_URL || "https://robuswork.tech";
const fmt = (d: Date | null) =>
  d ? d.toLocaleString("fr-BE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "sans date";

type Avis = { technicienId: string; numero: string; date: Date | null };

/** Remet en stock les pièces des mouvements donnés, puis supprime ces mouvements. */
async function annulerMouvements(tx: Tx, filtre: ReturnType<typeof eq>) {
  const mvts = await tx.select({ id: mouvementsStock.id, pieceId: mouvementsStock.pieceId, type: mouvementsStock.type, quantite: mouvementsStock.quantite }).from(mouvementsStock).where(filtre);
  for (const mv of mvts) {
    const delta = mv.type === "sortie" ? mv.quantite : -mv.quantite;
    await tx.update(pieces).set({ quantiteStock: sql`${pieces.quantiteStock} + ${delta}` }).where(eq(pieces.id, mv.pieceId));
  }
  if (mvts.length) await tx.delete(mouvementsStock).where(inArray(mouvementsStock.id, mvts.map((x) => x.id)));
  return mvts.length;
}

/** Supprime une mission dans une transaction ; renvoie ce qu'il faut faire après. */
async function supprimerMissionTx(tx: Tx, id: string) {
  const [m] = await tx
    .select({ id: interventions.id, statut: interventions.statut, technicienId: interventions.technicienId, dateProgrammee: interventions.dateProgrammee, numero: CIBLE_MISSION })
    .from(interventions)
    .leftJoin(appareils, eq(interventions.appareilId, appareils.id))
    .where(eq(interventions.id, id))
    .limit(1);
  if (!m) return null;
  const nbMvts = await annulerMouvements(tx, eq(mouvementsStock.interventionId, id));
  const passages = await tx
    .update(garantiePassages)
    .set({ statut: "a_venir", realiseLe: null, interventionId: null })
    .where(eq(garantiePassages.interventionId, id))
    .returning({ garantieId: garantiePassages.garantieId });
  const demandes = await tx
    .update(demandesClient)
    .set({ statut: "prise_en_charge", interventionId: null })
    .where(and(eq(demandesClient.interventionId, id), inArray(demandesClient.statut, ["nouvelle", "prise_en_charge", "planifiee"])))
    .returning({ id: demandesClient.id });
  await tx.delete(interventions).where(eq(interventions.id, id));
  return {
    numero: m.numero,
    statut: m.statut,
    nbMvts,
    nbPassages: passages.length,
    nbDemandes: demandes.length,
    garanties: passages.map((p) => p.garantieId).filter((g): g is string => !!g),
    avis: m.technicienId && !FINIS.includes(m.statut) ? ({ technicienId: m.technicienId, numero: m.numero, date: m.dateProgrammee } as Avis) : null,
  };
}

function prevenirTechniciens(avis: Avis[], titre: string, motif: string) {
  if (!avis.length) return;
  after(async () => {
    const parTech = new Map<string, Avis[]>();
    for (const a of avis) parTech.set(a.technicienId, [...(parTech.get(a.technicienId) ?? []), a]);
    const techs = await db.select({ id: users.id, nom: users.nom, email: users.email }).from(users).where(inArray(users.id, [...parTech.keys()]));
    for (const t of techs) {
      const liste = parTech.get(t.id)!;
      const texte = `Annulé par le bureau et retiré de votre planning : ${liste.map((a) => (a.date ? `${a.numero} (${fmt(a.date)})` : a.numero)).join(", ")}. Motif : ${motif}`;
      await notifierUtilisateurs([t.id], { titre, corps: texte, url: "/technicien", tag: `annulation-${liste[0]!.numero}` }).catch(() => {});
      await envoyerAvisSimple({ email: t.email, nom: t.nom, titre, texte, lien: `${base()}/technicien`, bouton: "Voir mes missions" }).catch(() => {});
    }
  });
}

export async function supprimerMission(params: { id: string; motif: string; userId: string }) {
  const r = await db.transaction((tx) => supprimerMissionTx(tx, params.id));
  if (!r) return null;
  for (const g of new Set(r.garanties)) await recalculerRestantes(g);
  await journaliser({
    entite: "intervention",
    entiteId: params.id,
    action: "mission_supprimee",
    utilisateurId: params.userId,
    details: `${r.numero} (statut ${r.statut}) supprimée — motif : ${params.motif}${r.nbMvts ? ` · ${r.nbMvts} mouvement(s) de stock annulé(s)` : ""}${r.nbPassages ? " · passage remis à planifier" : ""}${r.nbDemandes ? " · demande client remise à planifier" : ""}`,
  });
  prevenirTechniciens(r.avis ? [r.avis] : [], "❌ Mission annulée", params.motif);
  return r;
}

export async function apercuSuppressionProjet(projetId: string) {
  const [missions, apps] = await Promise.all([
    db
      .select({ statut: interventions.statut, n: sql<number>`count(*)::int` })
      .from(interventions)
      .where(eq(interventions.projetId, projetId))
      .groupBy(interventions.statut),
    appareilsSupprimables(projetId),
  ]);
  const total = missions.reduce((n, x) => n + Number(x.n), 0);
  const finies = missions.filter((x) => FINIS.includes(x.statut)).reduce((n, x) => n + Number(x.n), 0);
  return { missions: total, missionsFinies: finies, appareilsSupprimables: apps.length };
}

/** Appareils du projet qui n'existent que pour lui (aucun autre projet, mission, demande…). */
async function appareilsSupprimables(projetId: string, tx: Tx | typeof db = db) {
  const rows = await tx.execute<{ id: string }>(sql`
    select pa.appareil_id as id from projet_appareils pa
    where pa.projet_id = ${projetId}
      and not exists (select 1 from projet_appareils x where x.appareil_id = pa.appareil_id and x.projet_id <> ${projetId})
      and not exists (select 1 from interventions i where i.appareil_id = pa.appareil_id and (i.projet_id is null or i.projet_id <> ${projetId}))
      and not exists (select 1 from demandes_client d where d.appareil_id = pa.appareil_id)
      and not exists (select 1 from signalements_panne s where s.appareil_id = pa.appareil_id)
      and not exists (select 1 from regles_planification r where r.appareil_id = pa.appareil_id)
  `);
  return [...rows].map((r) => r.id);
}

export async function supprimerProjet(params: { id: string; motif: string; userId: string; avecAppareils: boolean }) {
  const res = await db.transaction(async (tx) => {
    const [p] = await tx.select({ reference: projets.reference, titre: projets.titre }).from(projets).where(eq(projets.id, params.id)).limit(1);
    if (!p) return null;
    const appsASupprimer = params.avecAppareils ? await appareilsSupprimables(params.id, tx) : [];
    const ids = (await tx.select({ id: interventions.id }).from(interventions).where(eq(interventions.projetId, params.id))).map((x) => x.id);
    // Devis du projet ou de ses missions.
    const nbDevis = (
      await tx
        .delete(devis)
        .where(ids.length ? or(eq(devis.projetId, params.id), inArray(devis.interventionId, ids)) : eq(devis.projetId, params.id))
        .returning({ id: devis.id })
    ).length;
    const avis: Avis[] = [];
    const garanties: string[] = [];
    let nbMvts = 0;
    for (const id of ids) {
      const r = await supprimerMissionTx(tx, id);
      if (!r) continue;
      if (r.avis) avis.push(r.avis);
      garanties.push(...r.garanties);
      nbMvts += r.nbMvts;
    }
    nbMvts += await annulerMouvements(tx, and(eq(mouvementsStock.projetId, params.id), isNull(mouvementsStock.interventionId)) as ReturnType<typeof eq>);
    await tx.delete(documentsFormations).where(eq(documentsFormations.projetId, params.id));
    // Techniciens de l'équipe (prévenus même sans mission en cours).
    const equipe = await tx.select({ id: projetTechniciens.technicienId }).from(projetTechniciens).where(eq(projetTechniciens.projetId, params.id));
    await tx.delete(projets).where(eq(projets.id, params.id));
    let nbApps = 0;
    if (appsASupprimer.length) {
      nbApps = (await tx.delete(appareils).where(and(inArray(appareils.id, appsASupprimer), notInArray(appareils.id, tx.select({ id: projetAppareils.appareilId }).from(projetAppareils)))).returning({ id: appareils.id })).length;
    }
    return { ...p, nbMissions: ids.length, nbDevis, nbMvts, nbApps, avis, garanties, equipe: equipe.map((e) => e.id) };
  });
  if (!res) return null;
  // Les garanties du projet ont disparu avec lui : rien à recalculer pour elles.
  await journaliser({
    entite: "projet",
    entiteId: params.id,
    action: "projet_supprime",
    utilisateurId: params.userId,
    details: `${res.reference} « ${res.titre} » supprimé — motif : ${params.motif} · ${res.nbMissions} mission(s), ${res.nbDevis} devis${res.nbMvts ? `, ${res.nbMvts} mouvement(s) de stock annulé(s)` : ""}${res.nbApps ? `, ${res.nbApps} appareil(s) supprimé(s)` : ""}`,
  });
  // Équipe : ceux qui avaient des missions ouvertes reçoivent la liste ; les autres un simple avis.
  const avecMissions = new Set(res.avis.map((a) => a.technicienId));
  const autres = res.equipe.filter((t) => !avecMissions.has(t)).map((t) => ({ technicienId: t, numero: `Projet ${res.reference}`, date: null }));
  prevenirTechniciens([...res.avis, ...autres], `❌ Projet ${res.reference} annulé`, params.motif);
  return res;
}
