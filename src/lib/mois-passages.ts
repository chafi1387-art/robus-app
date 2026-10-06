// Phase 24 : mois des passages d'un contrat (au milieu de chaque période),
// ex. 12 mois / 4 passages -> 1,5 · 4,5 · 7,5 · 10,5. Partagé client/serveur.
export function moisPassages(dureeMois: number, n: number) {
  if (!dureeMois || !n || n < 1) return [];
  return Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * dureeMois * 10) / n) / 10);
}

export const fmtMois = (m: number) => String(m).replace(".", ",");

export const TYPE_MISSION_LABEL: Record<string, string> = {
  preventive: "Préventive",
  systematique: "Systématique",
  corrective: "Corrective",
};
