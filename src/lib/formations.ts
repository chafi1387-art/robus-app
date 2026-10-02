import "server-only";
import { after } from "next/server";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { formationsParticipants, formationsSessions, interventions, users } from "@/db/schema";
import { notifierUtilisateurs } from "@/lib/push";
import { envoyerAvisSimple } from "@/lib/mail";

// Phase 21 : formations internes — avis aux techniciens (notification +
// email), conflits de planning, rappel la veille, fenêtre d'émargement.

const base = () => process.env.NEXTAUTH_URL || "https://robuswork.tech";

export const LIEUX_FORMATION: Record<string, string> = { terrain: "Sur le terrain", bureau: "Au bureau", ecole: "École / organisme" };

export function dateFormation(d: Date) {
  return d.toLocaleString("fr-BE", { timeZone: "Europe/Brussels", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** Signer sa présence : d'une heure avant le début jusqu'à 24 h après. */
export function fenetreEmargement(dateDebut: Date, maintenant = new Date()) {
  const t = maintenant.getTime();
  return t >= dateDebut.getTime() - 3600 * 1000 && t <= dateDebut.getTime() + 24 * 3600 * 1000;
}

/** Notification sur le téléphone + email à chaque technicien (après la réponse). */
export function avertirTechniciens(technicienIds: string[], sessionId: string, titre: string, texte: string) {
  const ids = [...new Set(technicienIds)];
  if (!ids.length) return;
  after(async () => {
    try {
      await notifierUtilisateurs(ids, { titre, corps: texte, url: `/technicien/formations/${sessionId}`, tag: `formation-${sessionId}` });
      const dest = await db.select({ email: users.email, nom: users.nom }).from(users).where(inArray(users.id, ids));
      for (const u of dest) {
        await envoyerAvisSimple({ email: u.email, nom: u.nom.split(" ")[0] ?? u.nom, titre: titre.replace(/^[^\p{L}\p{N}]+/u, ""), texte, lien: `${base()}/technicien/formations/${sessionId}` });
      }
    } catch (e) {
      console.error("Avis formation", e);
    }
  });
}

/** Techniciens qui ont déjà des missions le jour de la formation (avertissement au bureau). */
export async function conflitsMissions(technicienIds: string[], date: Date) {
  if (!technicienIds.length) return [] as { nom: string; n: number }[];
  const jour = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return db
    .select({ nom: users.nom, n: sql<number>`count(*)::int` })
    .from(interventions)
    .innerJoin(users, eq(interventions.technicienId, users.id))
    .where(
      and(
        inArray(interventions.technicienId, technicienIds),
        sql`to_char(${interventions.dateProgrammee} at time zone 'UTC' at time zone 'Europe/Brussels', 'YYYY-MM-DD') = ${jour}`,
        sql`${interventions.statut} not in ('cloturee','validee','terminee')`
      )
    )
    .groupBy(users.nom);
}

/** Cron : rappel la veille / le jour même (une seule fois par participant). */
export async function rappelerFormations() {
  const maintenant = new Date();
  const rows = await db
    .select({
      participantId: formationsParticipants.id,
      technicienId: formationsParticipants.technicienId,
      reponse: formationsParticipants.reponse,
      sessionId: formationsSessions.id,
      titre: formationsSessions.titre,
      dateDebut: formationsSessions.dateDebut,
    })
    .from(formationsParticipants)
    .innerJoin(formationsSessions, eq(formationsParticipants.sessionId, formationsSessions.id))
    .where(
      and(
        eq(formationsSessions.statut, "planifiee"),
        gte(formationsSessions.dateDebut, maintenant),
        lt(formationsSessions.dateDebut, new Date(maintenant.getTime() + 24 * 3600 * 1000)),
        isNull(formationsParticipants.rappelLe),
        sql`coalesce(${formationsParticipants.reponse}, '') <> 'indisponible'`
      )
    )
    .limit(300);
  for (const r of rows) {
    await notifierUtilisateurs([r.technicienId], {
      titre: "🎓 Rappel : formation",
      corps: `${r.titre} — ${dateFormation(r.dateDebut)}${r.reponse ? "" : " · confirmez votre présence"}`,
      url: `/technicien/formations/${r.sessionId}`,
      tag: `formation-${r.sessionId}`,
    });
    await db.update(formationsParticipants).set({ rappelLe: new Date() }).where(eq(formationsParticipants.id, r.participantId));
  }
  return rows.length;
}

/** Sessions à venir où un technicien peut encore être inscrit. */
export async function sessionsOuvertes(sauf?: string) {
  const rows = await db
    .select({ id: formationsSessions.id, titre: formationsSessions.titre, dateDebut: formationsSessions.dateDebut })
    .from(formationsSessions)
    .where(and(eq(formationsSessions.statut, "planifiee"), gte(formationsSessions.dateDebut, new Date())))
    .orderBy(formationsSessions.dateDebut)
    .limit(50);
  if (!sauf) return rows;
  const deja = await db
    .select({ sessionId: formationsParticipants.sessionId })
    .from(formationsParticipants)
    .where(eq(formationsParticipants.technicienId, sauf));
  const set = new Set(deja.map((d) => d.sessionId));
  return rows.filter((r) => !set.has(r.id));
}
