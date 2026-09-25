"use server";

import { z } from "zod";
import { db } from "@/db";
import { revuesDirection } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { revalidatePath } from "next/cache";

const revueSchema = z.object({
  dateRevue: z.string().min(1, "Date requise"),
  participants: z.string().optional(),
  pointsAbordes: z.string().optional(),
  decisions: z.string().optional(),
});

export async function createRevueDirection(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);

  const parsed = revueSchema.safeParse({
    dateRevue: formData.get("dateRevue"),
    participants: formData.get("participants") || undefined,
    pointsAbordes: formData.get("pointsAbordes") || undefined,
    decisions: formData.get("decisions") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [created] = await db
    .insert(revuesDirection)
    .values({
      dateRevue: new Date(parsed.data.dateRevue),
      participants: parsed.data.participants ?? null,
      pointsAbordes: parsed.data.pointsAbordes ?? null,
      decisions: parsed.data.decisions ?? null,
    })
    .returning();

  await journaliser({
    entite: "revues_direction",
    entiteId: created.id,
    action: "creation",
    utilisateurId: user.id,
  });

  revalidatePath("/responsable/revues-direction");
}
