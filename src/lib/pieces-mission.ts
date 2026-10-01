import "server-only";
import { db } from "@/db";
import { mouvementsStock, pieces } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/** Phase 19 : pièces d'une mission en quantité NETTE (sorties − corrections/retours). */
export async function piecesNettes(interventionId: string) {
  const rows = await db
    .select({
      pieceId: mouvementsStock.pieceId,
      nom: pieces.nom,
      reference: pieces.reference,
      quantite: sql<number>`sum(case when ${mouvementsStock.type} = 'sortie' then ${mouvementsStock.quantite} else -${mouvementsStock.quantite} end)::int`,
    })
    .from(mouvementsStock)
    .innerJoin(pieces, eq(mouvementsStock.pieceId, pieces.id))
    .where(eq(mouvementsStock.interventionId, interventionId))
    .groupBy(mouvementsStock.pieceId, pieces.nom, pieces.reference);
  return rows.sort((a, b) => a.nom.localeCompare(b.nom));
}
