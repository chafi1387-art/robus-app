import { auth } from "@/auth";
import {
  DOSSIERS_TELEVERSEMENT,
  FICHIER_MAX,
  PHOTO_MAX,
  TYPES_FICHIER,
  TYPES_PHOTO,
  creerReference,
  enregistrerTeleversement,
  type DossierTeleversement,
} from "@/lib/televersement";

// Phase 25 : réception d'UN fichier (photo ou document) envoyé par le
// navigateur, avec barre de progression côté écran. Réservé aux personnes
// connectées. Réponse : { ref, url, nom } — la référence signée est ensuite
// jointe au formulaire à la place du fichier lui-même.
export const dynamic = "force-dynamic";

function erreur(message: string, status = 400) {
  return Response.json({ erreur: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return erreur("Session expirée — reconnectez-vous.", 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return erreur("Envoi interrompu — réessayez.");
  }
  const type = String(form.get("type") ?? "photo");
  const dossier = String(form.get("dossier") ?? "rapports") as DossierTeleversement;
  if (!DOSSIERS_TELEVERSEMENT.includes(dossier)) return erreur("Dossier non autorisé.");
  const fichier = form.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) return erreur("Aucun fichier reçu.");

  const types = type === "photo" ? TYPES_PHOTO : TYPES_FICHIER;
  const max = type === "photo" ? PHOTO_MAX : FICHIER_MAX;
  const extension = types[fichier.type];
  if (!extension) {
    return erreur(type === "photo" ? "Format de photo non supporté (JPEG, PNG ou WEBP)." : "Format non accepté (PDF, image, Word, Excel ou PowerPoint).");
  }
  if (fichier.size > max) return erreur(`Fichier trop lourd (${Math.round(max / 1048576)} Mo maximum).`);

  const mini = form.get("mini");
  const nomOrigine = String(form.get("nom") || fichier.name || "fichier").slice(0, 160);
  const url = await enregistrerTeleversement(dossier, `u${userId.slice(0, 8)}`, fichier, extension, mini instanceof File ? mini : null);
  return Response.json(
    { ref: creerReference(userId, url, nomOrigine), url, nom: nomOrigine },
    { headers: { "Cache-Control": "no-store" } }
  );
}
