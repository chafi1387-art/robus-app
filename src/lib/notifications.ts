import { db } from "@/db";
import {
  appareils,
  demandesAide,
  documentsFormations,
  habilitationsTechnicien,
  instrumentsMesure,
  interventions,
  nonConformites,
  pushAbonnements,
  reglesPlanification,
  signalementsPanne,
  users,
} from "@/db/schema";
import { and, eq, inArray, isNotNull, isNull, lt, ne, notExists, sql } from "drizzle-orm";

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
    db
      .select({
        id: reglesPlanification.id,
        prochaineDate: reglesPlanification.prochaineDate,
        anticipationJours: reglesPlanification.anticipationJours,
        numeroInterne: appareils.numeroInterne,
      })
      .from(reglesPlanification)
      .innerJoin(appareils, eq(reglesPlanification.appareilId, appareils.id))
      .where(eq(reglesPlanification.actif, 1)),
    db
      .select({
        id: habilitationsTechnicien.id,
        dateExpiration: habilitationsTechnicien.dateExpiration,
        technicien: users.nom,
        document: documentsFormations.titre,
      })
      .from(habilitationsTechnicien)
      .innerJoin(users, eq(habilitationsTechnicien.technicienId, users.id))
      .innerJoin(documentsFormations, eq(habilitationsTechnicien.documentId, documentsFormations.id))
      .where(isNotNull(habilitationsTechnicien.dateExpiration)),
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
    // Phase 18 : panne signalée (observateur ou QR code) pas encore affectée.
    db
      .select({ id: interventions.id, numero: appareils.numeroInterne })
      .from(signalementsPanne)
      .innerJoin(interventions, eq(signalementsPanne.interventionId, interventions.id))
      .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
      .where(and(isNull(interventions.technicienId), inArray(interventions.statut, ["creee", "planifiee"]))),
  ]);

  for (const p of pannesSignalees) {
    notifications.push({ id: `panne-signalee-${p.id}`, gravite: "crit", titre: `Panne signalée par le client — ${p.numero} (à affecter)`, href: `/responsable/missions/${p.id}` });
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
    if (r.prochaineDate <= dansNJours(r.anticipationJours)) {
      notifications.push({
        id: `planif-${r.id}`,
        gravite: r.prochaineDate < now ? "crit" : "warn",
        titre: `Échéance planning — ${r.numeroInterne}`,
        href: "/responsable/planification",
      });
    }
  }

  for (const h of habilitations) {
    if (!h.dateExpiration) continue;
    if (h.dateExpiration < now) {
      notifications.push({
        id: `habilitation-${h.id}`,
        gravite: "crit",
        titre: `Habilitation expirée — ${h.technicien} (${h.document})`,
        href: "/responsable/documents",
      });
    } else if (h.dateExpiration < limite30) {
      notifications.push({
        id: `habilitation-${h.id}`,
        gravite: "warn",
        titre: `Habilitation à échéance sous 30 j — ${h.technicien} (${h.document})`,
        href: "/responsable/documents",
      });
    }
  }

  notifications.sort((a, b) => (a.gravite === b.gravite ? 0 : a.gravite === "crit" ? -1 : 1));
  return notifications;
}
