"use server";

import { z } from "zod";
import { db } from "@/db";
import { auditeurs } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Phase 9a : fiche Auditeur — un contact (interne ou externe, ex. organisme
// de certification), sans compte de connexion. Sert à affecter un auditeur
// à un Audit (voir src/app/responsable/audits/).

const auditeurSchema = z.object({
  nom: z.string().min(2, "Nom requis"),
  organisme: z.string().optional(),
  numeroCertification: z.string().optional(),
  telephone: z.string().optional(),
  email: z.string().email("Email invalide").optional().or(z.literal("")),
  specialite: z.string().optional(),
});

export async function createAuditeur(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = auditeurSchema.safeParse({
    nom: formData.get("nom"),
    organisme: formData.get("organisme") || undefined,
    numeroCertification: formData.get("numeroCertification") || undefined,
    telephone: formData.get("telephone") || undefined,
    email: formData.get("email") || undefined,
    specialite: formData.get("specialite") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [created] = await db
    .insert(auditeurs)
    .values({
      nom: parsed.data.nom,
      organisme: parsed.data.organisme || null,
      numeroCertification: parsed.data.numeroCertification || null,
      telephone: parsed.data.telephone || null,
      email: parsed.data.email || null,
      specialite: parsed.data.specialite || null,
    })
    .returning();

  await journaliser({
    entite: "auditeurs",
    entiteId: created.id,
    action: "creation",
    utilisateurId: user.id,
    details: parsed.data.nom,
  });

  revalidatePath("/responsable/auditeurs");
  redirect("/responsable/auditeurs");
}
