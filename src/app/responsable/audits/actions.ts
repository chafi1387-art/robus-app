"use server";

import { z } from "zod";
import { db } from "@/db";
import { auditeurs, audits } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

const auditSchema = z.object({
  type: z.enum(["interne", "externe"]),
  titre: z.string().min(2, "Titre requis"),
  datePlanifiee: z.string().optional(),
  // Phase 9a : remplace l'ancien champ auditeurId (compte utilisateur) par
  // un lien vers une fiche Auditeur dédiée — voir src/app/responsable/auditeurs/.
  auditeurFicheId: z.string().uuid().optional(),
});

export async function createAudit(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const auditeurFicheId = formData.get("auditeurFicheId");
  const parsed = auditSchema.safeParse({
    type: formData.get("type"),
    titre: formData.get("titre"),
    datePlanifiee: formData.get("datePlanifiee") || undefined,
    auditeurFicheId: auditeurFicheId && auditeurFicheId !== "" ? auditeurFicheId : undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  if (parsed.data.auditeurFicheId) {
    const [exists] = await db
      .select({ id: auditeurs.id })
      .from(auditeurs)
      .where(eq(auditeurs.id, parsed.data.auditeurFicheId))
      .limit(1);
    if (!exists) throw new Error("Auditeur introuvable.");
  }

  const [created] = await db
    .insert(audits)
    .values({
      type: parsed.data.type,
      titre: parsed.data.titre,
      datePlanifiee: parsed.data.datePlanifiee ? new Date(parsed.data.datePlanifiee) : null,
      auditeurFicheId: parsed.data.auditeurFicheId ?? null,
    })
    .returning();

  await journaliser({
    entite: "audits",
    entiteId: created.id,
    action: "creation",
    utilisateurId: user.id,
    details: parsed.data.titre,
  });

  revalidatePath("/responsable/audits");
  redirect("/responsable/audits");
}

const resultatsSchema = z.object({
  auditId: z.string().uuid(),
  constats: z.string().optional(),
  actionsSuivi: z.string().optional(),
  terminer: z.coerce.boolean().optional(),
});

export async function updateAuditResultats(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = resultatsSchema.safeParse({
    auditId: formData.get("auditId"),
    constats: formData.get("constats") || undefined,
    actionsSuivi: formData.get("actionsSuivi") || undefined,
    terminer: formData.get("terminer") === "on" || formData.get("terminer") === "true",
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [existing] = await db
    .select({ id: audits.id, statut: audits.statut })
    .from(audits)
    .where(eq(audits.id, parsed.data.auditId))
    .limit(1);
  if (!existing) throw new Error("Audit introuvable.");

  if (parsed.data.terminer) {
    await db
      .update(audits)
      .set({
        constats: parsed.data.constats ?? null,
        actionsSuivi: parsed.data.actionsSuivi ?? null,
        statut: "termine",
        dateRealisation: new Date(),
      })
      .where(eq(audits.id, parsed.data.auditId));
  } else {
    await db
      .update(audits)
      .set({
        constats: parsed.data.constats ?? null,
        actionsSuivi: parsed.data.actionsSuivi ?? null,
        statut: existing.statut === "planifie" ? "en_cours" : existing.statut,
      })
      .where(eq(audits.id, parsed.data.auditId));
  }

  await journaliser({
    entite: "audits",
    entiteId: parsed.data.auditId,
    action: parsed.data.terminer ? "cloture" : "mise_a_jour",
    utilisateurId: user.id,
  });

  revalidatePath("/responsable/audits");
  redirect("/responsable/audits");
}
