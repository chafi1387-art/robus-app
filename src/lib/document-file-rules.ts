// Règles de validation des fichiers uploadés pour Documents & Formations —
// centralisées ici pour être partagées entre la Server Action
// (src/app/responsable/documents/actions.ts, qui est un fichier "use server"
// et ne peut donc exporter que des fonctions async) et le formulaire d'ajout
// inline sur la fiche Projet (src/app/responsable/projets/[id]/page.tsx).
export const FICHIER_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
};
export const FICHIER_MAX_BYTES = 200 * 1024 * 1024;
