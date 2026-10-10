import { sql } from "drizzle-orm";
import { appareils, interventions } from "@/db/schema";

/**
 * Phase 29 — mission « à la carte » : une mission vise soit un Appareil,
 * soit une Prestation ponctuelle de son Projet (nettoyage, démolition…).
 *
 * Les requêtes qui listent des missions font un LEFT JOIN sur `appareils`
 * et affichent `CIBLE_MISSION` à la place du numéro d'appareil : le numéro
 * interne de l'appareil, sinon le nom de la prestation.
 */
export const NOM_PRESTATION_MISSION = sql<string | null>`(
  select coalesce(nullif(p.description, ''), pc.nom, 'Prestation')
  from prestations p
  left join prestations_catalogue pc on pc.id = p.catalogue_id
  where p.id = ${interventions.prestationId}
)`;

export const CIBLE_MISSION = sql<string>`coalesce(${appareils.numeroInterne}, ${NOM_PRESTATION_MISSION}, '—')`;

/** Libellé court d'une mission sans appareil (ex. « Démolition · PRJ-2026-0004 »). */
export function libelleCible(m: { appareilId?: string | null; cible: string; projetRef?: string | null }) {
  if (m.appareilId) return m.cible;
  return m.projetRef ? `${m.cible} · ${m.projetRef}` : m.cible;
}
