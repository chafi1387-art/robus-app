// Phase 23 : règles partagées (serveur + écran du technicien) des checklists.

export type TacheChecklist = {
  id: string;
  section: string | null;
  libelle: string;
  obligatoire: number;
  type: string; // case | mesure
  unite: string | null;
  valeurMin: string | null;
  valeurMax: string | null;
  resultat: string | null; // ok | nok
  valeur: string | null;
  commentaire: string | null;
  rempliLe: Date | null;
};

/** Mesure : conforme si dans [min, max] (bornes facultatives). */
export function evaluerMesure(valeur: number, min: string | number | null, max: string | number | null) {
  const mi = min === null || min === "" ? null : Number(min);
  const ma = max === null || max === "" ? null : Number(max);
  if (mi !== null && !Number.isNaN(mi) && valeur < mi) return "nok" as const;
  if (ma !== null && !Number.isNaN(ma) && valeur > ma) return "nok" as const;
  return "ok" as const;
}

export function libelleLimites(t: { valeurMin: string | number | null; valeurMax: string | number | null; unite: string | null }) {
  const u = t.unite ? ` ${t.unite}` : "";
  const mi = t.valeurMin !== null && t.valeurMin !== "" ? Number(t.valeurMin) : null;
  const ma = t.valeurMax !== null && t.valeurMax !== "" ? Number(t.valeurMax) : null;
  const f = (n: number) => n.toLocaleString("fr-BE");
  if (mi !== null && ma !== null) return `entre ${f(mi)} et ${f(ma)}${u}`;
  if (mi !== null) return `≥ ${f(mi)}${u}`;
  if (ma !== null) return `≤ ${f(ma)}${u}`;
  return t.unite ? `en ${t.unite}` : "";
}

export function compter(taches: Pick<TacheChecklist, "resultat" | "obligatoire">[]) {
  const total = taches.length;
  const faites = taches.filter((t) => t.resultat).length;
  const nok = taches.filter((t) => t.resultat === "nok").length;
  const manquantes = taches.filter((t) => t.obligatoire && !t.resultat).length;
  return { total, faites, nok, ok: faites - nok, manquantes };
}
