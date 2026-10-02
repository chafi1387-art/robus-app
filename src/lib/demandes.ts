import "server-only";
import { attribuerParDefaut } from "@/lib/checklists";
import { db } from "@/db";
import {
  appareils,
  clients,
  demandesClient,
  demandesMessages,
  interventions,
  observateurs,
  projets,
  users,
  type FichierJoint,
} from "@/db/schema";
import { and, desc, eq, gte, inArray, isNull, like, sql } from "drizzle-orm";
import { after } from "next/server";
import { journaliser } from "@/lib/journal";
import { notifierBureau, notifierUtilisateurs } from "@/lib/push";
import { envoyerAlerteDemande, envoyerAvisObservateur } from "@/lib/mail";
import { adressesAppareils, dernierProjetAppareil, getParametre } from "@/lib/observateur";

// ==========================================================================
// Phase 20 — Demandes client : panne, demande d'intervention, question /
// réclamation, demande de document / devis. Numérotées, suivies par statut,
// avec discussion bureau <-> client, emails et délais de prise en charge.
// ==========================================================================

export const TYPES_DEMANDE: Record<string, { label: string; icone: string }> = {
  panne: { label: "Panne", icone: "🚨" },
  intervention: { label: "Demande d'intervention", icone: "🔧" },
  question: { label: "Question / réclamation", icone: "💬" },
  document: { label: "Demande de document / devis", icone: "📄" },
};

export const STATUTS_DEMANDE: Record<string, { label: string; tone: "ok" | "warn" | "crit" | "neutral"; etape: number }> = {
  nouvelle: { label: "Nouvelle", tone: "crit", etape: 0 },
  prise_en_charge: { label: "Prise en charge", tone: "warn", etape: 1 },
  planifiee: { label: "Intervention planifiée", tone: "neutral", etape: 2 },
  resolue: { label: "Résolue", tone: "ok", etape: 3 },
  cloturee: { label: "Clôturée", tone: "ok", etape: 4 },
};
export const ETAPES_DEMANDE = ["Reçue", "Prise en charge", "Intervention planifiée", "Résolue", "Clôturée"];
export const STATUTS_OUVERTS = ["nouvelle", "prise_en_charge", "planifiee"] as const;

export const PARAM_EMAILS_ALERTES = "emails_alertes";
export const PARAM_DELAI_PANNE_MIN = "delai_panne_minutes";
export const PARAM_DELAI_AUTRE_H = "delai_autre_heures_ouvrees";
export const PARAM_RESUME_MENSUEL = "resume_mensuel_actif";
export const PARAM_CONTACT_NOM = "contact_client_nom";
export const PARAM_CONTACT_TEL = "contact_client_telephone";
export const PARAM_CONTACT_EMAIL = "contact_client_email";

const base = () => process.env.NEXTAUTH_URL || "https://robuswork.tech";
const fmt = (d: Date) => d.toLocaleString("fr-BE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short" });

/** Emails qui reçoivent les alertes : paramètre, sinon administrateurs + responsables qualité actifs. */
export async function destinatairesAlertes() {
  const param = (await getParametre(PARAM_EMAILS_ALERTES)) ?? "";
  const liste = param
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (liste.length) return [...new Set(liste)];
  const bureau = await db
    .select({ email: users.email })
    .from(users)
    .where(and(inArray(users.role, ["administrateur", "responsable_qualite"]), eq(users.actif, 1)));
  return [...new Set(bureau.map((u) => u.email))];
}

export async function delais() {
  const [p, a] = await Promise.all([getParametre(PARAM_DELAI_PANNE_MIN), getParametre(PARAM_DELAI_AUTRE_H)]);
  return { panneMinutes: Math.max(5, Number(p) || 30), autreHeuresOuvrees: Math.max(1, Number(a) || 24) };
}

/** Ajoute des heures « ouvrées » (lundi-vendredi) — week-end non compté. */
function ajouterHeuresOuvrees(depart: Date, heures: number) {
  const d = new Date(depart);
  let reste = heures;
  while (reste > 0) {
    d.setTime(d.getTime() + 3600 * 1000);
    const jour = d.getUTCDay();
    if (jour !== 0 && jour !== 6) reste--;
  }
  return d;
}

export function echeancePriseEnCharge(d: { type: string; personneBloquee: number; createdAt: Date }, delai: { panneMinutes: number; autreHeuresOuvrees: number }) {
  if (d.type === "panne" || d.personneBloquee) return new Date(d.createdAt.getTime() + (d.personneBloquee ? Math.min(delai.panneMinutes, 15) : delai.panneMinutes) * 60000);
  return ajouterHeuresOuvrees(d.createdAt, delai.autreHeuresOuvrees);
}

async function genererNumero() {
  const annee = new Date().getFullYear();
  const [dernier] = await db
    .select({ numero: demandesClient.numero })
    .from(demandesClient)
    .where(like(demandesClient.numero, `DC-${annee}-%`))
    .orderBy(desc(demandesClient.numero))
    .limit(1);
  const n = dernier ? Number(dernier.numero.split("-")[2]) || 0 : 0;
  return { annee, suivant: n + 1 };
}

/** Message système / bureau / client dans le fil de la demande. */
export async function ajouterMessage(demandeId: string, auteurType: "bureau" | "client" | "systeme", texte: string | null, auteurId: string | null = null, fichiers: FichierJoint[] = []) {
  await db.insert(demandesMessages).values({ demandeId, auteurType, texte, auteurId, fichiers });
  await db.update(demandesClient).set({ updatedAt: new Date() }).where(eq(demandesClient.id, demandeId));
}

/** Prévient le client (auteur de la demande) : notification + email. */
export async function notifierClient(demandeId: string, titre: string, texte: string) {
  try {
    const [d] = await db
      .select({ numero: demandesClient.numero, auteurId: demandesClient.auteurId, email: demandesClient.email, nom: demandesClient.nom, uEmail: users.email, uNom: users.nom })
      .from(demandesClient)
      .leftJoin(users, eq(demandesClient.auteurId, users.id))
      .where(eq(demandesClient.id, demandeId))
      .limit(1);
    if (!d) return;
    const url = `/observateur/demandes/${demandeId}`;
    if (d.auteurId) await notifierUtilisateurs([d.auteurId], { titre, corps: `${d.numero} — ${texte}`, url, tag: `demande-${demandeId}` });
    const email = d.uEmail ?? d.email;
    if (email) {
      await envoyerAvisObservateur({
        email,
        nom: d.uNom ?? d.nom ?? "Madame, Monsieur",
        titre: `${titre} — ${d.numero}`,
        texte,
        lien: d.auteurId ? new URL(url, base()).toString() : base(),
      });
    }
  } catch (e) {
    console.error("Notification client demande", e);
  }
}

export type NouvelleDemande = {
  appareilId: string;
  type: "panne" | "intervention" | "question" | "document";
  description: string;
  personneBloquee?: boolean;
  photos?: string[];
  auteurId: string | null;
  nom: string | null;
  telephone: string | null;
  email: string | null;
  origine: "espace" | "qr";
  clientId?: string | null;
};

/**
 * Crée la demande + (panne) la mission « à affecter », journalise, alerte le
 * bureau (email + notification) et accuse réception au client.
 */
export async function creerDemande(p: NouvelleDemande) {
  const [a] = await db.select({ numero: appareils.numeroInterne }).from(appareils).where(eq(appareils.id, p.appareilId)).limit(1);
  if (!a) throw new Error("Appareil introuvable.");
  const projetId = await dernierProjetAppareil(p.appareilId);
  let clientId = p.clientId ?? null;
  if (!clientId && projetId) {
    const [pr] = await db.select({ clientId: projets.clientId }).from(projets).where(eq(projets.id, projetId)).limit(1);
    clientId = pr?.clientId ?? null;
  }
  const bloquee = !!p.personneBloquee && p.type === "panne";
  const priorite = bloquee ? "critique" : p.type === "panne" ? "haute" : "normale";
  const qui = [p.nom, p.telephone].filter(Boolean).join(" · ") || "client";

  let missionId: string | null = null;
  if (p.type === "panne") {
    const [m] = await db
      .insert(interventions)
      .values({
        appareilId: p.appareilId,
        projetId,
        type: "corrective",
        statut: "creee",
        priorite,
        description: `${bloquee ? "URGENT — PERSONNE BLOQUÉE. " : ""}Panne signalée par le client (${qui}) : ${p.description}`,
      })
      .returning({ id: interventions.id });
    missionId = m.id;
    await attribuerParDefaut(m.id);
  }

  // Numéro unique DC-AAAA-NNNN (nouvel essai si deux demandes arrivent en même temps).
  let demandeId = "";
  let numero = "";
  for (let essai = 0; essai < 5 && !demandeId; essai++) {
    const { annee, suivant } = await genererNumero();
    numero = `DC-${annee}-${String(suivant + essai).padStart(4, "0")}`;
    const rows = await db
      .insert(demandesClient)
      .values({
        numero,
        appareilId: p.appareilId,
        clientId,
        auteurId: p.auteurId,
        nom: p.nom,
        telephone: p.telephone,
        email: p.email,
        type: p.type,
        personneBloquee: bloquee ? 1 : 0,
        description: p.description,
        photos: p.photos ?? [],
        priorite,
        interventionId: missionId,
        origine: p.origine,
      })
      .onConflictDoNothing()
      .returning({ id: demandesClient.id });
    if (rows[0]) demandeId = rows[0].id;
  }
  if (!demandeId) throw new Error("Impossible d'enregistrer la demande, réessayez.");

  await ajouterMessage(demandeId, "systeme", "Demande reçue par ROBUS.");
  await journaliser({ entite: "demande_client", entiteId: demandeId, action: `creee_${p.type}`, utilisateurId: p.auteurId, details: `${numero} — ${a.numero} — ${qui} — ${p.description.slice(0, 200)}` });

  // Alerte bureau (email + notification) et accusé de réception : après la
  // réponse, pour que le client voie tout de suite la confirmation.
  after(async () => {
    try {
      // Alerte bureau : email + notification.
      const [client] = clientId ? await db.select({ nom: clients.raisonSociale }).from(clients).where(eq(clients.id, clientId)).limit(1) : [];
      const adresse = (await adressesAppareils([p.appareilId])).get(p.appareilId) ?? "";
      const t = TYPES_DEMANDE[p.type];
      const sujet = `${bloquee ? "🚨 URGENT — PERSONNE BLOQUÉE" : p.type === "panne" ? "🚨 PANNE CLIENT" : `${t.icone} ${t.label.toUpperCase()}`} — ${a.numero}${client ? ` — ${client.nom}` : ""}`;
      const lien = new URL(`/responsable/demandes/${demandeId}`, base()).toString();
      await notifierBureau({ titre: sujet, corps: `${numero} · ${qui} : ${p.description.slice(0, 120)}`, url: `/responsable/demandes/${demandeId}`, tag: `demande-${demandeId}` });
      const dl = await delais();
      await envoyerAlerteDemande({
        destinataires: await destinatairesAlertes(),
        sujet,
        urgence: p.type === "panne",
        lignes: [
          ["Demande", numero],
          ["Type", t.label],
          ["Ascenseur", a.numero],
          ["Client", client?.nom ?? "—"],
          ["Adresse", adresse || "—"],
          ["Demandeur", qui],
          ["À prendre en charge avant", fmt(echeancePriseEnCharge({ type: p.type, personneBloquee: bloquee ? 1 : 0, createdAt: new Date() }, dl))],
        ],
        description: p.description,
        lien,
      });
      await notifierClient(demandeId, "Demande reçue", `Nous avons bien reçu votre demande (${t.label.toLowerCase()}). Nous vous tenons informé à chaque étape.`);
    } catch (e) {
      console.error("Alerte demande", e);
    }
  });
  return { id: demandeId, numero, missionId };
}

/** Changement de statut + message système + client prévenu. */
export async function changerStatutDemande(id: string, statut: keyof typeof STATUTS_DEMANDE, userId: string | null, message: string) {
  const maintenant = new Date();
  await db
    .update(demandesClient)
    .set({
      statut,
      updatedAt: maintenant,
      ...(statut === "prise_en_charge" ? { prisEnChargeLe: maintenant, prisEnChargeParId: userId } : {}),
      ...(statut === "resolue" ? { resolueLe: maintenant } : {}),
      ...(statut === "cloturee" ? { clotureeLe: maintenant } : {}),
    })
    .where(eq(demandesClient.id, id));
  // Prise en charge implicite si on saute l'étape.
  if (statut !== "nouvelle") {
    await db.update(demandesClient).set({ prisEnChargeLe: maintenant, prisEnChargeParId: userId }).where(and(eq(demandesClient.id, id), isNull(demandesClient.prisEnChargeLe)));
  }
  await ajouterMessage(id, "systeme", message);
  await journaliser({ entite: "demande_client", entiteId: id, action: `statut_${statut}`, utilisateurId: userId, details: message });
  after(() => notifierClient(id, STATUTS_DEMANDE[statut].label, message));
}

/** Hook : missions envoyées au technicien -> demandes liées « Intervention planifiée ». */
export async function demandesMissionPlanifiee(interventionIds: string[]) {
  if (!interventionIds.length) return;
  const rows = await db
    .select({ id: demandesClient.id, date: interventions.dateProgrammee, technicien: users.nom })
    .from(demandesClient)
    .innerJoin(interventions, eq(demandesClient.interventionId, interventions.id))
    .leftJoin(users, eq(interventions.technicienId, users.id))
    .where(and(inArray(demandesClient.interventionId, interventionIds), inArray(demandesClient.statut, ["nouvelle", "prise_en_charge", "planifiee"])));
  for (const r of rows) {
    const prenom = r.technicien?.trim().split(/\s+/)[0];
    await changerStatutDemande(r.id, "planifiee", null, `Intervention planifiée${r.date ? ` le ${fmt(r.date)}` : ""}${prenom ? ` avec ${prenom}` : ""}.`);
  }
}

/** Hook : mission terminée -> demande liée « Résolue ». */
export async function demandesMissionTerminee(interventionId: string) {
  const rows = await db
    .select({ id: demandesClient.id })
    .from(demandesClient)
    .where(and(eq(demandesClient.interventionId, interventionId), inArray(demandesClient.statut, [...STATUTS_OUVERTS])));
  for (const r of rows) {
    await db.update(demandesClient).set({ resolution: "Intervention réalisée par le technicien ROBUS." }).where(eq(demandesClient.id, r.id));
    await changerStatutDemande(r.id, "resolue", null, "Intervention terminée — votre demande est résolue. Le rapport sera disponible après validation.");
  }
}

/** Cron : demandes non prises en charge après le délai -> rappel email + notification (une fois). */
export async function relancerDemandesEnRetard() {
  const ouvertes = await db
    .select({ id: demandesClient.id, numero: demandesClient.numero, type: demandesClient.type, personneBloquee: demandesClient.personneBloquee, createdAt: demandesClient.createdAt, appareil: appareils.numeroInterne })
    .from(demandesClient)
    .innerJoin(appareils, eq(demandesClient.appareilId, appareils.id))
    .where(and(eq(demandesClient.statut, "nouvelle"), isNull(demandesClient.rappelEnvoyeLe)));
  const dl = await delais();
  const enRetard = ouvertes.filter((d) => echeancePriseEnCharge(d, dl).getTime() < Date.now());
  if (!enRetard.length) return 0;
  const dest = await destinatairesAlertes();
  for (const d of enRetard) {
    const sujet = `⏰ DÉLAI DÉPASSÉ — ${d.numero} (${TYPES_DEMANDE[d.type]?.label ?? d.type}) — ${d.appareil} non pris en charge`;
    await notifierBureau({ titre: sujet, corps: "Personne n'a encore pris cette demande en charge.", url: `/responsable/demandes/${d.id}`, tag: `demande-retard-${d.id}` });
    await envoyerAlerteDemande({
      destinataires: dest,
      sujet,
      urgence: d.type === "panne",
      lignes: [["Demande", d.numero], ["Reçue le", fmt(d.createdAt)], ["Ascenseur", d.appareil]],
      description: "Cette demande n'a pas encore été prise en charge dans le délai prévu.",
      lien: new URL(`/responsable/demandes/${d.id}`, base()).toString(),
    });
    await db.update(demandesClient).set({ rappelEnvoyeLe: new Date() }).where(eq(demandesClient.id, d.id));
  }
  return enRetard.length;
}

/** Statistiques pour le tableau de bord / la liste. */
export async function statsDemandes() {
  const [ouvertes, depuis30j] = await Promise.all([
    db
      .select({ id: demandesClient.id, type: demandesClient.type, personneBloquee: demandesClient.personneBloquee, statut: demandesClient.statut, createdAt: demandesClient.createdAt })
      .from(demandesClient)
      .where(inArray(demandesClient.statut, [...STATUTS_OUVERTS])),
    db
      .select({ createdAt: demandesClient.createdAt, prisEnChargeLe: demandesClient.prisEnChargeLe })
      .from(demandesClient)
      .where(gte(demandesClient.createdAt, sql`now() - interval '30 days'`)),
  ]);
  const dl = await delais();
  const enRetard = ouvertes.filter((d) => d.statut === "nouvelle" && echeancePriseEnCharge(d, dl).getTime() < Date.now()).length;
  const delaisPec = depuis30j.filter((d) => d.prisEnChargeLe).map((d) => (d.prisEnChargeLe!.getTime() - d.createdAt.getTime()) / 60000);
  const moyenne = delaisPec.length ? Math.round(delaisPec.reduce((s, x) => s + x, 0) / delaisPec.length) : null;
  return { ouvertes: ouvertes.length, nouvelles: ouvertes.filter((d) => d.statut === "nouvelle").length, pannes: ouvertes.filter((d) => d.type === "panne").length, enRetard, delaiMoyenMinutes: moyenne };
}

/** Anti-abus : au plus 3 demandes / heure / auteur (ou téléphone) et 10 / heure / appareil. */
export async function tropDeDemandes(appareilId: string, auteurId: string | null, telephone: string | null) {
  const depuis = new Date(Date.now() - 3600 * 1000);
  const [[parAuteur], [parAppareil]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(demandesClient)
      .where(
        and(
          eq(demandesClient.appareilId, appareilId),
          gte(demandesClient.createdAt, depuis),
          auteurId ? eq(demandesClient.auteurId, auteurId) : telephone ? eq(demandesClient.telephone, telephone) : sql`false`
        )
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(demandesClient)
      .where(and(eq(demandesClient.appareilId, appareilId), gte(demandesClient.createdAt, depuis))),
  ]);
  return parAuteur.n >= 3 || parAppareil.n >= 10;
}

/** Observateurs actifs d'un client (contact ROBUS, résumé). */
export async function observateursActifs() {
  return db
    .select({ obsId: observateurs.id, userId: users.id, nom: users.nom, email: users.email, clientId: observateurs.clientId, resumeEnvoyeLe: observateurs.resumeEnvoyeLe, droits: observateurs.droits })
    .from(observateurs)
    .innerJoin(users, eq(observateurs.userId, users.id))
    .where(and(eq(users.actif, 1), eq(observateurs.resumeMensuel, 1), sql`(${observateurs.dateFin} is null or ${observateurs.dateFin} > now())`));
}

