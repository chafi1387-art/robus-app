import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { signalements } from "@/db/schema";

// Phase 21 : indicateurs sécurité (tableau de bord, page Signalements).
export async function statsSecurite() {
  const [r] = await db
    .select({
      nouveaux: sql<number>`count(*) filter (where ${signalements.statut} = 'nouveau')::int`,
      enCours: sql<number>`count(*) filter (where ${signalements.statut} = 'pris_en_charge')::int`,
      critiquesOuverts: sql<number>`count(*) filter (where ${signalements.statut} <> 'cloture' and ${signalements.gravite} = 'critique')::int`,
      dernierAccident: sql<Date | null>`max(${signalements.createdAt}) filter (where ${signalements.type} = 'accident')`,
      premier: sql<Date | null>`min(${signalements.createdAt})`,
      accidentsAnnee: sql<number>`count(*) filter (where ${signalements.type} = 'accident' and date_part('year', ${signalements.createdAt}) = date_part('year', now()))::int`,
      presqueAnnee: sql<number>`count(*) filter (where ${signalements.type} = 'presque_accident' and date_part('year', ${signalements.createdAt}) = date_part('year', now()))::int`,
    })
    .from(signalements);
  const dernier = r?.dernierAccident ? new Date(r.dernierAccident) : null;
  // Sans accident enregistré : on compte depuis la mise en service du module.
  const depuis = dernier ?? (r?.premier ? new Date(r.premier) : null);
  return {
    nouveaux: r?.nouveaux ?? 0,
    enCours: r?.enCours ?? 0,
    critiquesOuverts: r?.critiquesOuverts ?? 0,
    accidentsAnnee: r?.accidentsAnnee ?? 0,
    presqueAnnee: r?.presqueAnnee ?? 0,
    // eslint-disable-next-line react-hooks/purity
    joursSansAccident: depuis ? Math.max(0, Math.floor((Date.now() - depuis.getTime()) / 86400000)) : null,
  };
}
