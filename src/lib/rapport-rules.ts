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

// Phase 18 : le technicien peut corriger son rapport (texte, temps, heure
// réelle, photos) pendant 24 h après la FIN de l'intervention, tant que le
// bureau ne l'a pas validé. L'administrateur garde la main sans limite.
export const DELAI_MODIF_RAPPORT_MS = 24 * 60 * 60 * 1000;

export function finModificationRapport(dateFin: Date | null) {
  return dateFin ? new Date(dateFin.getTime() + DELAI_MODIF_RAPPORT_MS) : null;
}

export function peutModifierRapport(i: { statut: string; dateFin: Date | null }, role: string) {
  if (role === "administrateur") return ["terminee", "validee", "cloturee"].includes(i.statut);
  if (i.statut !== "terminee" || !i.dateFin) return false;
  return Date.now() <= i.dateFin.getTime() + DELAI_MODIF_RAPPORT_MS;
}

/** « 5 h 12 » restantes, ou null si le délai est dépassé. */
export function tempsRestantModification(dateFin: Date | null) {
  if (!dateFin) return null;
  const reste = dateFin.getTime() + DELAI_MODIF_RAPPORT_MS - Date.now();
  if (reste <= 0) return null;
  const h = Math.floor(reste / 3600000);
  const m = Math.floor((reste % 3600000) / 60000);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}
