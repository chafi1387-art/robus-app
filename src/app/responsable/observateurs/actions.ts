"use server";

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  documentsFormations,
  observateurAppareils,
  observateurs,
  reinitialisationsMotDePasse,
  users,
} from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { envoyerInvitationObservateur } from "@/lib/mail";
import {
  DROIT_HISTO_12_MOIS,
  DROITS_IDS,
  MODELES,
  PARAM_TELEPHONE,
  getAppareilsDuClient,
  setParametre,
} from "@/lib/observateur";

// Phase 18 : gestion des observateurs par le bureau (administrateur et
// responsable qualité — le commercial ne donne pas d'accès client).
const ROLES_GESTION = ["administrateur", "responsable_qualite"] as const;

function lireDroits(formData: FormData) {
  const droits = formData
    .getAll("droits")
    .map(String)
    .filter((d) => DROITS_IDS.includes(d));
  if (formData.get(DROIT_HISTO_12_MOIS) === "on" && droits.includes("historique")) droits.push(DROIT_HISTO_12_MOIS);
  return [...new Set(droits)];
}

function lireDateFin(formData: FormData) {
  const v = String(formData.get("dateFin") ?? "").trim();
  if (!v) return null;
  const d = new Date(`${v}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function appareilsAutorises(clientId: string, formData: FormData) {
  const demandes = formData.getAll("appareilIds").map(String);
  const duClient = new Set((await getAppareilsDuClient(clientId)).map((a) => a.id));
  return [...new Set(demandes.filter((id) => duClient.has(id)))];
}

async function envoyerInvitation(userId: string) {
  const [u] = await db
    .select({ nom: users.nom, email: users.email, clientNom: clients.raisonSociale, dateFin: observateurs.dateFin })
    .from(users)
    .innerJoin(observateurs, eq(observateurs.userId, users.id))
    .innerJoin(clients, eq(observateurs.clientId, clients.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return "echec" as const;
  const jeton = randomBytes(32).toString("hex");
  await db.insert(reinitialisationsMotDePasse).values({
    userId,
    jetonHash: createHash("sha256").update(jeton).digest("hex"),
    expireLe: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const base = process.env.NEXTAUTH_URL || "https://robuswork.tech";
  return envoyerInvitationObservateur({
    email: u.email,
    nom: u.nom,
    clientNom: u.clientNom,
    lien: `${base}/reinitialiser?jeton=${jeton}&invitation=1`,
    dateFin: u.dateFin,
  });
}

const creationSchema = z.object({
  clientId: z.string().uuid("Choisissez le client."),
  nom: z.string().trim().min(2, "Indiquez le nom de l'observateur."),
  email: z.string().trim().toLowerCase().email("Adresse email invalide."),
  telephone: z.string().trim().max(40).optional(),
  modele: z.string().optional(),
});

export async function creerObservateur(formData: FormData) {
  const user = await requireUser([...ROLES_GESTION]);
  const clientId = String(formData.get("clientId") ?? "");
  const erreur = (m: string) => redirect(`/responsable/observateurs/nouveau?client=${encodeURIComponent(clientId)}&erreur=${encodeURIComponent(m)}`);
  const parsed = creationSchema.safeParse({
    clientId,
    nom: formData.get("nom"),
    email: formData.get("email"),
    telephone: formData.get("telephone") || undefined,
    modele: formData.get("modele") || undefined,
  });
  if (!parsed.success) erreur(parsed.error!.issues[0]?.message ?? "Formulaire invalide.");
  const d = parsed.data!;
  const droits = lireDroits(formData);
  if (!droits.length) erreur("Cochez au moins une information à partager.");
  const appareilIds = await appareilsAutorises(d.clientId, formData);
  if (!appareilIds.length) erreur("Choisissez au moins un appareil.");
  const [existe] = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email)).limit(1);
  if (existe) erreur("Un compte existe déjà avec cet email.");

  const motDePasseInutilisable = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
  const [nouveau] = await db
    .insert(users)
    .values({ nom: d.nom, email: d.email, telephone: d.telephone || null, role: "observateur", passwordHash: motDePasseInutilisable })
    .returning({ id: users.id });
  const [obs] = await db
    .insert(observateurs)
    .values({
      userId: nouveau.id,
      clientId: d.clientId,
      modele: d.modele && MODELES[d.modele] ? d.modele : "personnalise",
      droits,
      dateFin: lireDateFin(formData),
      creeParId: user.id,
    })
    .returning({ id: observateurs.id });
  await db.insert(observateurAppareils).values(appareilIds.map((appareilId) => ({ observateurId: obs.id, appareilId })));
  const email = await envoyerInvitation(nouveau.id);
  await journaliser({
    entite: "observateur",
    entiteId: obs.id,
    action: "observateur_cree",
    utilisateurId: user.id,
    details: `${d.nom} <${d.email}> — ${appareilIds.length} appareil(s), droits : ${droits.join(", ")} — invitation : ${email}`,
  });
  revalidatePath(`/responsable/clients/${d.clientId}`);
  redirect(`/responsable/observateurs/${obs.id}?cree=1&invitation=${email}`);
}

export async function modifierObservateur(formData: FormData) {
  const user = await requireUser([...ROLES_GESTION]);
  const id = String(formData.get("observateurId") ?? "");
  if (!z.string().uuid().safeParse(id).success) throw new Error("Observateur introuvable.");
  const [obs] = await db.select().from(observateurs).where(eq(observateurs.id, id)).limit(1);
  if (!obs) throw new Error("Observateur introuvable.");
  const erreur = (m: string) => redirect(`/responsable/observateurs/${id}?erreur=${encodeURIComponent(m)}`);
  const droits = lireDroits(formData);
  if (!droits.length) erreur("Cochez au moins une information à partager.");
  const appareilIds = await appareilsAutorises(obs.clientId, formData);
  if (!appareilIds.length) erreur("Choisissez au moins un appareil.");
  const modele = String(formData.get("modele") ?? "");
  const dateFin = lireDateFin(formData);

  await db
    .update(observateurs)
    .set({ droits, dateFin, modele: MODELES[modele] ? modele : "personnalise", updatedAt: new Date() })
    .where(eq(observateurs.id, id));
  await db.delete(observateurAppareils).where(eq(observateurAppareils.observateurId, id));
  await db.insert(observateurAppareils).values(appareilIds.map((appareilId) => ({ observateurId: id, appareilId })));
  await journaliser({
    entite: "observateur",
    entiteId: id,
    action: "observateur_modifie",
    utilisateurId: user.id,
    details: `${appareilIds.length} appareil(s), droits : ${droits.join(", ")}${dateFin ? `, fin le ${dateFin.toISOString().slice(0, 10)}` : ""}`,
  });
  revalidatePath(`/responsable/observateurs/${id}`);
  redirect(`/responsable/observateurs/${id}?enregistre=1`);
}

export async function renvoyerInvitation(formData: FormData) {
  const user = await requireUser([...ROLES_GESTION]);
  const id = String(formData.get("observateurId") ?? "");
  if (!z.string().uuid().safeParse(id).success) throw new Error("Observateur introuvable.");
  const [obs] = await db.select({ userId: observateurs.userId }).from(observateurs).where(eq(observateurs.id, id)).limit(1);
  if (!obs) throw new Error("Observateur introuvable.");
  const email = await envoyerInvitation(obs.userId);
  await journaliser({ entite: "observateur", entiteId: id, action: "invitation_renvoyee", utilisateurId: user.id, details: email });
  redirect(`/responsable/observateurs/${id}?invitation=${email}`);
}

export async function basculerAccesObservateur(formData: FormData) {
  const user = await requireUser([...ROLES_GESTION]);
  const id = String(formData.get("observateurId") ?? "");
  if (!z.string().uuid().safeParse(id).success) throw new Error("Observateur introuvable.");
  const [obs] = await db
    .select({ userId: observateurs.userId, actif: users.actif })
    .from(observateurs)
    .innerJoin(users, eq(observateurs.userId, users.id))
    .where(eq(observateurs.id, id))
    .limit(1);
  if (!obs) throw new Error("Observateur introuvable.");
  const actif = obs.actif === 1 ? 0 : 1;
  await db.update(users).set({ actif }).where(and(eq(users.id, obs.userId), eq(users.role, "observateur")));
  await journaliser({ entite: "observateur", entiteId: id, action: actif ? "acces_reactive" : "acces_retire", utilisateurId: user.id });
  revalidatePath(`/responsable/observateurs/${id}`);
}

export async function enregistrerTelephoneUrgence(formData: FormData) {
  const user = await requireUser([...ROLES_GESTION]);
  const tel = String(formData.get("telephone") ?? "").trim().slice(0, 40);
  if (tel && !/^[+0-9 ().-]{6,40}$/.test(tel)) redirect("/responsable/observateurs?erreur=telephone");
  await setParametre(PARAM_TELEPHONE, tel || null);
  await journaliser({ entite: "parametre", entiteId: user.id, action: "telephone_urgence_modifie", utilisateurId: user.id, details: tel || "(vide)" });
  revalidatePath("/responsable/observateurs");
}

/** Rend un document visible (ou non) dans l'espace Observateur. */
export async function basculerVisibiliteDocument(formData: FormData) {
  const user = await requireUser([...ROLES_GESTION]);
  const id = String(formData.get("documentId") ?? "");
  const retour = String(formData.get("retour") ?? "");
  if (!z.string().uuid().safeParse(id).success) throw new Error("Document introuvable.");
  const [doc] = await db.select({ v: documentsFormations.visibleObservateur }).from(documentsFormations).where(eq(documentsFormations.id, id)).limit(1);
  if (!doc) throw new Error("Document introuvable.");
  await db.update(documentsFormations).set({ visibleObservateur: doc.v ? 0 : 1 }).where(eq(documentsFormations.id, id));
  await journaliser({ entite: "document", entiteId: id, action: doc.v ? "document_masque_observateur" : "document_visible_observateur", utilisateurId: user.id });
  if (retour.startsWith("/responsable/")) revalidatePath(retour.split("?")[0]);
}

