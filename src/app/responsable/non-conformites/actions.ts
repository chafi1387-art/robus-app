"use server";

import { z } from "zod";
import { db } from "@/db";
import { nonConformites } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

const emptyToUndefined = (v: FormDataEntryValue | null) => (v && v !== "" ? v : undefined);

const createSchema = z.object({
  titre: z.string().min(3, "Titre requis"),
  description: z.string().optional(),
  gravite: z.enum(["mineure", "majeure", "critique"]),
  clientId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  appareilId: z.string().uuid().optional(),
  interventionId: z.string().uuid().optional(),
  responsableActionId: z.string().uuid().optional(),
  actionCorrective: z.string().optional(),
  dateEcheance: z.string().optional(),
});

export async function createNonConformite(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);

  const parsed = createSchema.safeParse({
    titre: formData.get("titre"),
    description: emptyToUndefined(formData.get("description")),
    gravite: formData.get("gravite"),
    clientId: emptyToUndefined(formData.get("clientId")),
    siteId: emptyToUndefined(formData.get("siteId")),
    appareilId: emptyToUndefined(formData.get("appareilId")),
    interventionId: emptyToUndefined(formData.get("interventionId")),
    responsableActionId: emptyToUndefined(formData.get("responsableActionId")),
    actionCorrective: emptyToUndefined(formData.get("actionCorrective")),
    dateEcheance: emptyToUndefined(formData.get("dateEcheance")),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [created] = await db
    .insert(nonConformites)
    .values({
      titre: parsed.data.titre,
      description: parsed.data.description ?? null,
      gravite: parsed.data.gravite,
      clientId: parsed.data.clientId ?? null,
      siteId: parsed.data.siteId ?? null,
      appareilId: parsed.data.appareilId ?? null,
      interventionId: parsed.data.interventionId ?? null,
      declarantId: user.id,
      responsableActionId: parsed.data.responsableActionId ?? null,
      actionCorrective: parsed.data.actionCorrective ?? null,
      dateEcheance: parsed.data.dateEcheance ? new Date(parsed.data.dateEcheance) : null,
    })
    .returning();

  await journaliser({
    entite: "non_conformites",
    entiteId: created.id,
    action: "creation",
    utilisateurId: user.id,
    details: parsed.data.titre,
  });

  revalidatePath("/responsable/non-conformites");
  redirect(`/responsable/non-conformites/${created.id}`);
}

const statutSchema = z.object({
  id: z.string().uuid(),
  statut: z.enum(["ouverte", "en_cours", "cloturee"]),
});

export async function updateNonConformiteStatut(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = statutSchema.safeParse({
    id: formData.get("id"),
    statut: formData.get("statut"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db
    .update(nonConformites)
    .set({
      statut: parsed.data.statut,
      dateCloture: parsed.data.statut === "cloturee" ? new Date() : null,
    })
    .where(eq(nonConformites.id, parsed.data.id));

  await journaliser({
    entite: "non_conformites",
    entiteId: parsed.data.id,
    action: `statut_${parsed.data.statut}`,
    utilisateurId: user.id,
  });

  revalidatePath(`/responsable/non-conformites/${parsed.data.id}`);
  revalidatePath("/responsable/non-conformites");
  redirect(`/responsable/non-conformites/${parsed.data.id}`);
}

const actionSchema = z.object({
  id: z.string().uuid(),
  actionCorrective: z.string().optional(),
});

export async function updateActionCorrective(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = actionSchema.safeParse({
    id: formData.get("id"),
    actionCorrective: emptyToUndefined(formData.get("actionCorrective")),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db
    .update(nonConformites)
    .set({ actionCorrective: parsed.data.actionCorrective ?? null })
    .where(eq(nonConformites.id, parsed.data.id));

  revalidatePath(`/responsable/non-conformites/${parsed.data.id}`);
  redirect(`/responsable/non-conformites/${parsed.data.id}`);
}
