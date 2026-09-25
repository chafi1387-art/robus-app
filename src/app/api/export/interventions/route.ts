import { db } from "@/db";
import { appareils, clients, interventions, projets, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/format";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  await requireUser(ROLES_BUREAU);

  // Phase 6 : le client/l'adresse d'une intervention se dérivent du Projet
  // (l'Appareil n'étant plus nécessairement rattaché à un Site) — LEFT JOIN
  // pour ne jamais faire disparaître une intervention sans Projet.
  const lignes = await db
    .select({
      intervention: interventions,
      appareil: appareils,
      projet: projets,
      client: clients,
      technicien: users.nom,
    })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .leftJoin(clients, eq(projets.clientId, clients.id))
    .leftJoin(users, eq(interventions.technicienId, users.id))
    .orderBy(desc(interventions.dateProgrammee));

  const csv = toCsv(
    [
      "Client",
      "Adresse",
      "Appareil",
      "Type",
      "Statut",
      "Priorité",
      "Technicien",
      "Date programmée",
      "Date début",
      "Date fin",
      "Description",
    ],
    lignes.map(({ intervention, appareil, projet, client, technicien }) => [
      client?.raisonSociale ?? "",
      projet?.adresse ?? "",
      appareil.numeroInterne,
      intervention.type,
      intervention.statut,
      intervention.priorite,
      technicien ?? "",
      formatDateTime(intervention.dateProgrammee),
      formatDateTime(intervention.dateDebut),
      formatDateTime(intervention.dateFin),
      intervention.description ?? "",
    ])
  );

  return csvResponse("interventions.csv", csv);
}
