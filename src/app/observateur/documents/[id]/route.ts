import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { documentsClient, documentsClientConsultations } from "@/db/schema";
import { requireObservateur } from "@/lib/observateur";

// Phase 20 : ouverture d'un document client par l'observateur — la
// consultation est enregistrée (le bureau voit « Consulté le … »).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireObservateur();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !ctx.droits.has("documents")) return new Response("Document introuvable", { status: 404 });
  const [doc] = await db
    .select({ url: documentsClient.url, appareilId: documentsClient.appareilId })
    .from(documentsClient)
    .where(and(eq(documentsClient.id, id), isNull(documentsClient.archiveLe)))
    .limit(1);
  if (!doc || !ctx.appareilIds.includes(doc.appareilId)) return new Response("Document introuvable", { status: 404 });
  await db
    .insert(documentsClientConsultations)
    .values({ documentId: id, userId: ctx.userId })
    .onConflictDoUpdate({
      target: [documentsClientConsultations.documentId, documentsClientConsultations.userId],
      set: { derniereLe: new Date(), nb: sql`${documentsClientConsultations.nb} + 1` },
    });
  // Location relative : fonctionne derrière nginx (aucun hôte interne dans la réponse).
  return new Response(null, { status: 302, headers: { Location: doc.url } });
}
