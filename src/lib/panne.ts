import "server-only";
import { after } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { appareils, interventions, signalementsPanne } from "@/db/schema";
import { journaliser } from "@/lib/journal";
import { notifierBureau } from "@/lib/push";
import { dernierProjetAppareil } from "@/lib/observateur";

// Phase 18 : panne signalée par un observateur ou par une personne ayant
// scanné le QR code -> mission corrective « à affecter » + alerte au bureau.
// (Fichier « server-only » : ces fonctions ne sont PAS appelables depuis le navigateur.)

/** Logique commune (observateur connecté ou personne ayant scanné le QR code). */
export async function enregistrerPanne(params: {
  appareilId: string;
  description: string;
  nom: string | null;
  telephone: string | null;
  auteurId: string | null;
}) {
  const [a] = await db.select({ numero: appareils.numeroInterne }).from(appareils).where(eq(appareils.id, params.appareilId)).limit(1);
  if (!a) throw new Error("Appareil introuvable.");
  const projetId = await dernierProjetAppareil(params.appareilId);
  const qui = [params.nom, params.telephone].filter(Boolean).join(" · ") || "usager";
  const [mission] = await db
    .insert(interventions)
    .values({
      appareilId: params.appareilId,
      projetId,
      type: "corrective",
      statut: "creee",
      priorite: "haute",
      description: `Panne signalée (${qui}) : ${params.description}`,
    })
    .returning({ id: interventions.id });
  const [sig] = await db
    .insert(signalementsPanne)
    .values({ ...params, interventionId: mission.id })
    .returning({ id: signalementsPanne.id });
  await journaliser({
    entite: "intervention",
    entiteId: mission.id,
    action: "panne_signalee",
    utilisateurId: params.auteurId,
    details: `Appareil ${a.numero} — ${qui} — ${params.description.slice(0, 200)}`,
  });
  after(() =>
    notifierBureau({
      titre: `🚨 Panne signalée — ${a.numero}`,
      corps: `${qui} : ${params.description.slice(0, 120)}`,
      url: `/responsable/missions/${mission.id}`,
      tag: `panne-${sig.id}`,
    })
  );
  return mission.id;
}

/** Anti-abus : au plus 3 signalements par appareil et par heure pour un même auteur. */
export async function tropDeSignalements(appareilId: string, auteurId: string | null, telephone: string | null) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(signalementsPanne)
    .where(
      and(
        eq(signalementsPanne.appareilId, appareilId),
        gte(signalementsPanne.createdAt, new Date(Date.now() - 3600 * 1000)),
        auteurId ? eq(signalementsPanne.auteurId, auteurId) : telephone ? eq(signalementsPanne.telephone, telephone) : sql`true`
      )
    );
  return n >= (auteurId || telephone ? 3 : 10);
}

