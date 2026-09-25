"use server";

import { z } from "zod";
import { db } from "@/db";
import { prestationsCatalogue } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

const CATEGORIES = ["installation", "reparation", "maintenance", "vente_piece", "autre"] as const;

const catalogueSchema = z.object({
  nom: z.string().min(2, "Nom requis"),
  categorie: z.enum(CATEGORIES),
  description: z.string().optional(),
  prixIndicatif: z.coerce.number().optional(),
});

export async function createPrestationCatalogue(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = catalogueSchema.safeParse({
    nom: formData.get("nom"),
    categorie: formData.get("categorie"),
    description: formData.get("description") || undefined,
    prixIndicatif: formData.get("prixIndicatif") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db.insert(prestationsCatalogue).values({
    nom: parsed.data.nom,
    categorie: parsed.data.categorie,
    description: parsed.data.description ?? null,
    prixIndicatif: parsed.data.prixIndicatif != null ? String(parsed.data.prixIndicatif) : null,
  });

  revalidatePath("/responsable/prestations-catalogue");
}

export async function togglePrestationCatalogueActive(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const id = formData.get("id") as string;
  const [entree] = await db
    .select({ actif: prestationsCatalogue.actif })
    .from(prestationsCatalogue)
    .where(eq(prestationsCatalogue.id, id))
    .limit(1);
  if (!entree) throw new Error("Prestation du catalogue introuvable.");

  await db
    .update(prestationsCatalogue)
    .set({ actif: entree.actif === 1 ? 0 : 1 })
    .where(eq(prestationsCatalogue.id, id));

  revalidatePath("/responsable/prestations-catalogue");
}
