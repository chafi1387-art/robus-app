"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { demandesClient, enquetesSatisfaction, interventions, observateurs, reclamationsClient } from "@/db/schema";
import { journaliser } from "@/lib/journal";
import { requireObservateur } from "@/lib/observateur";
import { after } from "next/server";
import { creerDemande, ajouterMessage, tropDeDemandes } from "@/lib/demandes";
import { photosRecues } from "@/lib/photos";
import { fichiersRecus } from "@/lib/fichiers";
import { notifierBureau } from "@/lib/push";
import { deciderDevis } from "@/lib/devis";
import { devisDestinataires } from "@/db/schema";

// Phase 18/20 : actions de l'observateur (demandes client, notes, préférences).

const demandeSchema = z.object({
  appareilId: z.string().uuid("Choisissez l'ascenseur."),
  type: z.enum(["panne", "intervention", "question", "document"]),
  description: z.string().trim().min(5, "Décrivez votre demande en quelques mots.").max(2000),
  telephone: z.string().trim().max(40).optional(),
});

/**
 * Phase 20 : nouvelle demande client (panne, intervention, question /
 * réclamation, document / devis) depuis l'espace observateur.
 */
export async function creerDemandeObservateur(formData: FormData) {
  const ctx = await requireObservateur();
  const depuis = String(formData.get("depuis") ?? "");
  const retourErreur = (m: string) =>
    redirect(
      depuis.startsWith("/observateur/appareils/")
        ? `${depuis}?erreur=${encodeURIComponent(m)}#panne`
        : `/observateur/demandes/nouvelle?erreur=${encodeURIComponent(m)}`
    );
  const parsed = demandeSchema.safeParse({
    appareilId: formData.get("appareilId"),
    type: formData.get("type") || "panne",
    description: formData.get("description"),
    telephone: formData.get("telephone") || undefined,
  });
  if (!parsed.success) retourErreur(parsed.error!.issues[0]?.message ?? "Formulaire invalide.");
  const d = parsed.data!;
  if (!ctx.appareilIds.includes(d.appareilId)) redirect("/observateur?acces=refuse");
  if ((d.type === "panne" || d.type === "intervention") && !ctx.droits.has("signaler_panne")) {
    retourErreur("Votre accès ne permet pas de signaler une panne — contactez ROBUS.");
  }
  if (await tropDeDemandes(d.appareilId, ctx.userId, null)) retourErreur("Vous avez déjà envoyé plusieurs demandes pour cet ascenseur — ROBUS est prévenu.");
  let photos: string[] = [];
  try {
    photos = await photosRecues(formData, `demande-${ctx.userId}`, ctx.userId, "photos", 5);
  } catch (e) {
    retourErreur((e as Error).message);
  }
  const { id } = await creerDemande({
    appareilId: d.appareilId,
    type: d.type,
    description: d.description,
    personneBloquee: formData.get("personneBloquee") === "on",
    photos,
    auteurId: ctx.userId,
    nom: ctx.nom,
    telephone: d.telephone ?? null,
    email: null,
    origine: "espace",
    clientId: ctx.clientId,
  });
  // Réclamation : tracée aussi dans le module ISO « Réclamations clients ».
  if (d.type === "question" && formData.get("reclamation") === "on") {
    await db.insert(reclamationsClient).values({ clientId: ctx.clientId, description: `[Espace client] ${d.description}` });
  }
  revalidatePath("/observateur/demandes");
  redirect(`/observateur/demandes/${id}?cree=1`);
}

async function maDemande(id: string, userId: string) {
  if (!z.string().uuid().safeParse(id).success) redirect("/observateur/demandes");
  const [d] = await db.select().from(demandesClient).where(and(eq(demandesClient.id, id), eq(demandesClient.auteurId, userId))).limit(1);
  if (!d) redirect("/observateur/demandes");
  return d!;
}

export async function repondreDemandeClient(formData: FormData) {
  const ctx = await requireObservateur();
  const id = String(formData.get("demandeId") ?? "");
  const d = await maDemande(id, ctx.userId);
  const texte = String(formData.get("texte") ?? "").trim().slice(0, 5000);
  let joints: { url: string; nom: string }[] = [];
  try {
    joints = await fichiersRecus(formData, "missions", `demande-${id}`, ctx.userId, "fichiers", 5);
  } catch (e) {
    redirect(`/observateur/demandes/${id}?erreur=${encodeURIComponent((e as Error).message)}`);
  }
  if (!texte && !joints.length) redirect(`/observateur/demandes/${id}`);
  await ajouterMessage(id, "client", texte || null, ctx.userId, joints);
  // Une demande close qui reçoit un message est rouverte (le bureau est prévenu).
  if (d.statut === "cloturee" || d.statut === "resolue") {
    await db.update(demandesClient).set({ statut: "prise_en_charge" }).where(eq(demandesClient.id, id));
    await ajouterMessage(id, "systeme", "Demande rouverte par le client.");
  }
  after(() =>
    notifierBureau({ titre: `💬 Message client — ${d.numero}`, corps: texte.slice(0, 140) || "Pièce jointe", url: `/responsable/demandes/${id}`, tag: `demande-${id}` })
  );
  revalidatePath(`/observateur/demandes/${id}`);
  redirect(`/observateur/demandes/${id}#fil`);
}

export async function noterDemande(formData: FormData) {
  const ctx = await requireObservateur();
  const id = String(formData.get("demandeId") ?? "");
  const d = await maDemande(id, ctx.userId);
  const note = Number(formData.get("note"));
  if (!Number.isInteger(note) || note < 1 || note > 5 || !["resolue", "cloturee"].includes(d.statut) || d.noteSatisfaction) {
    redirect(`/observateur/demandes/${id}`);
  }
  const commentaire = String(formData.get("commentaire") ?? "").trim().slice(0, 1000) || null;
  await db
    .update(demandesClient)
    .set({ noteSatisfaction: note, commentaireSatisfaction: commentaire, statut: "cloturee", clotureeLe: d.clotureeLe ?? new Date() })
    .where(eq(demandesClient.id, id));
  await db.insert(enquetesSatisfaction).values({ clientId: d.clientId ?? ctx.clientId, interventionId: d.interventionId, note, commentaire, auteurId: ctx.userId });
  await ajouterMessage(id, "systeme", `Le client a noté le traitement ${note}/5${d.statut === "resolue" ? " et clôturé la demande" : ""}.`);
  await journaliser({ entite: "demande_client", entiteId: id, action: "note_satisfaction", utilisateurId: ctx.userId, details: `${note}/5` });
  revalidatePath(`/observateur/demandes/${id}`);
  redirect(`/observateur/demandes/${id}?merci=1`);
}

export async function basculerResumeMensuel() {
  const ctx = await requireObservateur();
  const [o] = await db.select({ r: observateurs.resumeMensuel }).from(observateurs).where(eq(observateurs.id, ctx.observateurId)).limit(1);
  await db.update(observateurs).set({ resumeMensuel: o?.r ? 0 : 1 }).where(eq(observateurs.id, ctx.observateurId));
  revalidatePath("/observateur/compte");
}

export async function noterIntervention(formData: FormData) {
  const ctx = await requireObservateur();
  const id = String(formData.get("interventionId") ?? "");
  const note = Number(formData.get("note"));
  const commentaire = String(formData.get("commentaire") ?? "").trim().slice(0, 1000);
  if (!ctx.droits.has("satisfaction") || !z.string().uuid().safeParse(id).success) redirect("/observateur");
  if (!Number.isInteger(note) || note < 1 || note > 5) redirect(`/observateur/interventions/${id}?erreur=note`);
  const [m] = await db
    .select({ appareilId: interventions.appareilId, statut: interventions.statut })
    .from(interventions)
    .where(eq(interventions.id, id))
    .limit(1);
  if (!m || !ctx.appareilIds.includes(m.appareilId) || !["terminee", "validee", "cloturee"].includes(m.statut)) redirect("/observateur?acces=refuse");
  const [deja] = await db
    .select({ id: enquetesSatisfaction.id })
    .from(enquetesSatisfaction)
    .where(and(eq(enquetesSatisfaction.interventionId, id), eq(enquetesSatisfaction.auteurId, ctx.userId)))
    .limit(1);
  if (!deja) {
    await db.insert(enquetesSatisfaction).values({ clientId: ctx.clientId, interventionId: id, note, commentaire: commentaire || null, auteurId: ctx.userId });
    await journaliser({ entite: "intervention", entiteId: id, action: "note_satisfaction", utilisateurId: ctx.userId, details: `${note}/5` });
  }
  revalidatePath(`/observateur/interventions/${id}`);
  redirect(`/observateur/interventions/${id}?merci=1`);
}

/** Phase 25b : réponse à un devis depuis l'espace observateur. */
export async function repondreDevisObservateur(formData: FormData) {
  const ctx = await requireObservateur();
  const devisId = String(formData.get("devisId") ?? "");
  if (!z.string().uuid().safeParse(devisId).success) redirect("/observateur");
  const retour = `/observateur/devis/${devisId}`;
  const [dest] = await db
    .select({ peutDecider: devisDestinataires.peutDecider })
    .from(devisDestinataires)
    .where(and(eq(devisDestinataires.devisId, devisId), eq(devisDestinataires.userId, ctx.userId), eq(devisDestinataires.canal, "observateur")))
    .limit(1);
  if (!dest) redirect("/observateur");
  if (dest!.peutDecider !== 1) redirect(`${retour}?erreur=${encodeURIComponent("Ce devis vous est transmis pour information.")}`);
  const decision = formData.get("decision") === "refuse" ? "refuse" : "accepte";
  const nom = String(formData.get("nom") ?? "").trim().slice(0, 150) || ctx.nom;
  if (decision === "accepte" && formData.get("bonPourAccord") !== "on") {
    redirect(`${retour}?erreur=${encodeURIComponent("Cochez « Bon pour accord » pour accepter le devis.")}`);
  }
  try {
    await deciderDevis({ devisId, decision, nom, canal: "espace", userId: ctx.userId, motif: String(formData.get("motif") ?? "").trim() || null });
  } catch (e) {
    redirect(`${retour}?erreur=${encodeURIComponent((e as Error).message)}`);
  }
  revalidatePath(retour);
  redirect(`${retour}?reponse=${decision}`);
}
