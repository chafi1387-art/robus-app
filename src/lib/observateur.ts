import "server-only";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  appareils,
  observateurAppareils,
  observateurs,
  parametres,
  projetAppareils,
  projets,
  sites,
  users,
} from "@/db/schema";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth-helpers";
import { notifierUtilisateurs } from "@/lib/push";
import { envoyerAvisObservateur } from "@/lib/mail";

// ==========================================================================
// Phase 18 — Espace Observateur : droits, modèles, accès, notifications.
// ==========================================================================

export const DROITS = [
  { id: "fiche", label: "Fiche appareil", aide: "Caractéristiques et statut (En service / En panne…)" },
  { id: "temps_reel", label: "Interventions en temps réel", aide: "Demande reçue → Planifiée → Technicien sur place → Terminée" },
  { id: "historique", label: "Historique des interventions", aide: "Toutes les interventions passées" },
  { id: "rapports", label: "Rapports et photos", aide: "Seulement après validation par le bureau" },
  { id: "pieces", label: "Pièces remplacées", aide: "La désignation, jamais les prix" },
  { id: "prochaines_visites", label: "Prochaines visites", aide: "Planning de maintenance préventive" },
  { id: "contrat", label: "Contrat et garantie", aide: "Dates et garantie restante" },
  { id: "documents", label: "Documents", aide: "Seulement ceux marqués « visible observateur »" },
  { id: "signaler_panne", label: "Signaler une panne", aide: "Crée une mission « à affecter » et prévient le bureau" },
  { id: "satisfaction", label: "Note de satisfaction", aide: "Une note après chaque intervention (ISO §9.1.2)" },
  { id: "notifications", label: "Notifications", aide: "Téléphone et email à chaque étape" },
] as const;
export type Droit = (typeof DROITS)[number]["id"];
export const DROITS_IDS = DROITS.map((d) => d.id) as string[];
/** Option : historique limité aux 12 derniers mois. */
export const DROIT_HISTO_12_MOIS = "historique_12_mois";

export const MODELES: Record<string, { label: string; droits: Droit[]; joursAcces?: number }> = {
  syndic: { label: "Syndic", droits: DROITS.map((d) => d.id) },
  gardien: { label: "Gardien", droits: ["temps_reel", "signaler_panne", "notifications"] },
  bureau_controle: { label: "Bureau de contrôle", droits: ["historique", "rapports", "documents"], joursAcces: 30 },
  personnalise: { label: "Personnalisé", droits: [] },
};

// ---------- Accès ----------

export type ContexteObservateur = {
  userId: string;
  nom: string;
  email: string;
  observateurId: string;
  clientId: string;
  droits: Set<string>;
  appareilIds: string[];
  dateFin: Date | null;
};

export async function requireObservateur(): Promise<ContexteObservateur> {
  const user = await requireUser(["observateur"]);
  const [obs] = await db
    .select({ obs: observateurs, actif: users.actif, nom: users.nom, email: users.email })
    .from(observateurs)
    .innerJoin(users, eq(observateurs.userId, users.id))
    .where(eq(observateurs.userId, user.id))
    .limit(1);
  if (!obs || obs.actif !== 1 || (obs.obs.dateFin && obs.obs.dateFin.getTime() <= Date.now())) {
    redirect("/connexion?erreur=expire");
  }
  const liens = await db
    .select({ appareilId: observateurAppareils.appareilId })
    .from(observateurAppareils)
    .where(eq(observateurAppareils.observateurId, obs.obs.id));
  return {
    userId: user.id,
    nom: obs.nom,
    email: obs.email,
    observateurId: obs.obs.id,
    clientId: obs.obs.clientId,
    droits: new Set(obs.obs.droits),
    appareilIds: liens.map((l) => l.appareilId),
    dateFin: obs.obs.dateFin,
  };
}

export function exigerAppareil(ctx: ContexteObservateur, appareilId: string) {
  if (!ctx.appareilIds.includes(appareilId)) redirect("/observateur?acces=refuse");
}

// ---------- Appareils d'un client (via sites ou projets) ----------

export async function getAppareilsDuClient(clientId: string) {
  const viaProjets = db
    .select({ id: projetAppareils.appareilId })
    .from(projetAppareils)
    .innerJoin(projets, eq(projetAppareils.projetId, projets.id))
    .where(eq(projets.clientId, clientId));
  const rows = await db
    .select({
      id: appareils.id,
      numeroInterne: appareils.numeroInterne,
      marque: appareils.marque,
      modele: appareils.modele,
      statut: appareils.statut,
      siteAdresse: sites.adresse,
    })
    .from(appareils)
    .leftJoin(sites, eq(appareils.siteId, sites.id))
    .where(or(eq(sites.clientId, clientId), inArray(appareils.id, viaProjets)))
    .orderBy(appareils.numeroInterne);
  const adresses = await adressesAppareils(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, adresse: adresses.get(r.id) ?? r.siteAdresse ?? null }));
}

/** Adresse d'intervention : celle du projet le plus récent, sinon celle du site. */
export async function adressesAppareils(ids: string[]) {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const rows = await db
    .select({ appareilId: projetAppareils.appareilId, adresse: projets.adresse, createdAt: projets.createdAt })
    .from(projetAppareils)
    .innerJoin(projets, eq(projetAppareils.projetId, projets.id))
    .where(inArray(projetAppareils.appareilId, ids))
    .orderBy(desc(projets.createdAt));
  for (const r of rows) if (r.adresse && !map.has(r.appareilId)) map.set(r.appareilId, r.adresse);
  const sansProjet = ids.filter((id) => !map.has(id));
  if (sansProjet.length) {
    const s = await db
      .select({ id: appareils.id, adresse: sites.adresse })
      .from(appareils)
      .innerJoin(sites, eq(appareils.siteId, sites.id))
      .where(inArray(appareils.id, sansProjet));
    for (const r of s) map.set(r.id, r.adresse);
  }
  return map;
}

/** Projet le plus récent d'un appareil (pour rattacher une panne signalée). */
export async function dernierProjetAppareil(appareilId: string) {
  const [p] = await db
    .select({ id: projets.id })
    .from(projetAppareils)
    .innerJoin(projets, eq(projetAppareils.projetId, projets.id))
    .where(eq(projetAppareils.appareilId, appareilId))
    .orderBy(desc(projets.createdAt))
    .limit(1);
  return p?.id ?? null;
}

// ---------- Étapes visibles par l'observateur ----------

export const ETAPES = ["Demande reçue", "Planifiée", "Technicien sur place", "Terminée"] as const;

export function etapeObservateur(i: { statut: string; technicienId: string | null; dateProgrammee: Date | null }) {
  if (["terminee", "validee", "cloturee"].includes(i.statut)) return 3;
  if (i.statut === "en_cours") return 2;
  if (i.technicienId && i.dateProgrammee) return 1;
  return 0;
}

// ---------- QR code ----------

export async function assurerQrCode(appareilId: string) {
  const [a] = await db.select({ qrCode: appareils.qrCode }).from(appareils).where(eq(appareils.id, appareilId)).limit(1);
  if (!a) return null;
  if (a.qrCode) return a.qrCode;
  const code = randomBytes(9).toString("base64url"); // 12 caractères, impossible à deviner
  await db.update(appareils).set({ qrCode: code }).where(and(eq(appareils.id, appareilId), isNull(appareils.qrCode)));
  const [b] = await db.select({ qrCode: appareils.qrCode }).from(appareils).where(eq(appareils.id, appareilId)).limit(1);
  return b?.qrCode ?? code;
}

export function urlQr(code: string) {
  return new URL(`/a/${code}`, process.env.NEXTAUTH_URL || "https://robuswork.tech").toString();
}

// ---------- Paramètres ----------

export const PARAM_TELEPHONE = "telephone_urgence";

export async function getParametre(cle: string) {
  const [p] = await db.select({ valeur: parametres.valeur }).from(parametres).where(eq(parametres.cle, cle)).limit(1);
  return p?.valeur ?? null;
}

export async function setParametre(cle: string, valeur: string | null) {
  await db
    .insert(parametres)
    .values({ cle, valeur, updatedAt: new Date() })
    .onConflictDoUpdate({ target: parametres.cle, set: { valeur, updatedAt: new Date() } });
}

// ---------- Notifications aux observateurs ----------

/**
 * Prévient les observateurs d'un appareil qui ont le droit `droit` ET le droit
 * « notifications » : notification sur le téléphone (+ email si demandé).
 * Ne fait jamais échouer l'action qui l'appelle.
 */
export async function notifierObservateurs(
  appareilId: string,
  droit: Droit,
  message: { titre: string; corps: string; url: string },
  avecEmail = false
) {
  try {
    const rows = await db
      .select({ userId: users.id, nom: users.nom, email: users.email })
      .from(observateurAppareils)
      .innerJoin(observateurs, eq(observateurAppareils.observateurId, observateurs.id))
      .innerJoin(users, eq(observateurs.userId, users.id))
      .where(
        and(
          eq(observateurAppareils.appareilId, appareilId),
          eq(users.actif, 1),
          sql`${observateurs.droits} @> ARRAY[${droit}, 'notifications']::text[]`,
          or(isNull(observateurs.dateFin), gt(observateurs.dateFin, new Date()))
        )
      );
    if (!rows.length) return;
    await notifierUtilisateurs(
      rows.map((r) => r.userId),
      { ...message, tag: `obs-${appareilId}` }
    );
    if (avecEmail) {
      const lien = new URL(message.url, process.env.NEXTAUTH_URL || "https://robuswork.tech").toString();
      await Promise.all(rows.map((r) => envoyerAvisObservateur({ email: r.email, nom: r.nom, titre: message.titre, texte: message.corps, lien })));
    }
  } catch (e) {
    console.error("Notification observateurs", e);
  }
}
