"use server";

import { z } from "zod";
import { db } from "@/db";
import { garantieFormules } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

const formuleSchema = z.object({
  nom: z.string().min(2, "Nom requis"),
  dureeMois: z.coerce.number().int().positive(),
  nombreInterventionsInclues: z.coerce.number().int().nonnegative(),
  prix: z.coerce.number().nonnegative(),
  optionExtensionDisponible: z.coerce.boolean().optional(),
  prixExtension: z.coerce.number().optional(),
});

export async function createGarantieFormule(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = formuleSchema.safeParse({
    nom: formData.get("nom"),
    dureeMois: formData.get("dureeMois"),
    nombreInterventionsInclues: formData.get("nombreInterventionsInclues"),
    prix: formData.get("prix"),
    optionExtensionDisponible: formData.get("optionExtensionDisponible") === "on",
    prixExtension: formData.get("prixExtension") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db.insert(garantieFormules).values({
    nom: parsed.data.nom,
    dureeMois: parsed.data.dureeMois,
    nombreInterventionsInclues: parsed.data.nombreInterventionsInclues,
    prix: String(parsed.data.prix),
    optionExtensionDisponible: parsed.data.optionExtensionDisponible ? 1 : 0,
    prixExtension: parsed.data.prixExtension != null ? String(parsed.data.prixExtension) : null,
  });

  revalidatePath("/responsable/garanties");
}

export async function toggleGarantieFormuleActive(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const id = formData.get("id") as string;
  const [formule] = await db
    .select({ actif: garantieFormules.actif })
    .from(garantieFormules)
    .where(eq(garantieFormules.id, id))
    .limit(1);
  if (!formule) throw new Error("Formule introuvable.");

  await db
    .update(garantieFormules)
    .set({ actif: formule.actif === 1 ? 0 : 1 })
    .where(eq(garantieFormules.id, id));

  revalidatePath("/responsable/garanties");
}
