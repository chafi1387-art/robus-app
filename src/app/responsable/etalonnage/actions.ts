"use server";

import { z } from "zod";
import { db } from "@/db";
import { instrumentsMesure } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

function addMois(date: Date, mois: number) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + mois);
  return result;
}

const instrumentSchema = z.object({
  nom: z.string().min(2, "Nom requis"),
  reference: z.string().optional(),
  dateDernierEtalonnage: z.string().optional(),
  periodiciteMois: z.coerce.number().int().positive().default(12),
});

export async function createInstrument(formData: FormData) {
  await requireUser(ROLES_BUREAU);

  const parsed = instrumentSchema.safeParse({
    nom: formData.get("nom"),
    reference: formData.get("reference") || undefined,
    dateDernierEtalonnage: formData.get("dateDernierEtalonnage") || undefined,
    periodiciteMois: formData.get("periodiciteMois") || 12,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const dateDernierEtalonnage = parsed.data.dateDernierEtalonnage
    ? new Date(parsed.data.dateDernierEtalonnage)
    : null;
  const dateProchainEtalonnage = dateDernierEtalonnage
    ? addMois(dateDernierEtalonnage, parsed.data.periodiciteMois)
    : null;

  await db.insert(instrumentsMesure).values({
    nom: parsed.data.nom,
    reference: parsed.data.reference ?? null,
    dateDernierEtalonnage,
    periodiciteMois: parsed.data.periodiciteMois,
    dateProchainEtalonnage,
  });

  revalidatePath("/responsable/etalonnage");
}

const etalonnageSchema = z.object({
  instrumentId: z.string().uuid(),
  date: z.string().min(1, "Date requise"),
});

export async function enregistrerEtalonnage(formData: FormData) {
  await requireUser(ROLES_BUREAU);

  const parsed = etalonnageSchema.safeParse({
    instrumentId: formData.get("instrumentId"),
    date: formData.get("date"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [instrument] = await db
    .select({ periodiciteMois: instrumentsMesure.periodiciteMois })
    .from(instrumentsMesure)
    .where(eq(instrumentsMesure.id, parsed.data.instrumentId))
    .limit(1);
  if (!instrument) throw new Error("Instrument introuvable.");

  const dateDernierEtalonnage = new Date(parsed.data.date);
  const dateProchainEtalonnage = addMois(dateDernierEtalonnage, instrument.periodiciteMois);

  await db
    .update(instrumentsMesure)
    .set({ dateDernierEtalonnage, dateProchainEtalonnage })
    .where(eq(instrumentsMesure.id, parsed.data.instrumentId));

  revalidatePath("/responsable/etalonnage");
}
