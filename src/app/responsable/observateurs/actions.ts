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
  observateurAppareils,
  observateurs,
  reinitialisationsMotDePasse,
  users,
} from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { after } from "next/server";
import { appareils, documentsClient } from "@/db/schema";
import { enregistrerFichiers, fichiersDuFormulaire } from "@/lib/fichiers";
import { avecMessage } from "@/lib/url";
import { notifierObservateurs } from "@/lib/observateur";
import { TYPES_DOCUMENT_CLIENT } from "@/lib/documents-client";
import {
  PARAM_CONTACT_EMAIL,
  PARAM_CONTACT_NOM,
  PARAM_CONTACT_TEL,
  PARAM_DELAI_AUTRE_H,
  PARAM_DELAI_PANNE_MIN,
  PARAM_EMAILS_ALERTES,
  PARAM_RESUME_MENSUEL,
} from "@/lib/demandes";
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

// ==========================================================================
// Phase 20 — Documents client (par appareil, séparés des documents internes)
// et paramètres de la relation client.
// ==========================================================================
export async function ajouterDocumentClient(formData: FormData) {
  const user = await requireUser([...ROLES_GESTION, "commercial"]);
  const appareilId = String(formData.get("appareilId") ?? "");
  const retour = `/responsable/appareils/${appareilId}#documents-client`;
  if (!z.string().uuid().safeParse(appareilId).success) redirect("/responsable/appareils");
  const titre = String(formData.get("titre") ?? "").trim().slice(0, 200);
  const type = String(formData.get("type") ?? "autre");
  const message = String(formData.get("message") ?? "").trim().slice(0, 1000) || null;
  if (!titre) redirect(avecMessage(retour, "erreur", "Donnez un titre au document."));
  let fichiers: File[] = [];
  try {
    fichiers = fichiersDuFormulaire(formData, "fichier", 1);
  } catch (e) {
    redirect(avecMessage(retour, "erreur", (e as Error).message));
  }
  if (!fichiers.length) redirect(avecMessage(retour, "erreur", "Joignez le fichier."));
  const [f] = await enregistrerFichiers(fichiers, "missions", `client-${appareilId}`);
  const [doc] = await db
    .insert(documentsClient)
    .values({ appareilId, titre, type: type in TYPES_DOCUMENT_CLIENT ? type : "autre", url: f.url, nomFichier: f.nom, message, creeParId: user.id })
    .returning({ id: documentsClient.id });
  await journaliser({ entite: "document_client", entiteId: doc.id, action: "partage", utilisateurId: user.id, details: `${titre} — appareil ${appareilId}` });
  const [a] = await db.select({ numero: appareils.numeroInterne }).from(appareils).where(eq(appareils.id, appareilId)).limit(1);
  after(() =>
    notifierObservateurs(
      appareilId,
      "documents",
      {
        titre: "📄 Nouveau document disponible",
        corps: `${titre} — ascenseur ${a?.numero ?? ""}${message ? ` : ${message}` : ""}`,
        url: `/observateur/appareils/${appareilId}`,
      },
      true
    )
  );
  revalidatePath(`/responsable/appareils/${appareilId}`);
  redirect(avecMessage(retour, "ok", `Document « ${titre} » partagé avec le client.`));
}

export async function archiverDocumentClient(formData: FormData) {
  const user = await requireUser([...ROLES_GESTION, "commercial"]);
  const id = String(formData.get("documentId") ?? "");
  const appareilId = String(formData.get("appareilId") ?? "");
  if (!z.string().uuid().safeParse(id).success) redirect("/responsable/appareils");
  const [doc] = await db.select({ archiveLe: documentsClient.archiveLe }).from(documentsClient).where(eq(documentsClient.id, id)).limit(1);
  if (!doc) redirect("/responsable/appareils");
  await db.update(documentsClient).set({ archiveLe: doc!.archiveLe ? null : new Date() }).where(eq(documentsClient.id, id));
  await journaliser({ entite: "document_client", entiteId: id, action: doc!.archiveLe ? "restaure" : "retire", utilisateurId: user.id });
  revalidatePath(`/responsable/appareils/${appareilId}`);
  redirect(`/responsable/appareils/${appareilId}#documents-client`);
}

export async function enregistrerParametresClient(formData: FormData) {
  const user = await requireUser([...ROLES_GESTION]);
  const retour = "/responsable/observateurs";
  const emails = String(formData.get("emailsAlertes") ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const invalide = emails.find((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (invalide) redirect(avecMessage(retour, "erreur", `Adresse email invalide : ${invalide}`));
  const delaiPanne = Math.min(1440, Math.max(5, Number(formData.get("delaiPanne")) || 30));
  const delaiAutre = Math.min(240, Math.max(1, Number(formData.get("delaiAutre")) || 24));
  const tel = String(formData.get("telephone") ?? "").trim().slice(0, 40);
  if (tel && !/^[+0-9 ().-]{6,40}$/.test(tel)) redirect(avecMessage(retour, "erreur", "Téléphone d'urgence invalide."));
  const contactEmail = String(formData.get("contactEmail") ?? "").trim().toLowerCase().slice(0, 200);
  if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) redirect(avecMessage(retour, "erreur", "Email de contact invalide."));
  await Promise.all([
    setParametre(PARAM_EMAILS_ALERTES, emails.join(", ") || null),
    setParametre(PARAM_DELAI_PANNE_MIN, String(delaiPanne)),
    setParametre(PARAM_DELAI_AUTRE_H, String(delaiAutre)),
    setParametre(PARAM_RESUME_MENSUEL, formData.get("resumeMensuel") === "on" ? "1" : "0"),
    setParametre(PARAM_TELEPHONE, tel || null),
    setParametre(PARAM_CONTACT_NOM, String(formData.get("contactNom") ?? "").trim().slice(0, 160) || null),
    setParametre(PARAM_CONTACT_TEL, String(formData.get("contactTelephone") ?? "").trim().slice(0, 40) || null),
    setParametre(PARAM_CONTACT_EMAIL, contactEmail || null),
  ]);
  await journaliser({ entite: "parametre", entiteId: user.id, action: "relation_client_modifiee", utilisateurId: user.id, details: `alertes : ${emails.join(", ") || "(bureau)"} · délais ${delaiPanne} min / ${delaiAutre} h` });
  revalidatePath(retour);
  redirect(avecMessage(retour, "ok", "Paramètres de la relation client enregistrés."));
}
