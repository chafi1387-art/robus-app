import { db } from "@/db";
import { contratsARenouveler } from "@/lib/contrats";
import {
  appareils,
  demandesAide,
  documentsFormations,
  habilitationsTechnicien,
  instrumentsMesure,
  interventions,
  nonConformites,
  pushAbonnements,
  demandesClient,
  formationsParticipants,
  formationsSessions,
  missionChecklistTaches,
  missionChecklists,
  signalements,
  users,
} from "@/db/schema";
import { TYPES_SIGNALEMENT } from "@/lib/signalements-types";
import { libelleRefus } from "@/lib/missions";
import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, notExists, sql } from "drizzle-orm";
import { habilitationsCourantes } from "@/lib/habilitations";

export type Notification = {
  id: string;
  gravite: "crit" | "warn";
  titre: string;
  href: string;
};

const NON_COMMENCES = ["creee", "planifiee", "affectee"] as const;

/**
 * Alertes calculées dynamiquement à chaque affichage (pas de table dédiée :
 * l'état réel des données fait foi, jamais désynchronisé d'un job planifié).
 * Phase 17 : toutes les requêtes partent en parallèle (affichée sur chaque
 * page du bureau — c'était une cause de lenteur) + alertes d'envoi de mission.
 */
export async function getNotifications(): Promise<Notification[]> {
  const now = new Date();
  const dansNJours = (n: number) => new Date(now.getTime() + n * 86400000);
  const il30min = new Date(now.getTime() - 30 * 60 * 1000);
  const notifications: Notification[] = [];

  const [
    appareilsEnPanne,
    demandesAideOuvertes,
    interventionsEnRetard,
    ncEnRetard,
    instruments,
    regles,
    habilitations,
    missionsNonVues,
    emailsEchec,
    techSansNotif,
    pannesSignalees,
    signalementsNouveaux,
    missionsRefusees,
    formationsReponses,
    techniciens,
    pointsNok,
  ] = await Promise.all([
    db
      .select({ id: appareils.id, numeroInterne: appareils.numeroInterne })
      .from(appareils)
      .where(eq(appareils.statut, "en_panne")),
    // Phase 6 : "Besoin d'aide" du technicien -> bureau, priorité maximale.
    db
      .select({ id: demandesAide.id, technicienNom: users.nom, numeroInterne: appareils.numeroInterne })
      .from(demandesAide)
      .innerJoin(users, eq(demandesAide.technicienId, users.id))
      .innerJoin(interventions, eq(demandesAide.interventionId, interventions.id))
      .leftJoin(appareils, eq(interventions.appareilId, appareils.id))
      .where(eq(demandesAide.resolue, 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(interventions)
      .where(
        and(lt(interventions.dateProgrammee, now), sql`${interventions.statut} not in ('terminee','validee','cloturee')`)
      )
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(nonConformites)
      .where(and(ne(nonConformites.statut, "cloturee"), isNotNull(nonConformites.dateEcheance), lt(nonConformites.dateEcheance, now)))
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ id: instrumentsMesure.id, nom: instrumentsMesure.nom, dateProchainEtalonnage: instrumentsMesure.dateProchainEtalonnage })
      .from(instrumentsMesure)
      .where(isNotNull(instrumentsMesure.dateProchainEtalonnage)),
    // Phase 24 : contrats à passages qui se terminent (60 j) — à renouveler.
    contratsARenouveler(),
    habilitationsCourantes(),
    // Phase 17 : mission envoyée depuis plus de 30 min et pas encore ouverte.
    db
      .select({ id: interventions.id, projetId: interventions.projetId, technicien: users.nom, numero: appareils.numeroInterne })
      .from(interventions)
      .innerJoin(users, eq(interventions.technicienId, users.id))
      .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
      .where(
        and(
          inArray(interventions.statut, [...NON_COMMENCES]),
          isNull(interventions.vueLe),
          isNotNull(interventions.envoyeeLe),
          lt(interventions.envoyeeLe, il30min)
        )
      ),
    // Phase 17 : email de mission non parti.
    db
      .select({ id: interventions.id, projetId: interventions.projetId, technicien: users.nom })
      .from(interventions)
      .innerJoin(users, eq(interventions.technicienId, users.id))
      .where(
        and(
          inArray(interventions.statut, [...NON_COMMENCES]),
          isNull(interventions.vueLe),
          eq(interventions.envoiEmail, "echec")
        )
      ),
    // Phase 17 : technicien avec des missions ouvertes mais sans notifications sur son téléphone.
    db
      .selectDistinct({ id: users.id, nom: users.nom })
      .from(users)
      .innerJoin(interventions, eq(interventions.technicienId, users.id))
      .where(
        and(
          eq(users.role, "technicien"),
          eq(users.actif, 1),
          inArray(interventions.statut, [...NON_COMMENCES]),
          notExists(db.select({ x: sql`1` }).from(pushAbonnements).where(eq(pushAbonnements.userId, users.id)))
        )
      ),
    // Phase 20 : demandes client pas encore prises en charge.
    db
      .select({ id: demandesClient.id, numero: demandesClient.numero, type: demandesClient.type, personneBloquee: demandesClient.personneBloquee, appareil: appareils.numeroInterne })
      .from(demandesClient)
      .innerJoin(appareils, eq(demandesClient.appareilId, appareils.id))
      .where(eq(demandesClient.statut, "nouvelle")),
    // Phase 21 : signalements des techniciens pas encore pris en charge.
    db
      .select({ id: signalements.id, numero: signalements.numero, type: signalements.type, gravite: signalements.gravite, blesse: signalements.blesse, technicien: users.nom })
      .from(signalements)
      .innerJoin(users, eq(signalements.technicienId, users.id))
      .where(eq(signalements.statut, "nouveau")),
    // Phase 21 : missions refusées par le technicien — décision du bureau attendue.
    db
      .select({ id: interventions.id, technicien: users.nom, numero: appareils.numeroInterne, motif: interventions.refusMotif })
      .from(interventions)
      .innerJoin(users, eq(interventions.technicienId, users.id))
      .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
      .where(and(isNotNull(interventions.refuseeLe), inArray(interventions.statut, [...NON_COMMENCES]))),
    // Phase 21 : formations à venir — technicien indisponible, ou sans réponse à 3 jours.
    db
      .select({
        sessionId: formationsSessions.id,
        titre: formationsSessions.titre,
        dateDebut: formationsSessions.dateDebut,
        reponse: formationsParticipants.reponse,
        participantId: formationsParticipants.id,
        technicien: users.nom,
      })
      .from(formationsParticipants)
      .innerJoin(formationsSessions, eq(formationsParticipants.sessionId, formationsSessions.id))
      .innerJoin(users, eq(formationsParticipants.technicienId, users.id))
      .where(
        and(
          eq(formationsSessions.statut, "planifiee"),
          gt(formationsSessions.dateDebut, now),
          sql`(${formationsParticipants.reponse} = 'indisponible' or (${formationsParticipants.reponse} is null and ${formationsSessions.dateDebut} < ${dansNJours(3).toISOString()}::timestamp))`
        )
      ),
    db.select({ id: users.id, nom: users.nom }).from(users).where(eq(users.role, "technicien")),
    // Phase 23 : points de checklist non conformes pas encore traités par le bureau.
    db
      .select({ id: missionChecklistTaches.id, libelle: missionChecklistTaches.libelle, interventionId: missionChecklists.interventionId, numero: appareils.numeroInterne })
      .from(missionChecklistTaches)
      .innerJoin(missionChecklists, eq(missionChecklistTaches.missionChecklistId, missionChecklists.id))
      .innerJoin(interventions, eq(missionChecklists.interventionId, interventions.id))
      .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
      .where(and(eq(missionChecklistTaches.resultat, "nok"), isNull(missionChecklistTaches.traiteLe)))
      .limit(50),
  ]);

  for (const p of pointsNok) {
    notifications.push({ id: `checklist-${p.id}`, gravite: "warn", titre: `Checklist ✗ ${p.numero} : ${p.libelle} — à traiter`, href: `/responsable/missions/${p.interventionId}#checklist` });
  }

  for (const sg of signalementsNouveaux) {
    const t = TYPES_SIGNALEMENT[sg.type];
    notifications.push({
      id: `signalement-${sg.id}`,
      gravite: sg.gravite === "normale" ? "warn" : "crit",
      titre: `${sg.blesse ? "URGENT — blessé · " : ""}Signalement ${t?.label.toLowerCase() ?? sg.type} — ${sg.technicien} (${sg.numero})`,
      href: `/responsable/signalements/${sg.id}`,
    });
  }
  for (const m of missionsRefusees) {
    notifications.push({
      id: `refus-${m.id}`,
      gravite: "crit",
      titre: `Mission refusée — ${m.technicien} (${m.numero}) : ${libelleRefus(m.motif)} — à décider`,
      href: `/responsable/missions/${m.id}`,
    });
  }
  for (const f of formationsReponses) {
    notifications.push({
      id: `formation-${f.participantId}`,
      gravite: "warn",
      titre: f.reponse === "indisponible" ? `${f.technicien} indisponible pour la formation « ${f.titre} »` : `${f.technicien} n'a pas confirmé la formation « ${f.titre} » (${f.dateDebut.toLocaleDateString("fr-BE")})`,
      href: `/responsable/habilitations/sessions/${f.sessionId}`,
    });
  }

  for (const p of pannesSignalees) {
    notifications.push({
      id: `demande-${p.id}`,
      gravite: p.type === "panne" ? "crit" : "warn",
      titre: `${p.personneBloquee ? "URGENT — personne bloquée" : p.type === "panne" ? "Panne client" : "Demande client"} ${p.numero} — ${p.appareil} (à prendre en charge)`,
      href: `/responsable/demandes/${p.id}`,
    });
  }

  for (const a of appareilsEnPanne) {
    notifications.push({ id: `panne-${a.id}`, gravite: "crit", titre: `Appareil ${a.numeroInterne} en panne`, href: `/responsable/appareils/${a.id}` });
  }

  for (const d of demandesAideOuvertes) {
    notifications.push({
      id: `aide-${d.id}`,
      gravite: "crit",
      titre: `Besoin d'aide — ${d.technicienNom} sur ${d.numeroInterne ?? "appareil inconnu"}`,
      href: "/responsable/interventions",
    });
  }

  for (const m of missionsNonVues) {
    notifications.push({
      id: `non-vue-${m.id}`,
      gravite: "crit",
      titre: `Mission non vue depuis 30 min — ${m.technicien} (${m.numero})`,
      href: m.projetId ? `/responsable/projets/${m.projetId}?tab=missions` : "/responsable/interventions",
    });
  }

  for (const m of emailsEchec) {
    notifications.push({
      id: `email-echec-${m.id}`,
      gravite: "crit",
      titre: `Email de mission non parti — ${m.technicien}`,
      href: m.projetId ? `/responsable/projets/${m.projetId}?tab=missions` : "/responsable/interventions",
    });
  }

  for (const t of techSansNotif) {
    notifications.push({
      id: `sans-notif-${t.id}`,
      gravite: "warn",
      titre: `${t.nom} n'a pas activé les notifications sur son téléphone`,
      href: `/responsable/techniciens/${t.id}`,
    });
  }

  if (interventionsEnRetard > 0) {
    notifications.push({
      id: "interventions-retard",
      gravite: "crit",
      titre: `${interventionsEnRetard} intervention(s) en retard`,
      href: "/responsable/interventions",
    });
  }

  if (ncEnRetard > 0) {
    notifications.push({
      id: "nc-retard",
      gravite: "crit",
      titre: `${ncEnRetard} non-conformité(s) ayant dépassé leur échéance`,
      href: "/responsable/non-conformites",
    });
  }

  const limite30 = dansNJours(30);
  for (const i of instruments) {
    if (!i.dateProchainEtalonnage) continue;
    if (i.dateProchainEtalonnage < now) {
      notifications.push({ id: `etalonnage-${i.id}`, gravite: "crit", titre: `Étalonnage dépassé — ${i.nom}`, href: "/responsable/etalonnage" });
    } else if (i.dateProchainEtalonnage < limite30) {
      notifications.push({ id: `etalonnage-${i.id}`, gravite: "warn", titre: `Étalonnage à échéance sous 30 j — ${i.nom}`, href: "/responsable/etalonnage" });
    }
  }

  for (const r of regles) {
    notifications.push({
      id: `contrat-fin-${r.id}`,
      gravite: r.dateFin && r.dateFin < now ? "crit" : "warn",
      titre: `Contrat ${r.dateFin && r.dateFin < now ? "terminé" : "qui se termine"} — ${r.client} · ${r.titre ?? "contrat"} — renouveler ?`,
      href: `/responsable/projets/${r.projetId}?tab=garantie#contrats`,
    });
  }

  // Phase 19 : statut calculé selon le catalogue (délai d'alerte propre à chaque habilitation).
  const nomsTech = new Map(techniciens.map((u) => [u.id, u.nom]));
  for (const h of habilitations) {
    const qui = nomsTech.get(h.technicienId) ?? "Technicien";
    if (h.etat === "expiree") {
      notifications.push({ id: `habilitation-${h.id}`, gravite: "crit", titre: `Habilitation expirée — ${qui} (${h.nom})`, href: `/responsable/techniciens/${h.technicienId}?tab=habilitations` });
    } else if (h.etat === "bientot") {
      notifications.push({ id: `habilitation-${h.id}`, gravite: "warn", titre: `Habilitation à renouveler — ${qui} (${h.nom}, ${h.dateExpiration?.toLocaleDateString("fr-BE")})`, href: `/responsable/techniciens/${h.technicienId}?tab=habilitations` });
    } else if (h.etat === "en_attente") {
      notifications.push({ id: `habilitation-${h.id}`, gravite: "warn", titre: `Certificat à valider — ${qui} (${h.nom})`, href: `/responsable/techniciens/${h.technicienId}?tab=habilitations` });
    }
  }

  notifications.sort((a, b) => (a.gravite === b.gravite ? 0 : a.gravite === "crit" ? -1 : 1));
  return notifications;
}
