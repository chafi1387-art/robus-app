import { db } from "@/db";
import { journalActivite } from "@/db/schema";

/**
 * Journal d'activité — traçabilité inviolable (append-only, aucune mise à
 * jour ni suppression n'est jamais faite sur cette table). Utilisé pour les
 * actions sensibles ou à valeur de preuve ISO 9001 : gestion des comptes,
 * non-conformités, score qualité, audits, revues de direction.
 */
export async function journaliser(params: {
  entite: string;
  entiteId: string;
  action: string;
  utilisateurId?: string | null;
  details?: string | null;
}) {
  try {
    await db.insert(journalActivite).values({
      entite: params.entite,
      entiteId: params.entiteId,
      action: params.action,
      utilisateurId: params.utilisateurId ?? null,
      details: params.details ?? null,
    });
  } catch {
    // Le journal ne doit jamais faire échouer l'action métier qu'il trace.
  }
}
