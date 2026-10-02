// Phase 21 : types de signalement du technicien — une seule définition pour
// le formulaire (technicien), la liste et la fiche (bureau), les emails.

export type TypeSignalement = {
  label: string;
  icone: string;
  aide: string;
  /** Question « bloquante » propre au type (une seule, simple). */
  questionBloquant: string;
  /** Question « blessé » (accident seulement). */
  questionBlesse?: string;
  /** Proposer « créer une non-conformité » au bureau. */
  nc: boolean;
};

export const TYPES_SIGNALEMENT: Record<string, TypeSignalement> = {
  accident: {
    label: "Accident / blessure",
    icone: "🩹",
    aide: "Chute, coupure, choc électrique, malaise…",
    questionBlesse: "Quelqu'un est blessé",
    questionBloquant: "Je ne peux pas continuer ma mission",
    nc: true,
  },
  presque_accident: {
    label: "Presque accident",
    icone: "⚠️",
    aide: "Il aurait pu y avoir un accident (ISO 45001 / sécurité).",
    questionBloquant: "Je ne peux pas continuer ma mission",
    nc: true,
  },
  vehicule: {
    label: "Véhicule",
    icone: "🚗",
    aide: "Panne, accrochage, crevaison, voyant…",
    questionBloquant: "Véhicule immobilisé — je ne peux plus me déplacer",
    nc: false,
  },
  meteo: {
    label: "Météo / intempérie",
    icone: "🌩️",
    aide: "Tempête, neige, inondation, route coupée…",
    questionBloquant: "Je ne peux pas me rendre sur place",
    nc: false,
  },
  materiel: {
    label: "Matériel / outillage",
    icone: "🧰",
    aide: "Outil cassé, perdu ou volé, EPI manquant…",
    questionBloquant: "Cela m'empêche de travailler",
    nc: true,
  },
  acces_site: {
    label: "Accès au site / danger",
    icone: "🚧",
    aide: "Accès impossible, client absent, zone dangereuse…",
    questionBloquant: "Je ne peux pas faire la mission",
    nc: true,
  },
  autre: {
    label: "Autre",
    icone: "📝",
    aide: "Tout autre problème à faire remonter.",
    questionBloquant: "Cela m'empêche de faire ma mission",
    nc: false,
  },
};

export const STATUTS_SIGNALEMENT: Record<string, { label: string; tone: "crit" | "warn" | "ok" | "neutral" }> = {
  nouveau: { label: "Nouveau", tone: "crit" },
  pris_en_charge: { label: "Pris en charge", tone: "warn" },
  cloture: { label: "Clôturé", tone: "ok" },
};

export const GRAVITES_SIGNALEMENT: Record<string, { label: string; tone: "crit" | "warn" | "neutral" }> = {
  critique: { label: "Critique", tone: "crit" },
  elevee: { label: "Élevée", tone: "warn" },
  normale: { label: "Normale", tone: "neutral" },
};

/** Gravité calculée : blessé = critique ; accident / presque accident / bloquant = élevée. */
export function graviteSignalement(type: string, blesse: boolean, bloquant: boolean) {
  if (type === "accident" && blesse) return "critique";
  if (type === "accident" || type === "presque_accident" || bloquant) return "elevee";
  return "normale";
}

export function libelleTypeSignalement(type: string) {
  const t = TYPES_SIGNALEMENT[type];
  return t ? `${t.icone} ${t.label}` : type;
}
