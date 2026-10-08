"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";

// Phase 25 : appelé par l'écran quand un changement le concerne → la page
// affichée est recalculée ET le cache de navigation du navigateur est vidé
// (sinon une page déjà visitée pourrait réapparaître sans la mise à jour).
export async function actualiserEcran() {
  await requireUser();
  revalidatePath("/", "layout");
}
