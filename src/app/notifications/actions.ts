"use server";

import { z } from "zod";
import { db } from "@/db";
import { pushAbonnements } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { notifierUtilisateurs } from "@/lib/push";
import { and, eq } from "drizzle-orm";

const abonnementSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(5).max(200) }),
  appareil: z.string().max(200).optional(),
});

export async function enregistrerAbonnementPush(input: unknown) {
  const user = await requireUser();
  const p = abonnementSchema.safeParse(input);
  if (!p.success) return { ok: false as const };
  // Un appareil = un abonnement ; s'il appartenait à un autre compte, il change de propriétaire.
  await db.delete(pushAbonnements).where(eq(pushAbonnements.endpoint, p.data.endpoint));
  await db.insert(pushAbonnements).values({
    userId: user.id,
    endpoint: p.data.endpoint,
    p256dh: p.data.keys.p256dh,
    auth: p.data.keys.auth,
    appareil: p.data.appareil ?? null,
  });
  await notifierUtilisateurs([user.id], { titre: "ROBUS", corps: "Notifications activées sur cet appareil ✓", url: "/", tag: "activation" });
  return { ok: true as const };
}

export async function supprimerAbonnementPush(endpoint: string) {
  const user = await requireUser();
  await db.delete(pushAbonnements).where(and(eq(pushAbonnements.endpoint, String(endpoint)), eq(pushAbonnements.userId, user.id)));
  return { ok: true as const };
}
