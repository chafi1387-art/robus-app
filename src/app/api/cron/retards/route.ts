import { db } from "@/db";
import { appareils, habilitationsTechnicien, interventions, projets, users } from "@/db/schema";
import { creerMissionsPassagesProches } from "@/lib/garantie-passages";
import { habilitationsCourantes } from "@/lib/habilitations";
import { relancerDemandesEnRetard } from "@/lib/demandes";
import { envoyerResumesMensuels } from "@/lib/resume-mensuel";
import { rappelerFormations } from "@/lib/formations";
import { notifierBureau, notifierUtilisateurs } from "@/lib/push";
import { and, eq, inArray, isNotNull, isNull, lt, notInArray } from "drizzle-orm";
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
  // Phase 17 : mission envoyée il y a plus de 30 min et toujours pas ouverte
  // par le technicien -> rappel sur son téléphone + alerte au bureau (une fois).
  const nonVues = await db
    .select({
      id: interventions.id,
      technicienId: interventions.technicienId,
      dateProgrammee: interventions.dateProgrammee,
      numero: appareils.numeroInterne,
      technicien: users.nom,
    })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .innerJoin(users, eq(interventions.technicienId, users.id))
    .where(
      and(
        inArray(interventions.statut, ["creee", "planifiee", "affectee"]),
        isNull(interventions.vueLe),
        isNull(interventions.alerteNonVueLe),
        isNotNull(interventions.envoyeeLe),
        lt(interventions.envoyeeLe, new Date(Date.now() - 30 * 60 * 1000))
      )
    )
    .limit(200);

  for (const m of nonVues) {
    if (m.technicienId) {
      await notifierUtilisateurs([m.technicienId], {
        titre: "📋 Rappel : nouvelle mission à consulter",
        corps: `${m.numero}${m.dateProgrammee ? ` — prévue le ${m.dateProgrammee.toLocaleString("fr-BE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short" })}` : ""}`,
        url: `/technicien/interventions/${m.id}`,
        tag: `mission-${m.id}`,
      });
    }
    await db.update(interventions).set({ alerteNonVueLe: new Date() }).where(eq(interventions.id, m.id));
  }
  if (nonVues.length) {
    await notifierBureau({
      titre: `👀 ${nonVues.length} mission(s) pas encore vue(s) par le technicien`,
      corps: nonVues
        .slice(0, 3)
        .map((m) => `${m.technicien} (${m.numero})`)
        .join(", ") + (nonVues.length > 3 ? "…" : ""),
      url: "/responsable/interventions",
      tag: "non-vues",
    });
  }

  // Phase 19 : passages de garantie à 30 jours -> mission « à affecter » + alerte bureau.
  const passages = await creerMissionsPassagesProches();
  if (passages.length) {
    await notifierBureau({
      titre: `🛡️ ${passages.length} passage(s) de garantie à planifier`,
      corps: passages.slice(0, 3).map((p) => `${p.numeroAppareil} (${p.numero}/${p.total})`).join(", ") + (passages.length > 3 ? "…" : ""),
      url: "/responsable",
      tag: "passages-garantie",
    });
  }

  // Phase 19 : habilitations — alerte au seuil du catalogue, à J-30 et à l'expiration (une fois chacune).
  const habs = (await habilitationsCourantes()).filter((h) => h.dateExpiration && h.catalogueId);
  let alertesHab = 0;
  for (const h of habs) {
    const jours = Math.floor((h.dateExpiration!.getTime() - Date.now()) / 86400000);
    const deja = await db.select({ a: habilitationsTechnicien.alertesEnvoyees }).from(habilitationsTechnicien).where(eq(habilitationsTechnicien.id, h.id)).limit(1);
    const envoyees = new Set(deja[0]?.a ?? []);
    const etape = jours < 0 ? "j0" : jours <= 30 ? "j30" : jours <= (h.alerteJours ?? 60) ? "jseuil" : null;
    if (!etape || envoyees.has(etape)) continue;
    const texte = jours < 0 ? `${h.nom} a expiré` : `${h.nom} expire dans ${jours} jour(s)`;
    await notifierUtilisateurs([h.technicienId], { titre: "🎓 Habilitation à renouveler", corps: texte, url: "/technicien/profil#habilitations", tag: `hab-${h.id}` });
    await notifierBureau({ titre: "🎓 Habilitation à renouveler", corps: texte, url: `/responsable/techniciens/${h.technicienId}?tab=habilitations`, tag: `hab-${h.id}` });
    await db.update(habilitationsTechnicien).set({ alertesEnvoyees: [...envoyees, etape] }).where(eq(habilitationsTechnicien.id, h.id));
    alertesHab++;
  }

  // Phase 20 : demandes client non prises en charge dans le délai + résumé mensuel.
  const demandesRelancees = await relancerDemandesEnRetard();
  const resumes = await envoyerResumesMensuels(new URL(req.url).searchParams.get("resume") === "forcer");
  // Phase 21 : rappel des formations du lendemain / du jour.
  const rappelsFormations = await rappelerFormations();

  return Response.json({ notifiees: retards.length, nonVues: nonVues.length, passagesCrees: passages.length, alertesHabilitations: alertesHab, demandesRelancees, resumes, rappelsFormations });
}
