import { db } from "@/db";
import { interventions, nonConformites } from "@/db/schema";
import { and, count, eq, lt, sql } from "drizzle-orm";

// ---------- Score ISO 9001 (section 9 du cahier des charges) ----------
// 7 blocs à poids fixes. Le score est semi-automatique : 2 blocs peuvent être
// suggérés à partir des données réelles (réalisation, non-conformités), les
// 5 autres sont saisis manuellement chaque mois par le Responsable Qualité.

export const BLOCS_ISO = [
  { cle: "leadership", label: "Leadership & Politique", poids: 10 },
  { cle: "documentation", label: "Documentation & Procédures", poids: 15 },
  { cle: "competences", label: "Compétences & Formations", poids: 15 },
  { cle: "realisation", label: "Réalisation des activités", poids: 20 },
  { cle: "non_conformites", label: "Non-conformités & Actions", poids: 15 },
  { cle: "fournisseurs", label: "Fournisseurs & Achats", poids: 10 },
  { cle: "amelioration", label: "Amélioration & Audits", poids: 15 },
] as const;

export type BlocIsoCle = (typeof BLOCS_ISO)[number]["cle"];

/**
 * Calcule les valeurs suggérées (0-100) pour les blocs qu'on peut dériver
 * directement des données réelles de la base. Les autres blocs ne sont pas
 * retournés : ils restent à la saisie manuelle du Responsable Qualité.
 */
export async function calculerBlocsAutomatiques(): Promise<Partial<Record<string, number>>> {
  const now = new Date();
  const resultats: Partial<Record<string, number>> = {};

  // Bloc "realisation" : taux de réalisation des interventions programmées
  // dans le passé (même logique que src/app/responsable/page.tsx).
  const [[{ n: nbInterventionsPassees }], [{ n: nbDone }]] = await Promise.all([
    db
      .select({ n: count() })
      .from(interventions)
      .where(lt(interventions.dateProgrammee, now)),
    db
      .select({ n: count() })
      .from(interventions)
      .where(
        and(
          lt(interventions.dateProgrammee, now),
          sql`${interventions.statut} in ('terminee','validee','cloturee')`
        )
      ),
  ]);
  if (Number(nbInterventionsPassees) > 0) {
    resultats.realisation = Math.round((Number(nbDone) / Number(nbInterventionsPassees)) * 100);
  } else {
    resultats.realisation = 100;
  }

  // Bloc "non_conformites" : part des non-conformités clôturées.
  const [[{ n: nbNc }], [{ n: nbNcCloturees }]] = await Promise.all([
    db.select({ n: count() }).from(nonConformites),
    db.select({ n: count() }).from(nonConformites).where(eq(nonConformites.statut, "cloturee")),
  ]);
  resultats.non_conformites =
    Number(nbNc) > 0 ? Math.round((Number(nbNcCloturees) / Number(nbNc)) * 100) : 100;

  return resultats;
}

/**
 * Score global pondéré : somme(valeur[bloc] * poids[bloc]) / 100, arrondi.
 * Un bloc absent des valeurs est traité comme 0.
 */
export function calculerScoreGlobal(valeurs: Record<string, number>): number {
  const somme = BLOCS_ISO.reduce((acc, bloc) => acc + (valeurs[bloc.cle] ?? 0) * bloc.poids, 0);
  return Math.round(somme / 100);
}
