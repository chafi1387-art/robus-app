import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { devis, devisDestinataires } from "@/db/schema";
import { hashJeton } from "@/lib/devis";

// Phase 25b : le devis joint (PDF scanné) ouvert depuis le lien email —
// sans compte, seulement si le bureau a choisi « prix visible » pour ce destinataire.
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", webp: "image/webp", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

export async function GET(_req: Request, { params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(jeton)) return new Response("Lien invalide", { status: 404 });
  const [r] = await db
    .select({ url: devis.documentUrl, nom: devis.documentNom, prix: devisDestinataires.prixVisible })
    .from(devisDestinataires)
    .innerJoin(devis, eq(devisDestinataires.devisId, devis.id))
    .where(and(eq(devisDestinataires.jetonHash, hashJeton(jeton)), eq(devisDestinataires.canal, "email")))
    .limit(1);
  if (!r?.url || r.prix !== 1 || !/^\/uploads\/devis\/[A-Za-z0-9._-]+$/.test(r.url)) return new Response("Document indisponible", { status: 404 });
  try {
    const contenu = await readFile(path.join(process.cwd(), "public", r.url));
    const ext = r.url.split(".").pop() ?? "";
    return new Response(contenu, {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${(r.nom ?? `devis.${ext}`).replace(/[^\w.\- ]/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Document indisponible", { status: 404 });
  }
}
