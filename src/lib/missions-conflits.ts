import "server-only";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { interventions } from "@/db/schema";
import { joursMission } from "@/lib/mission-jours";

/**
 * Phase 31 : autres missions du technicien les mêmes jours (avertissement
 * seulement — le bureau reste libre d'affecter).
 */
export async function autresMissionsMemesJours(params: {
  technicienId: string;
  missionId: string | null;
  dateProgrammee: Date | null;
  dateFinPrevue: Date | null;
  weekendInclus: number;
}) {
  const jours = joursMission(params);
  if (!jours.length) return { nb: 0, jours: [] as string[] };
  const premier = new Date(`${jours[0]}T00:00:00Z`);
  const apresDernier = new Date(`${jours[jours.length - 1]}T00:00:00Z`);
  apresDernier.setUTCDate(apresDernier.getUTCDate() + 1);
  const rows = await db
    .select({ id: interventions.id, dateProgrammee: interventions.dateProgrammee, dateFinPrevue: interventions.dateFinPrevue, weekendInclus: interventions.weekendInclus })
    .from(interventions)
    .where(
      and(
        eq(interventions.technicienId, params.technicienId),
        inArray(interventions.statut, ["creee", "planifiee", "affectee", "en_cours"]),
        params.missionId ? ne(interventions.id, params.missionId) : undefined,
        lt(interventions.dateProgrammee, apresDernier),
        sql`coalesce(${interventions.dateFinPrevue}, ${interventions.dateProgrammee}) >= ${premier.toISOString()}::timestamp - interval '1 day'`
      )
    );
  const ensemble = new Set(jours);
  const communs = new Set<string>();
  let nb = 0;
  for (const r of rows) {
    const j = joursMission(r).filter((c) => ensemble.has(c));
    if (j.length) {
      nb++;
      j.forEach((c) => communs.add(c));
    }
  }
  return { nb, jours: [...communs].sort() };
}

export function texteConflit(nom: string, c: { nb: number; jours: string[] }) {
  if (!c.nb) return "";
  const fmt = (x: string) => new Date(`${x}T12:00:00Z`).toLocaleDateString("fr-BE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
  const j = c.jours.slice(0, 3).map(fmt).join(", ") + (c.jours.length > 3 ? "…" : "");
  return ` Attention : ${nom} a déjà ${c.nb} autre${c.nb > 1 ? "s" : ""} mission${c.nb > 1 ? "s" : ""} ces jours-là (${j}).`;
}
