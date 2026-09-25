"use server";

import { z } from "zod";
import { db } from "@/db";
import { clients, devis, sites } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { and, count, eq, gte, lt } from "drizzle-orm";

const STATUTS = ["brouillon", "envoye", "accepte", "refuse"] as const;

async function generateNumero() {
  const annee = new Date().getFullYear();
  const debut = new Date(annee, 0, 1);
  const fin = new Date(annee + 1, 0, 1);
  const [{ n }] = await db
    .select({ n: count() })
    .from(devis)
    .where(and(gte(devis.createdAt, debut), lt(devis.createdAt, fin)));
  const sequence = Number(n) + 1;
  return `DEV-${annee}-${String(sequence).padStart(4, "0")}`;
}

const devisSchema = z.object({
  clientId: z.string().uuid("Client requis"),
  siteId: z.string().uuid().optional(),
  montantHt: z.coerce.number().nonnegative("Montant invalide").optional(),
  description: z.string().optional(),
});

export async function createDevis(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const siteId = formData.get("siteId");
  const montantHt = formData.get("montantHt");
  const parsed = devisSchema.safeParse({
    clientId: formData.get("clientId"),
    siteId: siteId && siteId !== "" ? siteId : undefined,
    montantHt: montantHt && montantHt !== "" ? montantHt : undefined,
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [clientExists] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, parsed.data.clientId))
    .limit(1);
  if (!clientExists) throw new Error("Client introuvable — impossible de créer le devis.");

  if (parsed.data.siteId) {
    const [siteExists] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.id, parsed.data.siteId))
      .limit(1);
    if (!siteExists) throw new Error("Site introuvable — impossible de créer le devis.");
  }

  const numero = await generateNumero();

  await db.insert(devis).values({
    numero,
    clientId: parsed.data.clientId,
    siteId: parsed.data.siteId ?? null,
    montantHt: parsed.data.montantHt !== undefined ? String(parsed.data.montantHt) : null,
    description: parsed.data.description ?? null,
    statut: "brouillon",
  });

  revalidatePath("/responsable/devis");
}

const statutSchema = z.object({
  id: z.string().uuid(),
  statut: z.enum(STATUTS),
});

export async function updateDevisStatut(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = statutSchema.safeParse({
    id: formData.get("id"),
    statut: formData.get("statut"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [existing] = await db
    .select({ id: devis.id, dateEnvoi: devis.dateEnvoi, dateReponse: devis.dateReponse })
    .from(devis)
    .where(eq(devis.id, parsed.data.id))
    .limit(1);
  if (!existing) throw new Error("Devis introuvable.");

  const now = new Date();
  const values: {
    statut: (typeof STATUTS)[number];
    dateEnvoi?: Date;
    dateReponse?: Date;
  } = { statut: parsed.data.statut };

  if (parsed.data.statut === "envoye" && !existing.dateEnvoi) {
    values.dateEnvoi = now;
  }
  if ((parsed.data.statut === "accepte" || parsed.data.statut === "refuse") && !existing.dateReponse) {
    values.dateReponse = now;
  }

  await db.update(devis).set(values).where(eq(devis.id, parsed.data.id));
  revalidatePath("/responsable/devis");
}
