"use server";

import { z } from "zod";
import { db } from "@/db";
import { clients, enquetesSatisfaction, interventions, reclamationsClient, sites } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

const PATH = "/responsable/satisfaction";

const enqueteSchema = z.object({
  clientId: z.string().uuid("Client requis"),
  interventionId: z.string().uuid().optional(),
  note: z.coerce.number().int().min(1, "Note entre 1 et 5").max(5, "Note entre 1 et 5"),
  commentaire: z.string().optional(),
});

export async function createEnquete(formData: FormData) {
  await requireUser(ROLES_BUREAU);

  const interventionId = formData.get("interventionId");
  const parsed = enqueteSchema.safeParse({
    clientId: formData.get("clientId"),
    interventionId: interventionId && interventionId !== "" ? interventionId : undefined,
    note: formData.get("note"),
    commentaire: formData.get("commentaire") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [clientExists] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, parsed.data.clientId))
    .limit(1);
  if (!clientExists) throw new Error("Client introuvable — impossible de créer l'enquête.");

  await db.insert(enquetesSatisfaction).values({
    clientId: parsed.data.clientId,
    interventionId: parsed.data.interventionId ?? null,
    note: parsed.data.note,
    commentaire: parsed.data.commentaire ?? null,
  });

  revalidatePath(PATH);
}

const reclamationSchema = z.object({
  clientId: z.string().uuid("Client requis"),
  siteId: z.string().uuid().optional(),
  description: z.string().min(3, "Description requise"),
});

export async function createReclamation(formData: FormData) {
  await requireUser(ROLES_BUREAU);

  const siteId = formData.get("siteId");
  const parsed = reclamationSchema.safeParse({
    clientId: formData.get("clientId"),
    siteId: siteId && siteId !== "" ? siteId : undefined,
    description: formData.get("description"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [clientExists] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, parsed.data.clientId))
    .limit(1);
  if (!clientExists) throw new Error("Client introuvable — impossible de créer la réclamation.");

  await db.insert(reclamationsClient).values({
    clientId: parsed.data.clientId,
    siteId: parsed.data.siteId ?? null,
    description: parsed.data.description,
    statut: "ouverte",
  });

  revalidatePath(PATH);
}

const statutSchema = z.object({
  id: z.string().uuid(),
  statut: z.enum(["ouverte", "en_cours", "cloturee"]),
});

export async function updateReclamationStatut(formData: FormData) {
  await requireUser(ROLES_BUREAU);

  const parsed = statutSchema.safeParse({
    id: formData.get("id"),
    statut: formData.get("statut"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db
    .update(reclamationsClient)
    .set({
      statut: parsed.data.statut,
      dateResolution: parsed.data.statut === "cloturee" ? new Date() : null,
    })
    .where(eq(reclamationsClient.id, parsed.data.id));

  revalidatePath(PATH);
}

// Utilitaires de lecture pour la page (regroupés ici pour rester cohérent
// avec le pattern getTechniciens() de ../actions.ts).
export async function getEnquetes() {
  await requireUser(ROLES_BUREAU);
  return db
    .select({
      id: enquetesSatisfaction.id,
      note: enquetesSatisfaction.note,
      commentaire: enquetesSatisfaction.commentaire,
      dateEnquete: enquetesSatisfaction.dateEnquete,
      raisonSociale: clients.raisonSociale,
      interventionId: interventions.id,
      interventionType: interventions.type,
    })
    .from(enquetesSatisfaction)
    .innerJoin(clients, eq(enquetesSatisfaction.clientId, clients.id))
    .leftJoin(interventions, eq(enquetesSatisfaction.interventionId, interventions.id))
    .orderBy(enquetesSatisfaction.dateEnquete);
}

export async function getReclamations() {
  await requireUser(ROLES_BUREAU);
  return db
    .select({
      id: reclamationsClient.id,
      description: reclamationsClient.description,
      statut: reclamationsClient.statut,
      dateReclamation: reclamationsClient.dateReclamation,
      dateResolution: reclamationsClient.dateResolution,
      raisonSociale: clients.raisonSociale,
      adresse: sites.adresse,
    })
    .from(reclamationsClient)
    .innerJoin(clients, eq(reclamationsClient.clientId, clients.id))
    .leftJoin(sites, eq(reclamationsClient.siteId, sites.id))
    .orderBy(reclamationsClient.dateReclamation);
}
