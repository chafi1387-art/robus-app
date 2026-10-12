// Phase 31 : missions sur plusieurs jours (option A validée par Chafi).
//
// Une seule mission : `date_programmee` = début (jour + heure), `date_fin_prevue`
// = dernier jour (minuit, heure saisie comme les autres heures programmées),
// `weekend_inclus` = 1 pour travailler aussi le samedi et le dimanche.
// Une mission sans `date_fin_prevue` dure un jour (comportement d'avant).

export const MAX_JOURS_MISSION = 92;

type DatesMission = {
  dateProgrammee: Date | null;
  dateFinPrevue?: Date | null;
  weekendInclus?: number | null;
};

const cle = (d: Date) => d.toISOString().slice(0, 10);
const jourSemaine = (c: string) => new Date(`${c}T12:00:00Z`).getUTCDay(); // 0 = dimanche
function plusUn(c: string) {
  const d = new Date(`${c}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return cle(d);
}

/** Vrai si la mission couvre plus d'un jour. */
export function estMultiJours(m: DatesMission) {
  return !!m.dateProgrammee && !!m.dateFinPrevue && cle(m.dateFinPrevue) > cle(m.dateProgrammee);
}

/** Les jours (AAAA-MM-JJ) où la mission apparaît dans le planning. */
export function joursMission(m: DatesMission): string[] {
  if (!m.dateProgrammee) return [];
  const debut = cle(m.dateProgrammee);
  if (!estMultiJours(m)) return [debut];
  const fin = cle(m.dateFinPrevue!);
  const jours: string[] = [];
  for (let c = debut, n = 0; c <= fin && n < MAX_JOURS_MISSION + 1; c = plusUn(c), n++) {
    const js = jourSemaine(c);
    // Le premier jour est toujours compté (même un samedi choisi exprès).
    if (c !== debut && !m.weekendInclus && (js === 0 || js === 6)) continue;
    jours.push(c);
  }
  return jours;
}

/** Dernier jour (AAAA-MM-JJ) couvert par la mission. */
export function dernierJour(m: DatesMission) {
  const j = joursMission(m);
  return j[j.length - 1] ?? null;
}

/** « Jour 2/5 » pour un jour donné, sinon null. */
export function rangDuJour(m: DatesMission, jour: string) {
  if (!estMultiJours(m)) return null;
  const j = joursMission(m);
  const i = j.indexOf(jour);
  return i < 0 ? null : { rang: i + 1, total: j.length };
}

const fmtJour = (c: string) =>
  new Date(`${c}T12:00:00Z`).toLocaleDateString("fr-BE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });

/** « du lun. 12/10 au ven. 16/10 · 5 jours » (ou null pour une mission d'un jour). */
export function libellePlage(m: DatesMission) {
  if (!estMultiJours(m)) return null;
  const j = joursMission(m);
  return `du ${fmtJour(j[0]!)} au ${fmtJour(j[j.length - 1]!)} · ${j.length} jours${m.weekendInclus ? " (week-end compris)" : ""}`;
}

/**
 * Lecture des champs « Dernier jour » / « samedi-dimanche » d'un formulaire.
 * Renvoie une erreur lisible ou les valeurs à enregistrer.
 */
export function lireDatesMultiJours(
  formData: FormData,
  debut: Date | null
): { erreur: string } | { dateFinPrevue: Date | null; weekendInclus: number } {
  const brut = String(formData.get("dateFinPrevue") ?? "").trim();
  const weekendInclus = formData.get("weekendInclus") === "on" ? 1 : 0;
  if (!brut) return { dateFinPrevue: null, weekendInclus: 0 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(brut)) return { erreur: "Dernier jour invalide." };
  const fin = new Date(`${brut}T00:00:00Z`);
  if (Number.isNaN(fin.getTime())) return { erreur: "Dernier jour invalide." };
  if (!debut) return { erreur: "Choisissez d'abord la date de début de la mission." };
  const cDebut = cle(debut);
  if (brut < cDebut) return { erreur: "Le dernier jour doit être après le jour de début." };
  if (brut === cDebut) return { dateFinPrevue: null, weekendInclus: 0 };
  const nbJours = Math.round((fin.getTime() - new Date(`${cDebut}T00:00:00Z`).getTime()) / 86400000) + 1;
  if (nbJours > MAX_JOURS_MISSION) return { erreur: `Une mission ne peut pas dépasser ${MAX_JOURS_MISSION} jours. Découpez-la en plusieurs missions.` };
  return { dateFinPrevue: fin, weekendInclus };
}
