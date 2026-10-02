import "server-only";
import { getParametre, setParametre } from "@/lib/observateur";

// Phase 22 : ce que le technicien voit en scannant le QR code d'un appareil
// (ou en le cherchant). Chaque bloc est activé / masqué par le bureau.

export const BLOCS_ACCES = {
  fiche: { label: "Fiche technique", aide: "Marque, modèle, type, charge, vitesse, niveaux, portes, année, n° de série" },
  statut: { label: "Statut et adresse", aide: "En service / en panne, adresse, accès, contact sur place, itinéraire" },
  garantie: { label: "Garantie", aide: "Sous garantie ou non, date de fin, passages réalisés" },
  prochaine: { label: "Prochaine visite programmée", aide: "Date, type, technicien prévu" },
  historique: { label: "Historique des interventions", aide: "Toutes les interventions : technicien, travaux, photos, pièces" },
  techniciens: { label: "Techniciens déjà passés", aide: "Nom, nombre de passages, dernier passage" },
  documents: { label: "Documents techniques", aide: "Schémas, notices, plans (jamais les documents client)" },
  signalements: { label: "Pannes et signalements", aide: "Pannes client et signalements des techniciens" },
  notes: { label: "Notes internes du bureau", aide: "Commentaires et pièces manquantes notés par le bureau" },
} as const;

export type BlocAcces = keyof typeof BLOCS_ACCES;
export type ReglagesAcces = { blocs: Record<BlocAcces, boolean>; portee: "tous" | "concernes" };

const CLE = "acces_technicien_appareils";

export const REGLAGES_DEFAUT: ReglagesAcces = {
  blocs: { fiche: true, statut: true, garantie: true, prochaine: true, historique: true, techniciens: true, documents: true, signalements: true, notes: false },
  portee: "tous",
};

export async function reglagesAcces(): Promise<ReglagesAcces> {
  const brut = await getParametre(CLE);
  if (!brut) return REGLAGES_DEFAUT;
  try {
    const v = JSON.parse(brut) as Partial<ReglagesAcces>;
    return {
      blocs: { ...REGLAGES_DEFAUT.blocs, ...(v.blocs ?? {}) },
      portee: v.portee === "concernes" ? "concernes" : "tous",
    };
  } catch {
    return REGLAGES_DEFAUT;
  }
}

export async function enregistrerReglagesAcces(r: ReglagesAcces) {
  await setParametre(CLE, JSON.stringify(r));
}
