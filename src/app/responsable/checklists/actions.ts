"use server";

import { z } from "zod";
import { db } from "@/db";
import { checklistItems, checklistModeles } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

const modeleSchema = z.object({
  nom: z.string().min(2, "Nom requis"),
  typeIntervention: z.enum(["preventive", "corrective", "systematique"]).optional(),
  marque: z.string().optional(),
  typeAppareil: z.string().optional(),
});

export async function createChecklistModele(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const typeIntervention = formData.get("typeIntervention");
  const parsed = modeleSchema.safeParse({
    nom: formData.get("nom"),
    typeIntervention: typeIntervention && typeIntervention !== "" ? typeIntervention : undefined,
    marque: formData.get("marque") || undefined,
    typeAppareil: formData.get("typeAppareil") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [created] = await db
    .insert(checklistModeles)
    .values({
      nom: parsed.data.nom,
      typeIntervention: parsed.data.typeIntervention ?? null,
      marque: parsed.data.marque ?? null,
      typeAppareil: parsed.data.typeAppareil ?? null,
    })
    .returning();

  revalidatePath("/responsable/checklists");
  redirect(`/responsable/checklists/${created.id}`);
}

const itemSchema = z.object({
  modeleId: z.string().uuid(),
  libelle: z.string().min(1, "Libellé requis"),
});

export async function addChecklistItem(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = itemSchema.safeParse({
    modeleId: formData.get("modeleId"),
    libelle: formData.get("libelle"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [modeleExists] = await db
    .select({ id: checklistModeles.id })
    .from(checklistModeles)
    .where(eq(checklistModeles.id, parsed.data.modeleId))
    .limit(1);
  if (!modeleExists) throw new Error("Modèle de checklist introuvable.");

  const existingItems = await db
    .select({ ordre: checklistItems.ordre })
    .from(checklistItems)
    .where(eq(checklistItems.modeleId, parsed.data.modeleId));
  const nextOrdre = Math.max(-1, ...existingItems.map((i) => i.ordre)) + 1;

  await db.insert(checklistItems).values({
    modeleId: parsed.data.modeleId,
    libelle: parsed.data.libelle,
    ordre: nextOrdre,
  });

  revalidatePath(`/responsable/checklists/${parsed.data.modeleId}`);
}

const removeItemSchema = z.object({
  itemId: z.string().uuid(),
  modeleId: z.string().uuid(),
});

export async function removeChecklistItem(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = removeItemSchema.safeParse({
    itemId: formData.get("itemId"),
    modeleId: formData.get("modeleId"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db.delete(checklistItems).where(eq(checklistItems.id, parsed.data.itemId));
  revalidatePath(`/responsable/checklists/${parsed.data.modeleId}`);
}

const toggleSchema = z.object({
  modeleId: z.string().uuid(),
  actif: z.coerce.number().int(),
});

export async function toggleChecklistModeleActif(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = toggleSchema.safeParse({
    modeleId: formData.get("modeleId"),
    actif: formData.get("actif"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db
    .update(checklistModeles)
    .set({ actif: parsed.data.actif ? 0 : 1 })
    .where(eq(checklistModeles.id, parsed.data.modeleId));

  revalidatePath("/responsable/checklists");
  revalidatePath(`/responsable/checklists/${parsed.data.modeleId}`);
}
