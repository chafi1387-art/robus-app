"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { devisDestinataires } from "@/db/schema";
import { deciderDevis, hashJeton } from "@/lib/devis";

// Phase 25b : réponse au devis depuis le lien personnel reçu par email.
export async function repondreDevisParLien(formData: FormData) {
  const jeton = String(formData.get("jeton") ?? "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(jeton)) redirect("/connexion");
  const retour = `/devis/${jeton}`;
  const [dest] = await db
    .select({ devisId: devisDestinataires.devisId, peutDecider: devisDestinataires.peutDecider, nom: devisDestinataires.nom })
    .from(devisDestinataires)
    .where(and(eq(devisDestinataires.jetonHash, hashJeton(jeton)), eq(devisDestinataires.canal, "email")))
    .limit(1);
  if (!dest) redirect(retour);
  if (dest!.peutDecider !== 1) redirect(`${retour}?erreur=${encodeURIComponent("Ce devis vous est transmis pour information.")}`);
  const decision = formData.get("decision") === "refuse" ? "refuse" : "accepte";
  const nom = String(formData.get("nom") ?? "").trim().slice(0, 150);
  if (nom.length < 2) redirect(`${retour}?erreur=${encodeURIComponent("Indiquez votre nom.")}`);
  if (decision === "accepte" && formData.get("bonPourAccord") !== "on") {
    redirect(`${retour}?erreur=${encodeURIComponent("Cochez « Bon pour accord » pour accepter le devis.")}`);
  }
  try {
    await deciderDevis({ devisId: dest!.devisId, decision, nom, canal: "email", motif: String(formData.get("motif") ?? "").trim() || null });
  } catch (e) {
    redirect(`${retour}?erreur=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(`${retour}?reponse=${decision}`);
}
