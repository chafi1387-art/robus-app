"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { interventions, rapportPhotos, rapports } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { lireAnnulation } from "@/lib/annulation";

// Phase 25 : bouton « Annuler » du message de confirmation (2 minutes).
export async function annulerRetrait(jeton: string): Promise<{ erreur?: string; message?: string }> {
  const user = await requireUser();
  const a = lireAnnulation(String(jeton ?? ""), user.id);
  if (!a) return { erreur: "Trop tard pour annuler (2 minutes maximum)." };

  if (a.k === "photo_rapport" || a.k === "photo_bureau") {
    const [r] = await db
      .select({ id: rapports.id, technicienId: interventions.technicienId })
      .from(rapports)
      .innerJoin(interventions, eq(rapports.interventionId, interventions.id))
      .where(and(eq(rapports.id, a.rapportId), eq(rapports.interventionId, a.interventionId)))
      .limit(1);
    if (!r) return { erreur: "Rapport introuvable." };
    const [deja] = await db
      .select({ id: rapportPhotos.id })
      .from(rapportPhotos)
      .where(and(eq(rapportPhotos.rapportId, a.rapportId), eq(rapportPhotos.url, a.url)))
      .limit(1);
    if (!deja) await db.insert(rapportPhotos).values({ rapportId: a.rapportId, url: a.url });
    await journaliser({
      entite: "intervention",
      entiteId: a.interventionId,
      action: a.k === "photo_bureau" ? "bureau_photo_remise" : "rapport_photo_remise",
      utilisateurId: user.id,
      details: "Retrait annulé",
    });
    revalidatePath(`/technicien/interventions/${a.interventionId}`);
    revalidatePath(`/responsable/missions/${a.interventionId}`);
    return { message: "Photo remise ✓" };
  }
  return { erreur: "Action impossible à annuler." };
}
