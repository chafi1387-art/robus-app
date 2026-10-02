"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { BLOCS_ACCES, enregistrerReglagesAcces, type BlocAcces } from "@/lib/acces-technicien";
import { avecMessage } from "@/lib/url";

// Phase 22 : le bureau choisit ce que le technicien voit en scannant un appareil.
export async function enregistrerAccesTechnicien(formData: FormData) {
  const user = await requireUser(["administrateur", "responsable_qualite"]);
  const blocs = Object.fromEntries(Object.keys(BLOCS_ACCES).map((k) => [k, formData.get(`bloc_${k}`) === "on"])) as Record<BlocAcces, boolean>;
  const portee = formData.get("portee") === "concernes" ? "concernes" : "tous";
  await enregistrerReglagesAcces({ blocs, portee });
  await journaliser({
    entite: "parametres",
    entiteId: user.id,
    action: "acces_technicien_appareils",
    utilisateurId: user.id,
    details: `${portee} — visibles : ${Object.entries(blocs).filter(([, v]) => v).map(([k]) => BLOCS_ACCES[k as BlocAcces].label).join(", ")}`,
  });
  revalidatePath("/technicien", "layout");
  redirect(avecMessage("/responsable/techniciens/acces-appareils", "ok", "Réglages enregistrés — appliqués immédiatement aux techniciens."));
}
