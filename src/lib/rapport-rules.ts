// Phase 10 : règle de verrouillage de l'heure réelle d'une intervention.
// Fichier à part (et non dans technicien/actions.ts) car un fichier
// "use server" ne peut exporter que des fonctions async — cette règle doit
// pourtant être utilisable telle quelle côté page (Server Component) pour
// savoir s'il faut afficher le formulaire de correction.
export const DELAI_MODIF_HEURE_REELLE_MS = 24 * 60 * 60 * 1000;

export function peutModifierHeureReelle(dateProgrammee: Date | null, role: string) {
  if (role === "administrateur") return true;
  if (!dateProgrammee) return true;
  return Date.now() <= dateProgrammee.getTime() + DELAI_MODIF_HEURE_REELLE_MS;
}
