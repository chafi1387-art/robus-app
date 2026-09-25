"use server";

import { z } from "zod";
import { db } from "@/db";
import { risques } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

const risqueSchema = z.object({
  type: z.enum(["risque", "opportunite"]),
  titre: z.string().min(2, "Titre requis"),
  description: z.string().optional(),
  impact: z.enum(["basse", "normale", "haute", "critique"]),
  planActions: z.string().optional(),
  responsableId: z.string().uuid().optional(),
  dateRevue: z.string().optional(),
});

export async function createRisque(formData: FormData) {
  await requireUser(ROLES_BUREAU);

  const responsableId = formData.get("responsableId");
  const parsed = risqueSchema.safeParse({
    type: formData.get("type"),
    titre: formData.get("titre"),
    description: formData.get("description") || undefined,
    impact: formData.get("impact"),
    planActions: formData.get("planActions") || undefined,
    responsableId: responsableId && responsableId !== "" ? responsableId : undefined,
    dateRevue: formData.get("dateRevue") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db.insert(risques).values({
    type: parsed.data.type,
    titre: parsed.data.titre,
    description: parsed.data.description ?? null,
    impact: parsed.data.impact,
    planActions: parsed.data.planActions ?? null,
    responsableId: parsed.data.responsableId ?? null,
    dateRevue: parsed.data.dateRevue ? new Date(parsed.data.dateRevue) : null,
  });

  revalidatePath("/responsable/risques");
}

const statutSchema = z.object({
  risqueId: z.string().uuid(),
  statut: z.enum(["identifie", "en_traitement", "maitrise"]),
});

export async function updateRisqueStatut(formData: FormData) {
  await requireUser(ROLES_BUREAU);

  const parsed = statutSchema.safeParse({
    risqueId: formData.get("risqueId"),
    statut: formData.get("statut"),
  });
  if (!parsed.success) throw new Error("Données invalides");

  await db
    .update(risques)
    .set({ statut: parsed.data.statut })
    .where(eq(risques.id, parsed.data.risqueId));

  revalidatePath("/responsable/risques");
}
