import "server-only";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { appareils, interventions, rapports } from "@/db/schema";
import { journaliser } from "@/lib/journal";

// Phase 25 : l'état de l'ascenseur (En service / En panne…) suit le terrain.
//  • panne signalée par le client        → « En panne » ;
//  • rapport envoyé par le technicien     → état indiqué dans le rapport ;
//  • rapport corrigé par le bureau        → idem, si c'est la dernière intervention.
// Le bureau peut toujours corriger l'état à la main sur la fiche appareil.

type Statut = "en_service" | "sous_surveillance" | "en_panne" | "hors_service" | "en_travaux" | "installation";

export async function changerEtatAppareil(appareilId: string, statut: Statut, cause: string, utilisateurId: string | null) {
  const [a] = await db.select({ statut: appareils.statut }).from(appareils).where(eq(appareils.id, appareilId)).limit(1);
  if (!a || a.statut === statut) return;
  // Un appareil en projet d'installation ne change pas d'état tout seul.
  if (a.statut === "installation") return;
  await db.update(appareils).set({ statut }).where(eq(appareils.id, appareilId));
  await journaliser({ entite: "appareil", entiteId: appareilId, action: "etat_modifie", utilisateurId, details: `${a.statut} → ${statut} (${cause})` });
}

/** Panne signalée : l'ascenseur passe « En panne » s'il était en service / sous surveillance. */
export async function etatApresPanne(appareilId: string, utilisateurId: string | null) {
  const [a] = await db.select({ statut: appareils.statut }).from(appareils).where(eq(appareils.id, appareilId)).limit(1);
  if (a && (a.statut === "en_service" || a.statut === "sous_surveillance")) {
    await changerEtatAppareil(appareilId, "en_panne", "panne signalée", utilisateurId);
  }
}

/** Rapport envoyé / corrigé : l'état suit le rapport s'il s'agit de la dernière intervention terminée. */
export async function etatDepuisRapport(interventionId: string, utilisateurId: string | null) {
  const [m] = await db
    .select({ appareilId: interventions.appareilId, statut: rapports.statutFinalAppareil })
    .from(interventions)
    .innerJoin(rapports, eq(rapports.interventionId, interventions.id))
    .where(eq(interventions.id, interventionId))
    .limit(1);
  if (!m?.statut) return;
  const [derniere] = await db
    .select({ id: interventions.id })
    .from(interventions)
    .innerJoin(rapports, eq(rapports.interventionId, interventions.id))
    .where(and(eq(interventions.appareilId, m.appareilId), inArray(interventions.statut, ["terminee", "validee", "cloturee"]), isNotNull(rapports.statutFinalAppareil)))
    .orderBy(desc(interventions.dateFin))
    .limit(1);
  if (derniere && derniere.id !== interventionId) return;
  await changerEtatAppareil(m.appareilId, m.statut, "rapport d'intervention", utilisateurId);
}
