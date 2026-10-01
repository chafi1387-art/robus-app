"use server";

import { z } from "zod";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appareils, interventions } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { notifierObservateurs } from "@/lib/observateur";

// Phase 18 : le bureau valide le rapport d'une mission terminée. Le rapport
// devient visible par les observateurs (droit « rapports ») et n'est plus
// modifiable par le technicien.
export async function validerRapport(formData: FormData) {
  const user = await requireUser(["administrateur", "responsable_qualite"]);
  const id = String(formData.get("interventionId") ?? "");
  if (!z.string().uuid().safeParse(id).success) throw new Error("Mission introuvable.");
  const maj = await db
    .update(interventions)
    .set({ statut: "validee", valideeLe: new Date(), valideeParId: user.id })
    .where(and(eq(interventions.id, id), eq(interventions.statut, "terminee")))
    .returning({ appareilId: interventions.appareilId });
  if (maj.length) {
    await journaliser({ entite: "intervention", entiteId: id, action: "rapport_valide", utilisateurId: user.id });
    const [a] = await db.select({ numero: appareils.numeroInterne }).from(appareils).where(eq(appareils.id, maj[0].appareilId)).limit(1);
    after(() =>
      notifierObservateurs(
        maj[0].appareilId,
        "rapports",
        {
          titre: "📄 Rapport d'intervention disponible",
          corps: `Le rapport de l'intervention sur l'ascenseur ${a?.numero ?? ""} est disponible.`,
          url: `/observateur/interventions/${id}`,
        },
        true
      )
    );
  }
  revalidatePath(`/responsable/missions/${id}`);
}

