import { db } from "@/db";
import {
  appareils,
  demandesAide,
  documentsFormations,
  habilitationsTechnicien,
  instrumentsMesure,
  interventions,
  nonConformites,
  reglesPlanification,
  users,
} from "@/db/schema";
import { and, eq, isNotNull, lt, ne, sql } from "drizzle-orm";

const JOUR_MS = 24 * 60 * 60 * 1000;

export type Notification = {
  id: string;
  gravite: "crit" | "warn";
  titre: string;
  href: string;
};

/**
 * Alertes calculées dynamiquement à chaque affichage (pas de table dédiée :
 * l'état réel des données fait foi, jamais désynchronisé d'un job planifié).
 */
export async function getNotifications(): Promise<Notification[]> {
  const now = new Date();
  const dansNJours = (n: number) => new Date(now.getTime() + n * 86400000);
  const notifications: Notification[] = [];

  const appareilsEnPanne = await db
    .select({ id: appareils.id, numeroInterne: appareils.numeroInterne })
    .from(appareils)
    .where(eq(appareils.statut, "en_panne"));
  for (const a of appareilsEnPanne) {
    notifications.push({
      id: `panne-${a.id}`,
      gravite: "crit",
      titre: `Appareil ${a.numeroInterne} en panne`,
      href: `/responsable/appareils/${a.id}`,
    });
  }

  // Phase 6 : "Besoin d'aide" du technicien -> bureau, priorité maximale.
  const demandesAideOuvertes = await db
    .select({
      id: demandesAide.id,
      technicienNom: users.nom,
      numeroInterne: appareils.numeroInterne,
    })
    .from(demandesAide)
    .innerJoin(users, eq(demandesAide.technicienId, users.id))
    .innerJoin(interventions, eq(demandesAide.interventionId, interventions.id))
    .leftJoin(appareils, eq(interventions.appareilId, appareils.id))
    .where(eq(demandesAide.resolue, 0));
  for (const d of demandesAideOuvertes) {
    notifications.push({
      id: `aide-${d.id}`,
      gravite: "crit",
      titre: `Besoin d'aide — ${d.technicienNom} sur ${d.numeroInterne ?? "appareil inconnu"}`,
      href: "/responsable/interventions",
    });
  }

  const interventionsEnRetard = await db
    .select({ id: interventions.id })
    .from(interventions)
    .where(
      and(
        lt(interventions.dateProgrammee, now),
        sql`${interventions.statut} not in ('terminee','validee','cloturee')`
      )
    );
  if (interventionsEnRetard.length > 0) {
    notifications.push({
      id: "interventions-retard",
      gravite: "crit",
      titre: `${interventionsEnRetard.length} intervention(s) en retard`,
      href: "/responsable/interventions",
    });
  }

  const ncEnRetard = await db
    .select({ id: nonConformites.id })
    .from(nonConformites)
    .where(
      and(ne(nonConformites.statut, "cloturee"), isNotNull(nonConformites.dateEcheance), lt(nonConformites.dateEcheance, now))
    );
  if (ncEnRetard.length > 0) {
    notifications.push({
      id: "nc-retard",
      gravite: "crit",
      titre: `${ncEnRetard.length} non-conformité(s) ayant dépassé leur échéance`,
      href: "/responsable/non-conformites",
    });
  }

  const instruments = await db
    .select({ id: instrumentsMesure.id, nom: instrumentsMesure.nom, dateProchainEtalonnage: instrumentsMesure.dateProchainEtalonnage })
    .from(instrumentsMesure)
    .where(isNotNull(instrumentsMesure.dateProchainEtalonnage));
  const limite30 = dansNJours(30);
  for (const i of instruments) {
    if (!i.dateProchainEtalonnage) continue;
    if (i.dateProchainEtalonnage < now) {
      notifications.push({
        id: `etalonnage-${i.id}`,
        gravite: "crit",
        titre: `Étalonnage dépassé — ${i.nom}`,
        href: "/responsable/etalonnage",
      });
    } else if (i.dateProchainEtalonnage < limite30) {
      notifications.push({
        id: `etalonnage-${i.id}`,
        gravite: "warn",
        titre: `Étalonnage à échéance sous 30 j — ${i.nom}`,
        href: "/responsable/etalonnage",
      });
    }
  }

  const regles = await db
    .select({
      id: reglesPlanification.id,
      appareilId: reglesPlanification.appareilId,
      prochaineDate: reglesPlanification.prochaineDate,
      anticipationJours: reglesPlanification.anticipationJours,
      numeroInterne: appareils.numeroInterne,
    })
    .from(reglesPlanification)
    .innerJoin(appareils, eq(reglesPlanification.appareilId, appareils.id))
    .where(eq(reglesPlanification.actif, 1));
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

  const habilitations = await db
    .select({
      id: habilitationsTechnicien.id,
      dateExpiration: habilitationsTechnicien.dateExpiration,
      technicien: users.nom,
      document: documentsFormations.titre,
    })
    .from(habilitationsTechnicien)
    .innerJoin(users, eq(habilitationsTechnicien.technicienId, users.id))
    .innerJoin(documentsFormations, eq(habilitationsTechnicien.documentId, documentsFormations.id))
    .where(isNotNull(habilitationsTechnicien.dateExpiration));
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
