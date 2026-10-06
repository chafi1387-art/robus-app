import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appareils,
  clients,
  demandesClient,
  documentsFormations,
  garanties,
  interventions,
  missionNotes,
  mouvementsStock,
  pieces,
  projetAppareils,
  projets,
  projetTechniciens,
  rapportPhotos,
  rapports,
  garantiePassages,
  prestations,
  signalements,
  sites,
  users,
} from "@/db/schema";
import { passagesDAppareils } from "@/lib/garantie-passages";
import type { ReglagesAcces } from "@/lib/acces-technicien";
import { progressionMissions } from "@/lib/checklists";

// Phase 22 : fiche complète d'un appareil pour le technicien (QR code ou
// recherche), limitée aux blocs autorisés par le bureau.

const FINIS = ["terminee", "validee", "cloturee"] as const;

/** Portée « concernés » : il a (eu) une mission sur l'appareil ou est dans l'équipe d'un de ses projets. */
export async function technicienConcerne(technicienId: string, appareilId: string) {
  const [m] = await db
    .select({ id: interventions.id })
    .from(interventions)
    .where(and(eq(interventions.appareilId, appareilId), eq(interventions.technicienId, technicienId)))
    .limit(1);
  if (m) return true;
  const [p] = await db
    .select({ id: projetTechniciens.id })
    .from(projetTechniciens)
    .innerJoin(projetAppareils, eq(projetAppareils.projetId, projetTechniciens.projetId))
    .where(and(eq(projetTechniciens.technicienId, technicienId), eq(projetAppareils.appareilId, appareilId)))
    .limit(1);
  return !!p;
}

/** Recherche par n° interne, n° de série, marque, adresse, client ou référence de projet. */
export async function rechercherAppareils(q: string, technicienId: string, portee: ReglagesAcces["portee"]) {
  const t = q.trim().slice(0, 80);
  if (t.length < 2) return [];
  const motif = `%${t}%`;
  const rows = await db
    .selectDistinctOn([appareils.id], {
      id: appareils.id,
      numero: appareils.numeroInterne,
      marque: appareils.marque,
      modele: appareils.modele,
      statut: appareils.statut,
      adresse: sql<string | null>`coalesce(${projets.adresse}, ${sites.adresse})`,
      client: clients.raisonSociale,
    })
    .from(appareils)
    .leftJoin(projetAppareils, eq(projetAppareils.appareilId, appareils.id))
    .leftJoin(projets, eq(projetAppareils.projetId, projets.id))
    .leftJoin(clients, eq(projets.clientId, clients.id))
    .leftJoin(sites, eq(appareils.siteId, sites.id))
    .where(
      or(
        ilike(appareils.numeroInterne, motif),
        ilike(appareils.numeroSerie, motif),
        ilike(appareils.marque, motif),
        ilike(projets.adresse, motif),
        ilike(projets.reference, motif),
        ilike(clients.raisonSociale, motif),
        ilike(sites.adresse, motif)
      )
    )
    .orderBy(appareils.id, desc(projets.createdAt))
    .limit(60);
  let liste = rows;
  if (portee === "concernes") {
    const ok = await Promise.all(rows.map((r) => technicienConcerne(technicienId, r.id)));
    liste = rows.filter((_, i) => ok[i]);
  }
  return liste.sort((a, b) => a.numero.localeCompare(b.numero, "fr", { numeric: true })).slice(0, 30);
}

/** Les appareils de ses missions récentes / à venir (raccourcis sur la page de recherche). */
export async function appareilsRecents(technicienId: string) {
  return db
    .selectDistinctOn([appareils.id], { id: appareils.id, numero: appareils.numeroInterne, marque: appareils.marque, adresse: projets.adresse, date: interventions.dateProgrammee })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .where(and(eq(interventions.technicienId, technicienId), gte(interventions.dateProgrammee, new Date(Date.now() - 30 * 86400000))))
    .orderBy(appareils.id, desc(interventions.dateProgrammee))
    .limit(8);
}

export async function chargerFicheAppareil(appareilId: string, r: ReglagesAcces, technicienId: string) {
  const [a] = await db.select().from(appareils).where(eq(appareils.id, appareilId)).limit(1);
  if (!a) return null;
  const b = r.blocs;
  const vide = <T,>() => Promise.resolve([] as T[]);
  const maintenant = new Date();

  const [projetsAppareil, maMission, historique, passages, docs, sigs, pannes, notes, regles, aVenir] = await Promise.all([
    db
      .select({
        id: projets.id,
        reference: projets.reference,
        titre: projets.titre,
        adresse: projets.adresse,
        instructionsAcces: projets.instructionsAcces,
        contactNom: projets.contactNom,
        contactTelephone: projets.contactTelephone,
        client: clients.raisonSociale,
        garantieFin: garanties.dateFin,
        garantieDebut: garanties.dateDebut,
        garantieId: garanties.id,
      })
      .from(projetAppareils)
      .innerJoin(projets, eq(projetAppareils.projetId, projets.id))
      .innerJoin(clients, eq(projets.clientId, clients.id))
      .leftJoin(garanties, eq(garanties.projetId, projets.id))
      .where(eq(projetAppareils.appareilId, appareilId))
      .orderBy(desc(projets.createdAt)),
    db
      .select({ id: interventions.id, statut: interventions.statut, dateProgrammee: interventions.dateProgrammee })
      .from(interventions)
      .where(and(eq(interventions.appareilId, appareilId), eq(interventions.technicienId, technicienId), notInArray(interventions.statut, [...FINIS])))
      .orderBy(asc(interventions.dateProgrammee))
      .limit(1)
      .then((x) => x[0] ?? null),
    b.historique || b.techniciens
      ? db
          .select({
            id: interventions.id,
            type: interventions.type,
            statut: interventions.statut,
            date: sql<Date | null>`coalesce(${interventions.dateFin}, ${interventions.dateProgrammee})`.mapWith((v) => (v ? new Date(v) : null)),
            technicienId: interventions.technicienId,
            technicien: users.nom,
            description: interventions.description,
            travaux: rapports.travauxRealises,
            observations: rapports.observations,
            etatFinal: rapports.statutFinalAppareil,
            rapportId: rapports.id,
          })
          .from(interventions)
          .leftJoin(users, eq(interventions.technicienId, users.id))
          .leftJoin(rapports, eq(rapports.interventionId, interventions.id))
          .where(and(eq(interventions.appareilId, appareilId), inArray(interventions.statut, [...FINIS])))
          .orderBy(desc(sql`coalesce(${interventions.dateFin}, ${interventions.dateProgrammee})`))
      : vide<never>(),
    b.garantie ? passagesDAppareils([appareilId]) : Promise.resolve([] as Awaited<ReturnType<typeof passagesDAppareils>>),
    b.documents
      ? db
          .select({ id: documentsFormations.id, titre: documentsFormations.titre, url: documentsFormations.urlFichier, categorie: documentsFormations.categorie })
          .from(documentsFormations)
          .where(
            or(
              eq(documentsFormations.appareilId, appareilId),
              inArray(documentsFormations.projetId, db.select({ id: projetAppareils.projetId }).from(projetAppareils).where(eq(projetAppareils.appareilId, appareilId))),
              and(isNull(documentsFormations.appareilId), isNull(documentsFormations.projetId), a.marque ? ilike(documentsFormations.marque, a.marque) : sql`false`)
            )
          )
          .orderBy(desc(documentsFormations.createdAt))
          .limit(60)
      : vide<never>(),
    b.signalements
      ? db
          .select({ id: signalements.id, numero: signalements.numero, type: signalements.type, statut: signalements.statut, description: signalements.description, createdAt: signalements.createdAt, technicien: users.nom })
          .from(signalements)
          .innerJoin(users, eq(signalements.technicienId, users.id))
          .where(eq(signalements.appareilId, appareilId))
          .orderBy(desc(signalements.createdAt))
          .limit(20)
      : vide<never>(),
    b.signalements
      ? db
          .select({ id: demandesClient.id, numero: demandesClient.numero, type: demandesClient.type, statut: demandesClient.statut, description: demandesClient.description, createdAt: demandesClient.createdAt })
          .from(demandesClient)
          .where(and(eq(demandesClient.appareilId, appareilId), inArray(demandesClient.type, ["panne", "intervention"])))
          .orderBy(desc(demandesClient.createdAt))
          .limit(20)
      : vide<never>(),
    b.notes
      ? db
          .select({ id: missionNotes.id, type: missionNotes.type, titre: missionNotes.titre, texte: missionNotes.texte, createdAt: missionNotes.createdAt, regleLe: missionNotes.regleLe })
          .from(missionNotes)
          .innerJoin(interventions, eq(missionNotes.interventionId, interventions.id))
          .where(and(eq(interventions.appareilId, appareilId), isNull(missionNotes.archiveLe), inArray(missionNotes.type, ["commentaire", "piece_manquante"])))
          .orderBy(desc(missionNotes.createdAt))
          .limit(20)
      : vide<never>(),
    b.prochaine
      ? // Phase 24 : prochains passages de contrat pas encore transformés en mission.
        db
          .select({
            date: garantiePassages.datePrevue,
            type: sql<string>`coalesce(${prestations.typeMission}::text, 'preventive')`,
            libelle: sql<string>`${prestations.description} || ' ' || ${garantiePassages.numero} || '/' || ${garantiePassages.total}`,
          })
          .from(garantiePassages)
          .innerJoin(prestations, eq(garantiePassages.prestationId, prestations.id))
          .where(
            and(
              eq(garantiePassages.appareilId, appareilId),
              eq(garantiePassages.statut, "a_venir"),
              isNull(garantiePassages.interventionId),
              gte(garantiePassages.datePrevue, maintenant)
            )
          )
          .orderBy(asc(garantiePassages.datePrevue))
          .limit(2)
      : vide<never>(),
    b.prochaine
      ? db
          .select({ id: interventions.id, date: interventions.dateProgrammee, type: interventions.type, technicien: users.nom, technicienId: interventions.technicienId })
          .from(interventions)
          .leftJoin(users, eq(interventions.technicienId, users.id))
          .where(and(eq(interventions.appareilId, appareilId), notInArray(interventions.statut, [...FINIS, "en_cours"]), gte(interventions.dateProgrammee, maintenant)))
          .orderBy(asc(interventions.dateProgrammee))
          .limit(3)
      : vide<never>(),
  ]);

  // Photos et pièces de l'historique (une requête chacune, pas une par mission).
  const ids = historique.map((h) => h.id);
  const rapportIds = historique.map((h) => h.rapportId).filter((x): x is string => !!x);
  const [photos, piecesUtilisees, progCl] = await Promise.all([
    b.historique && rapportIds.length
      ? db.select({ rapportId: rapportPhotos.rapportId, url: rapportPhotos.url }).from(rapportPhotos).where(inArray(rapportPhotos.rapportId, rapportIds))
      : Promise.resolve([] as { rapportId: string; url: string }[]),
    b.historique && ids.length
      ? db
          .select({ interventionId: mouvementsStock.interventionId, quantite: mouvementsStock.quantite, nom: pieces.nom, reference: pieces.reference, type: mouvementsStock.type })
          .from(mouvementsStock)
          .innerJoin(pieces, eq(mouvementsStock.pieceId, pieces.id))
          .where(inArray(mouvementsStock.interventionId, ids))
      : Promise.resolve([] as { interventionId: string | null; quantite: number; nom: string; reference: string; type: string }[]),
    // Phase 23 : résultat des checklists par intervention.
    b.historique && ids.length ? progressionMissions(ids) : Promise.resolve(new Map<string, { total: number; faites: number; nok: number }>()),
  ]);

  // Pièces nettes par mission (sorties − retours).
  const piecesParMission = new Map<string, { nom: string; reference: string; quantite: number }[]>();
  for (const p of piecesUtilisees) {
    if (!p.interventionId) continue;
    const liste = piecesParMission.get(p.interventionId) ?? [];
    const ex = liste.find((x) => x.reference === p.reference);
    const q = p.type === "sortie" ? p.quantite : -p.quantite;
    if (ex) ex.quantite += q;
    else liste.push({ nom: p.nom, reference: p.reference, quantite: q });
    piecesParMission.set(p.interventionId, liste);
  }

  // Techniciens déjà passés.
  const parTech = new Map<string, { nom: string; passages: number; dernier: Date | null }>();
  for (const h of historique) {
    if (!h.technicienId) continue;
    const t = parTech.get(h.technicienId) ?? { nom: h.technicien ?? "—", passages: 0, dernier: null };
    t.passages++;
    if (h.date && (!t.dernier || h.date > t.dernier)) t.dernier = h.date;
    parTech.set(h.technicienId, t);
  }

  const garantieActive = projetsAppareil.find((p) => p.garantieFin && p.garantieFin >= maintenant) ?? null;
  const projetCourant = projetsAppareil[0] ?? null;
  const prochaines = [
    ...aVenir.filter((m) => m.date).map((m) => ({ date: m.date as Date, type: m.type as string, technicien: m.technicien, source: "mission" as const })),
    ...regles.map((x) => ({ date: x.date, type: `contrat · ${x.libelle}`, technicien: null as string | null, source: "planification" as const })),
    ...passages.filter((p) => p.etat !== "realise" && p.garantieId).map((p) => ({ date: p.mDate ?? p.datePrevue, type: `garantie ${p.numero}/${p.total}`, technicien: p.technicien, source: "garantie" as const })),
  ].sort((x, y) => x.date.getTime() - y.date.getTime());

  return {
    appareil: a,
    projetCourant,
    projets: projetsAppareil,
    maMission,
    garantie: garantieActive
      ? {
          fin: garantieActive.garantieFin!,
          debut: garantieActive.garantieDebut,
          projetRef: garantieActive.reference,
          passagesFaits: passages.filter((p) => p.etat === "realise" && p.garantieId === garantieActive.garantieId).length,
          passagesTotal: passages.filter((p) => p.garantieId === garantieActive.garantieId).length,
        }
      : null,
    prochaines: prochaines.slice(0, 3),
    historique: historique.map((h) => ({
      ...h,
      photos: photos.filter((p) => p.rapportId === h.rapportId).map((p) => p.url),
      pieces: (piecesParMission.get(h.id) ?? []).filter((p) => p.quantite > 0),
      checklist: progCl.get(h.id) ?? null,
    })),
    techniciens: [...parTech.values()].sort((x, y) => (y.dernier?.getTime() ?? 0) - (x.dernier?.getTime() ?? 0)),
    documents: docs,
    signalements: sigs,
    pannes,
    notes,
  };
}
