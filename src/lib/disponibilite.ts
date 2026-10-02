import "server-only";
import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { formationsParticipants, formationsSessions, heuresSousTraitance, interventions, signalements } from "@/db/schema";

// Phase 21 : ce qui occupe déjà un technicien un jour donné — affiché au
// bureau avant/après l'envoi d'une mission (formation, autres missions,
// sous-traitance déclarée, signalement bloquant en cours).

function bornesJourBruxelles(d: Date) {
  const jour = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const debut = new Date(`${jour}T00:00:00`);
  return { jour, debut: new Date(debut.getTime() - 3 * 3600 * 1000), fin: new Date(debut.getTime() + 27 * 3600 * 1000) };
}

const memeJour = (a: Date, jour: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(a) === jour;

export async function occupationsTechnicien(technicienId: string, date: Date, sauf?: string) {
  const { jour, debut, fin } = bornesJourBruxelles(date);
  const [formations, missions, heures, bloquants] = await Promise.all([
    db
      .select({ id: formationsSessions.id, titre: formationsSessions.titre, dateDebut: formationsSessions.dateDebut, reponse: formationsParticipants.reponse })
      .from(formationsParticipants)
      .innerJoin(formationsSessions, eq(formationsParticipants.sessionId, formationsSessions.id))
      .where(
        and(
          eq(formationsParticipants.technicienId, technicienId),
          ne(formationsSessions.statut, "annulee"),
          gte(formationsSessions.dateDebut, debut),
          lt(formationsSessions.dateDebut, fin)
        )
      ),
    db
      .select({ id: interventions.id, dateProgrammee: interventions.dateProgrammee })
      .from(interventions)
      .where(
        and(
          eq(interventions.technicienId, technicienId),
          gte(interventions.dateProgrammee, debut),
          lt(interventions.dateProgrammee, fin),
          sql`${interventions.statut} <> 'cloturee'`,
          sauf ? ne(interventions.id, sauf) : undefined
        )
      ),
    db
      .select({ minutes: heuresSousTraitance.minutes, heureDebut: heuresSousTraitance.heureDebut, heureFin: heuresSousTraitance.heureFin })
      .from(heuresSousTraitance)
      .where(and(eq(heuresSousTraitance.technicienId, technicienId), eq(heuresSousTraitance.dateTravail, jour))),
    db
      .select({ id: signalements.id, numero: signalements.numero, type: signalements.type })
      .from(signalements)
      .where(and(eq(signalements.technicienId, technicienId), eq(signalements.bloquant, 1), inArray(signalements.statut, ["nouveau", "pris_en_charge"]))),
  ]);
  return {
    formations: formations.filter((f) => memeJour(f.dateDebut, jour)),
    autresMissions: missions.filter((m) => m.dateProgrammee && memeJour(m.dateProgrammee, jour)).length,
    sousTraitance: heures,
    signalementsBloquants: bloquants,
  };
}
