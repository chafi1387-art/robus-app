import { db } from "@/db";
import { appareils, interventions, projets } from "@/db/schema";
import { notifierBureau, notifierUtilisateurs } from "@/lib/push";
import { and, eq, isNotNull, isNull, lt, notInArray } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";

// Phase 16 : appelée par le cron du serveur (en-tête X-Cron-Secret = CRON_SECRET
// du .env). Notifie UNE fois chaque mission en retard : le technicien + le bureau.
export const dynamic = "force-dynamic";

function autorise(req: Request) {
  const attendu = process.env.CRON_SECRET ?? "";
  const recu = req.headers.get("x-cron-secret") ?? "";
  if (attendu.length < 16 || recu.length !== attendu.length) return false;
  return timingSafeEqual(Buffer.from(recu), Buffer.from(attendu));
}

export async function POST(req: Request) {
  if (!autorise(req)) return new Response("Non autorisé", { status: 401 });

  const retards = await db
    .select({
      id: interventions.id,
      technicienId: interventions.technicienId,
      dateProgrammee: interventions.dateProgrammee,
      numero: appareils.numeroInterne,
      projetRef: projets.reference,
    })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .where(
      and(
        isNotNull(interventions.dateProgrammee),
        lt(interventions.dateProgrammee, new Date(Date.now() - 60 * 60 * 1000)),
        notInArray(interventions.statut, ["terminee", "validee", "cloturee"]),
        isNull(interventions.retardNotifieLe)
      )
    )
    .limit(200);

  for (const m of retards) {
    const quand = m.dateProgrammee
      ? m.dateProgrammee.toLocaleString("fr-BE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short" })
      : "";
    if (m.technicienId) {
      await notifierUtilisateurs([m.technicienId], {
        titre: "⏰ Mission en retard",
        corps: `${m.numero}${m.projetRef ? ` · ${m.projetRef}` : ""} — prévue le ${quand}`,
        url: `/technicien/interventions/${m.id}`,
        tag: `retard-${m.id}`,
      });
    }
    await db.update(interventions).set({ retardNotifieLe: new Date() }).where(eq(interventions.id, m.id));
  }
  if (retards.length) {
    await notifierBureau({
      titre: `⏰ ${retards.length} mission(s) en retard`,
      corps: retards.slice(0, 3).map((m) => m.numero).join(", ") + (retards.length > 3 ? "…" : ""),
      url: "/responsable/interventions",
      tag: "retards",
    });
  }
  return Response.json({ notifiees: retards.length });
}
