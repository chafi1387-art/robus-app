import "dotenv/config";
import { db } from "../src/db";
import { checklistItems, checklistModeles } from "../src/db/schema";
import { eq } from "drizzle-orm";

const NOM = "Checklist Préventive Standard";

const LIBELLES = [
  "Contrôle visuel cabine et portes",
  "Opérateurs de porte et verrouillages",
  "Guides et coulisseaux",
  "Câbles / chaînes / courroies",
  "Frein et systèmes de sécurité",
  "Local machines / armoire",
  "Fins de course et dispositifs de sécurité",
  "Essais de fonctionnement",
  "Nettoyage",
  "Relevés",
  "Remise en service",
];

async function main() {
  const [existing] = await db
    .select({ id: checklistModeles.id })
    .from(checklistModeles)
    .where(eq(checklistModeles.nom, NOM))
    .limit(1);

  if (existing) {
    console.log(`"${NOM}" existe déjà (id=${existing.id}) — rien à faire.`);
    process.exit(0);
  }

  const [modele] = await db
    .insert(checklistModeles)
    .values({
      nom: NOM,
      typeIntervention: "preventive",
    })
    .returning();

  await db.insert(checklistItems).values(
    LIBELLES.map((libelle, ordre) => ({
      modeleId: modele.id,
      ordre,
      libelle,
    }))
  );

  console.log(`Modèle "${NOM}" créé (id=${modele.id}) avec ${LIBELLES.length} items.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
