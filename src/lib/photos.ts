import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Phase 18 : enregistrement des photos de mission (fil en direct, rapport,
// corrections 24 h) — mêmes règles que le rapport de fin de mission.
export const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTOS_MAX_PAR_ENVOI = 10;

export function photosDuFormulaire(formData: FormData, champ = "photos") {
  const fichiers = formData.getAll(champ).filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length > PHOTOS_MAX_PAR_ENVOI) throw new Error(`${PHOTOS_MAX_PAR_ENVOI} photos maximum par envoi.`);
  for (const f of fichiers) {
    if (f.size > PHOTO_MAX_BYTES) throw new Error(`La photo "${f.name}" dépasse la taille maximale de 8 Mo.`);
    if (!PHOTO_TYPES[f.type]) throw new Error("Format de photo non supporté — utilisez JPEG, PNG ou WEBP.");
  }
  return fichiers;
}

export async function enregistrerPhotos(fichiers: File[], prefixe: string) {
  const dossier = path.join(process.cwd(), "public", "uploads", "rapports");
  await mkdir(dossier, { recursive: true });
  const urls: string[] = [];
  for (const f of fichiers) {
    const nom = `${prefixe}-${Date.now()}-${Math.round(Math.random() * 1e6)}.${PHOTO_TYPES[f.type]}`;
    await writeFile(path.join(dossier, nom), Buffer.from(await f.arrayBuffer()));
    urls.push(`/uploads/rapports/${nom}`);
  }
  return urls;
}
