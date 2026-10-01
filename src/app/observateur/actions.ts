"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { enquetesSatisfaction, interventions } from "@/db/schema";
import { journaliser } from "@/lib/journal";
import { requireObservateur } from "@/lib/observateur";
import { enregistrerPanne, tropDeSignalements } from "@/lib/panne";

// Phase 18 : actions de l'observateur (signaler une panne, noter une intervention).

const panneSchema = z.object({
  appareilId: z.string().uuid(),
  description: z.string().trim().min(5, "Décrivez la panne en quelques mots.").max(1000),
  telephone: z.string().trim().max(40).optional(),
});

export async function signalerPanne(formData: FormData) {
  const ctx = await requireObservateur();
  const appareilId = String(formData.get("appareilId") ?? "");
  const retour = `/observateur/appareils/${appareilId}`;
  if (!ctx.droits.has("signaler_panne") || !ctx.appareilIds.includes(appareilId)) redirect("/observateur?acces=refuse");
  const parsed = panneSchema.safeParse({ appareilId, description: formData.get("description"), telephone: formData.get("telephone") || undefined });
  if (!parsed.success) redirect(`${retour}?erreur=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Formulaire invalide")}#panne`);
  if (await tropDeSignalements(appareilId, ctx.userId, null)) redirect(`${retour}?erreur=${encodeURIComponent("Panne déjà signalée — ROBUS a été prévenu.")}#panne`);
  await enregistrerPanne({
    appareilId,
    description: parsed.data.description,
    nom: ctx.nom,
    telephone: parsed.data.telephone ?? null,
    auteurId: ctx.userId,
  });
  revalidatePath(retour);
  redirect(`${retour}?panne=1`);
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
