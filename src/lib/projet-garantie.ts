import "server-only";
import { db } from "@/db";
import { garantieFormules, garanties, projetAppareils, reglesPlanification } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Crée la garantie d'un Projet à partir d'une formule + la règle de
 * planification automatique des visites incluses (sur le premier appareil
 * attaché). Extrait de choisirGarantieProjet (Phase 13) pour être réutilisé
 * par l'assistant de création de projet. L'appelant vérifie les droits.
 */
export async function appliquerGarantie(projetId: string, formuleId: string) {
  const [formule] = await db.select().from(garantieFormules).where(eq(garantieFormules.id, formuleId)).limit(1);
  if (!formule) throw new Error("Formule de garantie introuvable.");

  const dateDebut = new Date();
  const dateFin = new Date(dateDebut);
  dateFin.setMonth(dateFin.getMonth() + formule.dureeMois);

  const [garantieCreee] = await db
    .insert(garanties)
    .values({
      projetId,
      formuleId: formule.id,
      dateDebut,
      dateFin,
      interventionsIncluses: formule.nombreInterventionsInclues,
      interventionsRestantes: formule.nombreInterventionsInclues,
    })
    .returning();

  const [premierAppareil] = await db
    .select({ appareilId: projetAppareils.appareilId })
    .from(projetAppareils)
    .where(eq(projetAppareils.projetId, projetId))
    .limit(1);

  if (premierAppareil && formule.nombreInterventionsInclues > 0) {
    const periodiciteMois = Math.max(1, Math.round(formule.dureeMois / formule.nombreInterventionsInclues));
    const prochaineDate = new Date(dateDebut);
    prochaineDate.setMonth(prochaineDate.getMonth() + periodiciteMois);
    await db.insert(reglesPlanification).values({
      appareilId: premierAppareil.appareilId,
      type: "preventive",
      periodiciteMois,
      prochaineDate,
      garantieId: garantieCreee.id,
    });
  }
  return garantieCreee;
}
