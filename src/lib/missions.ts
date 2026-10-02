// Phase 21 : règles partagées sur l'acceptation / le refus d'une mission.
export const MOTIFS_REFUS: Record<string, string> = {
  indisponible: "Indisponible ce jour-là",
  sous_traitance: "Pris sur une sous-traitance",
  conge: "Congé / absence",
  formation: "En formation",
  competence: "Habilitation ou compétence manquante",
  vehicule: "Pas de véhicule",
  autre: "Autre raison",
};

export function libelleRefus(motif: string | null | undefined) {
  return motif ? (MOTIFS_REFUS[motif] ?? motif) : "";
}

export const STATUTS_NON_COMMENCES = ["creee", "planifiee", "affectee"] as const;

/** Champs de suivi d'envoi remis à zéro quand la mission repasse « à affecter ». */
export const REINIT_ENVOI = {
  envoyeeLe: null,
  vueLe: null,
  accepteeLe: null,
  alerteNonVueLe: null,
  envoiEmail: null,
  envoiPush: null,
  refuseeLe: null,
  refusMotif: null,
  refusCommentaire: null,
} as const;
