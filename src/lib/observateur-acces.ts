import { db } from "@/db";
import { observateurs, users } from "@/db/schema";
import { eq } from "drizzle-orm";

// Phase 18 : un observateur peut se connecter si son compte est actif, qu'il a
// une fiche observateur et que sa date de fin d'accès n'est pas dépassée.
// Fichier séparé (sans "server-only") car importé aussi par src/auth.ts.
export async function accesObservateurValide(userId: string) {
  const [row] = await db
    .select({ actif: users.actif, dateFin: observateurs.dateFin })
    .from(users)
    .innerJoin(observateurs, eq(observateurs.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || row.actif !== 1) return false;
  return !row.dateFin || row.dateFin.getTime() > Date.now();
}
