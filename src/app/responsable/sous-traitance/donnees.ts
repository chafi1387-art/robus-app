import "server-only";
import { db } from "@/db";
import { clients, heuresSousTraitance, users } from "@/db/schema";
import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { bornesMois } from "@/lib/sous-traitance";

export async function chargerHeures(f: { mois: string; clientId?: string; technicienId?: string }) {
  const { debut, fin } = bornesMois(f.mois);
  const conds: SQL[] = [gte(heuresSousTraitance.dateTravail, debut), lt(heuresSousTraitance.dateTravail, fin)];
  if (f.clientId) conds.push(eq(heuresSousTraitance.clientId, f.clientId));
  if (f.technicienId) conds.push(eq(heuresSousTraitance.technicienId, f.technicienId));
  return db
    .select({
      id: heuresSousTraitance.id,
      clientId: heuresSousTraitance.clientId,
      client: clients.raisonSociale,
      technicienId: heuresSousTraitance.technicienId,
      technicien: users.nom,
      dateTravail: heuresSousTraitance.dateTravail,
      minutes: heuresSousTraitance.minutes,
      commentaire: heuresSousTraitance.commentaire,
      createdAt: heuresSousTraitance.createdAt,
    })
    .from(heuresSousTraitance)
    .innerJoin(clients, eq(heuresSousTraitance.clientId, clients.id))
    .innerJoin(users, eq(heuresSousTraitance.technicienId, users.id))
    .where(and(...conds))
    .orderBy(clients.raisonSociale, desc(heuresSousTraitance.dateTravail), users.nom);
}
