"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { photosRecues } from "@/lib/photos";
import { fichiersRecus } from "@/lib/fichiers";
import { creerSignalement } from "@/lib/signalements";
import { TYPES_SIGNALEMENT } from "@/lib/signalements-types";

// Phase 21 : le technicien envoie un signalement (petit rapport + photos /
// document). Le bureau est prévenu immédiatement (notification + email).
export async function envoyerSignalement(formData: FormData) {
  const user = await requireUser(["technicien"]);
  const type = String(formData.get("type") ?? "");
  const interventionId = String(formData.get("interventionId") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim().slice(0, 4000);
  const lieu = String(formData.get("lieu") ?? "").trim().slice(0, 200);
  const retour = (m: string) =>
    redirect(`/technicien/signaler?type=${encodeURIComponent(type)}${interventionId ? `&mission=${interventionId}` : ""}&erreur=${encodeURIComponent(m)}`);
  if (!TYPES_SIGNALEMENT[type]) redirect("/technicien/signaler");
  if (description.length < 5) retour("Décrivez ce qui s'est passé (quelques mots suffisent).");
  if (interventionId && !/^[0-9a-f-]{36}$/i.test(interventionId)) retour("Mission invalide.");
  const prefixe = `sig-${user.id.slice(0, 8)}`;
  let urls: string[] = [];
  let docs: { url: string; nom: string }[] = [];
  try {
    urls = await photosRecues(formData, prefixe, user.id, "photos", 20);
    docs = await fichiersRecus(formData, "signalements", prefixe, user.id, "fichiers", 5);
  } catch (e) {
    retour((e as Error).message);
  }
  let id = "";
  try {
    const r = await creerSignalement({
      technicienId: user.id,
      technicienNom: user.name ?? "Technicien",
      type,
      description,
      lieu: lieu || null,
      blesse: formData.get("blesse") === "on",
      bloquant: formData.get("bloquant") === "on",
      interventionId: interventionId || null,
      photos: urls,
      fichiers: docs,
    });
    id = r.id;
  } catch (e) {
    retour((e as Error).message);
  }
  revalidatePath("/technicien");
  revalidatePath("/technicien/signalements");
  redirect(`/technicien/signalements/${id}?envoye=1`);
}
