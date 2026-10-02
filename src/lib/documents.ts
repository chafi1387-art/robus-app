// Phase 21 : catégories de la bibliothèque de documents — une seule source
// (bureau, technicien, mission) pour éviter les listes divergentes.
export const CATEGORIES_DOCUMENT = [
  "formation",
  "securite",
  "installation",
  "maintenance",
  "depannage",
  "marques",
  "procedures_robus",
  "videos",
  "fournisseur_iso",
] as const;
export type CategorieDocument = (typeof CATEGORIES_DOCUMENT)[number];

export const CATEGORIE_DOCUMENT_LABEL: Record<CategorieDocument, string> = {
  formation: "Formations internes",
  securite: "Sécurité",
  installation: "Installation",
  maintenance: "Maintenance",
  depannage: "Dépannage",
  marques: "Marques",
  procedures_robus: "Procédures Robus",
  videos: "Vidéos",
  fournisseur_iso: "Fournisseur / ISO 9001",
};

export function libelleCategorie(c: string) {
  return CATEGORIE_DOCUMENT_LABEL[c as CategorieDocument] ?? c;
}

export function estCategorie(c: string | undefined | null): c is CategorieDocument {
  return !!c && (CATEGORIES_DOCUMENT as readonly string[]).includes(c);
}
