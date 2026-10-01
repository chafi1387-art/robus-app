import "server-only";
import { db } from "@/db";
import { garantieFormules, garanties } from "@/db/schema";
import { genererPassages } from "@/lib/garantie-passages";
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

  // Phase 19 : échéancier des passages pour CHAQUE appareil du projet
  // (au milieu de chaque période) — remplace l'ancienne règle de
  // planification posée sur le premier appareil seulement.
  await genererPassages(garantieCreee.id);
  return garantieCreee;
}
