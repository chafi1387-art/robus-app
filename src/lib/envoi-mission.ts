import "server-only";
import { after } from "next/server";
import { db } from "@/db";
import {
  appareils,
  clients,
  documentsFormations,
  interventions,
  ordresMissionEnvois,
  prestations,
  projetAppareils,
  projets,
  users,
} from "@/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { envoyerOrdreDeMission } from "@/lib/mail";
import { notifierBureau, notifierUtilisateurs } from "@/lib/push";
import { journaliser } from "@/lib/journal";
import { notifierObservateurs } from "@/lib/observateur";
import { demandesMissionPlanifiee } from "@/lib/demandes";

// Phase 17 : envoi d'une (ou plusieurs) mission(s) au technicien — logique
// unique utilisée partout (création, affectation, ajout à un projet,
// remplacement, renvoi). Trois canaux : l'application (section « Nouvelles
// missions »), la notification sur le téléphone, l'email. Le suivi
// (envoyée / vue / acceptée, résultat email et push) est enregistré sur
// chaque mission pour que le bureau sache si le technicien l'a bien reçue.

export const STATUTS_NON_COMMENCES = ["creee", "planifiee", "affectee"] as const;

const TYPE_LABEL: Record<string, string> = {
  preventive: "Préventive",
  corrective: "Corrective",
  systematique: "Systématique",
};

function formatCourt(d: Date) {
  return d.toLocaleString("fr-BE", {
    timeZone: "Europe/Brussels",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function envoyerMissionsAuTechnicien(params: {
  projetId: string;
  technicienId: string;
  /** Missions précises à envoyer. Absent = toutes ses missions non commencées du projet. */
  interventionIds?: string[];
  message?: string;
  documentsIds?: string[];
  envoyeParId: string;
}) {
  const [contexte] = await db
    .select({
      reference: projets.reference,
      titre: projets.titre,
      dateDebutPrevue: projets.dateDebutPrevue,
      adresse: projets.adresse,
      clientNom: clients.raisonSociale,
    })
    .from(projets)
    .innerJoin(clients, eq(projets.clientId, clients.id))
    .where(eq(projets.id, params.projetId))
    .limit(1);

  const [technicien] = await db
    .select({ nom: users.nom, email: users.email })
    .from(users)
    .where(eq(users.id, params.technicienId))
    .limit(1);

  const filtreMissions = params.interventionIds
    ? params.interventionIds.length
      ? and(inArray(interventions.id, params.interventionIds), eq(interventions.technicienId, params.technicienId))
      : null
    : and(
        eq(interventions.projetId, params.projetId),
        eq(interventions.technicienId, params.technicienId),
        inArray(interventions.statut, [...STATUTS_NON_COMMENCES])
      );

  const [appareilsAttaches, prestationsAttachees, missions] = await Promise.all([
    db
      .select({ numeroInterne: appareils.numeroInterne })
      .from(projetAppareils)
      .innerJoin(appareils, eq(projetAppareils.appareilId, appareils.id))
      .where(eq(projetAppareils.projetId, params.projetId)),
    db
      .select({ type: prestations.type, description: prestations.description })
      .from(prestations)
      .where(eq(prestations.projetId, params.projetId)),
    filtreMissions
      ? db
          .select({
            id: interventions.id,
            type: interventions.type,
            dateProgrammee: interventions.dateProgrammee,
            numero: appareils.numeroInterne,
            appareilId: interventions.appareilId,
          })
          .from(interventions)
          .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
          .where(filtreMissions)
          .orderBy(interventions.dateProgrammee)
      : Promise.resolve([] as { id: string; type: string; dateProgrammee: Date | null; numero: string; appareilId: string }[]),
  ]);

  const documentsIdsDemandes = [...new Set((params.documentsIds ?? []).filter(Boolean))];
  let documentsResolus: { id: string; titre: string; urlFichier: string }[] = [];
  if (documentsIdsDemandes.length > 0) {
    const rows = await db
      .select({ id: documentsFormations.id, titre: documentsFormations.titre, urlFichier: documentsFormations.urlFichier })
      .from(documentsFormations)
      .where(and(inArray(documentsFormations.id, documentsIdsDemandes), isNotNull(documentsFormations.urlFichier)));
    documentsResolus = rows.map((d) => ({ id: d.id, titre: d.titre, urlFichier: d.urlFichier as string }));
  }

  const missionIds = missions.map((m) => m.id);
  const maintenant = new Date();
  if (missionIds.length) {
    // Nouvel envoi = nouvel accusé de réception attendu.
    await db
      .update(interventions)
      .set({ envoyeeLe: maintenant, vueLe: null, accepteeLe: null, alerteNonVueLe: null, envoiEmail: null, envoiPush: null, refuseeLe: null, refusMotif: null, refusCommentaire: null })
      .where(inArray(interventions.id, missionIds));
  }

  await db.insert(ordresMissionEnvois).values({
    projetId: params.projetId,
    technicienId: params.technicienId,
    message: params.message?.trim() ? params.message.trim() : null,
    documentsJointIds: documentsResolus.map((d) => d.id),
    envoyeParId: params.envoyeParId,
  });

  if (!contexte || !technicien) return { missions: missionIds.length };

  // Email et notification partent APRÈS la réponse : le bureau n'attend pas
  // le serveur de messagerie (l'écran se met à jour immédiatement).
  after(async () => {
    try {
      const premiere = missions[0];
      const [resultatEmail, nbPush] = await Promise.all([
        envoyerOrdreDeMission({
          projetId: params.projetId,
          destinataireEmail: technicien.email,
          destinataireNom: technicien.nom,
          projetReference: contexte.reference,
          projetTitre: contexte.titre,
          clientNom: contexte.clientNom,
          adresses: contexte.adresse ? [contexte.adresse] : [],
          appareils: appareilsAttaches.map((a) => a.numeroInterne),
          prestations: prestationsAttachees.map((p) => p.description || p.type || "Prestation"),
          dateDebutPrevue: premiere?.dateProgrammee ?? contexte.dateDebutPrevue,
          message: params.message,
          documents: documentsResolus.map((d) => ({ titre: d.titre, url: d.urlFichier })),
          missions: missions.map((m) => ({ date: m.dateProgrammee, appareil: m.numero, type: TYPE_LABEL[m.type] ?? m.type })),
        }),
        notifierUtilisateurs([params.technicienId], {
          titre: missions.length > 1 ? `📋 ${missions.length} nouvelles missions` : `📋 Nouvelle mission — ${contexte.reference}`,
          corps: premiere
            ? `${premiere.dateProgrammee ? formatCourt(premiere.dateProgrammee) + " · " : ""}${premiere.numero} · ${contexte.clientNom}`
            : `${contexte.titre} · ${contexte.clientNom}`,
          url: missions.length === 1 ? `/technicien/interventions/${missions[0].id}` : "/technicien",
          tag: missions.length === 1 ? `mission-${missions[0].id}` : `projet-${params.projetId}`,
        }),
      ]);

      if (missionIds.length) {
        await db
          .update(interventions)
          .set({ envoiEmail: resultatEmail, envoiPush: nbPush })
          .where(inArray(interventions.id, missionIds));
      }
      if (resultatEmail === "echec") {
        await notifierBureau({
          titre: "⚠️ Email de mission non parti",
          corps: `${technicien.nom} · ${contexte.reference} — vérifiez son adresse email`,
          url: `/responsable/projets/${params.projetId}?tab=missions`,
          tag: `email-echec-${params.projetId}`,
        });
      }
      // Phase 20 : demandes client liées -> « Intervention planifiée » (client prévenu).
      await demandesMissionPlanifiee(missionIds);
      // Phase 18 : l'observateur du client est prévenu de la date prévue.
      for (const m of missions) {
        await notifierObservateurs(
          m.appareilId,
          "temps_reel",
          {
            titre: "📅 Intervention planifiée",
            corps: `Ascenseur ${m.numero}${m.dateProgrammee ? ` — prévue le ${formatCourt(m.dateProgrammee)}` : ""}.`,
            url: `/observateur/appareils/${m.appareilId}`,
          },
          true
        );
      }
      if (nbPush === 0) {
        await journaliser({
          entite: "projet",
          entiteId: params.projetId,
          action: "push_non_recu",
          utilisateurId: params.envoyeParId,
          details: `${technicien.nom} n'a pas activé les notifications sur son téléphone`,
        });
      }
    } catch (e) {
      console.error("Envoi mission", e);
    }
  });

  return { missions: missionIds.length };
}
