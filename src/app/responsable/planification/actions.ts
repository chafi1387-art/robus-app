"use server";

import { z } from "zod";
import { db } from "@/db";
import { appareils, garanties, interventions, reglesPlanification } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

function addMois(date: Date, mois: number) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + mois);
  return result;
}

const regleSchema = z.object({
  appareilId: z.string().uuid(),
  type: z.enum(["preventive", "corrective", "systematique"]).default("preventive"),
  periodiciteMois: z.coerce.number().int().positive(),
  anticipationJours: z.coerce.number().int().min(0).default(15),
  prochaineDate: z.string().min(1, "Date requise"),
});

export async function createRegle(formData: FormData) {
  await requireUser(ROLES_BUREAU);

  const parsed = regleSchema.safeParse({
    appareilId: formData.get("appareilId"),
    type: formData.get("type") || "preventive",
    periodiciteMois: formData.get("periodiciteMois"),
    anticipationJours: formData.get("anticipationJours") || 15,
    prochaineDate: formData.get("prochaineDate"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db.insert(reglesPlanification).values({
    appareilId: parsed.data.appareilId,
    type: parsed.data.type,
    periodiciteMois: parsed.data.periodiciteMois,
    anticipationJours: parsed.data.anticipationJours,
    prochaineDate: new Date(parsed.data.prochaineDate),
  });

  revalidatePath("/responsable/planification");
}

export async function toggleRegleActive(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const id = formData.get("id") as string;
  const [regle] = await db
    .select({ actif: reglesPlanification.actif })
    .from(reglesPlanification)
    .where(eq(reglesPlanification.id, id))
    .limit(1);
  if (!regle) throw new Error("Règle introuvable.");
  await db
    .update(reglesPlanification)
    .set({ actif: regle.actif === 1 ? 0 : 1 })
    .where(eq(reglesPlanification.id, id));
  revalidatePath("/responsable/planification");
}

/**
 * Génère les interventions préventives à venir : pour chaque règle active
 * dont la prochaine échéance tombe dans la fenêtre d'anticipation, on crée
 * une intervention "creee" et on avance la règle d'une périodicité — ce qui
 * rend l'opération naturellement idempotente en usage normal (on ne peut
 * pas régénérer la même échéance sans qu'elle ait déjà avancé).
 *
 * Phase 5 — planning automatique de garantie : une règle peut porter un
 * `garantieId` (créée automatiquement lors de l'attribution d'une garantie
 * à un Projet, voir responsable/projets/actions.ts). Dans ce cas, chaque
 * génération décrémente le compteur de visites restantes de la garantie et
 * rattache l'intervention générée au Projet de la garantie ; la règle se
 * désactive elle-même une fois le quota épuisé.
 */
export async function genererInterventionsPlanifiees() {
  await requireUser(ROLES_BUREAU);

  const now = new Date();
  const dansNJours = (n: number) => new Date(now.getTime() + n * 86400000);

  const regles = await db
    .select()
    .from(reglesPlanification)
    .where(eq(reglesPlanification.actif, 1));

  let nbGenerees = 0;
  for (const regle of regles) {
    const limite = dansNJours(regle.anticipationJours);
    if (regle.prochaineDate > limite) continue;

    let projetId: string | null = null;
    let garantieEpuisee = false;

    if (regle.garantieId) {
      const [garantie] = await db
        .select({
          id: garanties.id,
          projetId: garanties.projetId,
          interventionsRestantes: garanties.interventionsRestantes,
        })
        .from(garanties)
        .where(eq(garanties.id, regle.garantieId))
        .limit(1);

      // Garantie supprimée ou déjà épuisée entre-temps : on ne génère rien
      // de plus pour cette règle et on la désactive proprement.
      if (!garantie || garantie.interventionsRestantes <= 0) {
        await db
          .update(reglesPlanification)
          .set({ actif: 0 })
          .where(eq(reglesPlanification.id, regle.id));
        continue;
      }

      projetId = garantie.projetId;
      const restantes = garantie.interventionsRestantes - 1;
      await db
        .update(garanties)
        .set({ interventionsRestantes: restantes })
        .where(eq(garanties.id, garantie.id));
      garantieEpuisee = restantes <= 0;
    }

    await db.insert(interventions).values({
      appareilId: regle.appareilId,
      projetId,
      type: regle.type,
      statut: "creee",
      priorite: "normale",
      description: regle.garantieId
        ? "Visite de garantie générée automatiquement (planning)."
        : "Intervention préventive générée automatiquement (planning).",
      dateProgrammee: regle.prochaineDate,
    });

    await db
      .update(reglesPlanification)
      .set({
        prochaineDate: addMois(regle.prochaineDate, regle.periodiciteMois),
        ...(garantieEpuisee ? { actif: 0 } : {}),
      })
      .where(eq(reglesPlanification.id, regle.id));

    nbGenerees++;
  }

  revalidatePath("/responsable/planification");
  revalidatePath("/responsable/interventions");
  revalidatePath("/responsable/projets");
  revalidatePath("/responsable/garanties");
  revalidatePath("/responsable");
  redirect(`/responsable/planification?generees=${nbGenerees}`);
}
