import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { appareils, projets, signalements, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { csvResponse, toCsv } from "@/lib/csv";
import { GRAVITES_SIGNALEMENT, STATUTS_SIGNALEMENT, TYPES_SIGNALEMENT } from "@/lib/signalements-types";

// Phase 21 : registre des signalements (accidents, presque accidents…) pour l'audit.
const fmt = (d: Date | null) => (d ? d.toLocaleString("fr-BE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short" }) : "");

export async function GET(req: Request) {
  await requireUser(ROLES_BUREAU);
  const url = new URL(req.url);
  const vue = url.searchParams.get("vue") ?? "tous";
  const type = url.searchParams.get("type") ?? "";
  const technicien = url.searchParams.get("technicien") ?? "";
  const conds: SQL[] = [];
  if (vue === "ouverts") conds.push(inArray(signalements.statut, ["nouveau", "pris_en_charge"]));
  if (vue === "clotures") conds.push(eq(signalements.statut, "cloture"));
  if (TYPES_SIGNALEMENT[type]) conds.push(eq(signalements.type, type));
  if (/^[0-9a-f-]{36}$/i.test(technicien)) conds.push(eq(signalements.technicienId, technicien));
  const tech = alias(users, "tech");
  const lignes = await db
    .select({ s: signalements, technicien: tech.nom, appareil: appareils.numeroInterne, projet: projets.reference })
    .from(signalements)
    .innerJoin(tech, eq(signalements.technicienId, tech.id))
    .leftJoin(appareils, eq(signalements.appareilId, appareils.id))
    .leftJoin(projets, eq(signalements.projetId, projets.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(signalements.createdAt));
  const csv = toCsv(
    ["Numéro", "Date", "Type", "Gravité", "Blessé", "Bloquant", "Technicien", "Appareil", "Projet", "Lieu", "Description", "Statut", "Réponse / mesure prise", "Clôturé le", "Non-conformité"],
    lignes.map(({ s, technicien, appareil, projet }) => [
      s.numero,
      fmt(s.createdAt),
      TYPES_SIGNALEMENT[s.type]?.label ?? s.type,
      GRAVITES_SIGNALEMENT[s.gravite]?.label ?? s.gravite,
      s.blesse ? "Oui" : "Non",
      s.bloquant ? "Oui" : "Non",
      technicien,
      appareil ?? "",
      projet ?? "",
      s.lieu ?? "",
      s.description,
      STATUTS_SIGNALEMENT[s.statut]?.label ?? s.statut,
      s.reponse ?? "",
      fmt(s.clotureLe),
      s.nonConformiteId ? "Oui" : "",
    ])
  );
  return csvResponse(`signalements-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
