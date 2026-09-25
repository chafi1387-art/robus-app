// Règles partagées (pages + actions) pour les heures de sous-traitance.
// Fichier sans "use server" : exporte aussi des fonctions synchrones.

export const DELAI_MODIF_HEURES_MS = 24 * 60 * 60 * 1000;
export const JOURS_ARRIERE_MAX = 31; // un technicien ne déclare pas plus d'un mois en arrière

/** Le technicien peut corriger/supprimer sa saisie pendant 24 h ; l'administrateur toujours. */
export function peutModifierHeures(createdAt: Date, role: string) {
  if (role === "administrateur") return true;
  return Date.now() <= createdAt.getTime() + DELAI_MODIF_HEURES_MS;
}

/** 150 -> "2 h 30" ; 60 -> "1 h" */
export function formatMinutes(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/** 150 -> "2,5" (heures décimales, pour export / facturation) */
export function minutesEnHeuresDecimales(total: number) {
  return (Math.round((total / 60) * 100) / 100).toString().replace(".", ",");
}

/** Date du jour (YYYY-MM-DD) en heure belge, quel que soit le fuseau du serveur. */
export function aujourdhuiBruxelles(decalageJours = 0) {
  const d = new Date(Date.now() + decalageJours * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** "YYYY-MM" valide, sinon le mois courant (heure belge). */
export function moisOuCourant(mois?: string | null) {
  if (mois && /^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) return mois;
  return aujourdhuiBruxelles().slice(0, 7);
}

/** Bornes [début, fin[ d'un mois "YYYY-MM" sous forme de dates YYYY-MM-DD. */
export function bornesMois(mois: string) {
  const [a, m] = mois.split("-").map(Number);
  const fin = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
  return { debut: `${mois}-01`, fin };
}

export function moisDecale(mois: string, delta: number) {
  const [a, m] = mois.split("-").map(Number);
  const idx = a * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function libelleMois(mois: string) {
  const [a, m] = mois.split("-").map(Number);
  const s = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString("fr-BE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2026-09-25" -> "25/09/2026" */
export function formatDateJour(d: string) {
  const [a, m, j] = d.split("-");
  return `${j}/${m}/${a}`;
}

/** Convertit la saisie "heures" + "minutes" en minutes ; null si invalide. */
export function saisieEnMinutes(heures: unknown, minutes: unknown) {
  const h = Number(String(heures ?? "0").trim() || "0");
  const m = Number(String(minutes ?? "0").trim() || "0");
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59) return null;
  const total = h * 60 + m;
  if (total <= 0 || total > 24 * 60) return null;
  return total;
}
