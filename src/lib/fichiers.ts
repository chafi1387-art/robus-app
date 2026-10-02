import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Phase 19 : pièces jointes (certificats, documents de mission, rapports du
// bureau). Fichiers rangés sous public/uploads/<dossier>/ — servis par nginx
// aux seuls utilisateurs connectés.
export const FICHIERS_JOINTS_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};
export const FICHIER_JOINT_MAX = 20 * 1024 * 1024;
export const ACCEPT_FICHIERS_JOINTS = Object.keys(FICHIERS_JOINTS_TYPES).join(",");

export function fichiersDuFormulaire(formData: FormData, champ = "fichiers", max = 10) {
  const fichiers = formData.getAll(champ).filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length > max) throw new Error(`${max} fichiers maximum.`);
  for (const f of fichiers) {
    if (f.size > FICHIER_JOINT_MAX) throw new Error(`Le fichier "${f.name}" dépasse 20 Mo.`);
    if (!FICHIERS_JOINTS_TYPES[f.type]) throw new Error(`Format non accepté pour "${f.name}" (PDF, image, Word, Excel ou PowerPoint).`);
  }
  return fichiers;
}

export async function enregistrerFichiers(fichiers: File[], dossier: "missions" | "habilitations" | "signalements" | "formations", prefixe: string) {
  const rep = path.join(process.cwd(), "public", "uploads", dossier);
  await mkdir(rep, { recursive: true });
  const res: { url: string; nom: string }[] = [];
  for (const f of fichiers) {
    const nom = `${prefixe}-${Date.now()}-${Math.round(Math.random() * 1e6)}.${FICHIERS_JOINTS_TYPES[f.type]}`;
    await writeFile(path.join(rep, nom), Buffer.from(await f.arrayBuffer()));
    res.push({ url: `/uploads/${dossier}/${nom}`, nom: f.name.slice(0, 160) });
  }
  return res;
}
