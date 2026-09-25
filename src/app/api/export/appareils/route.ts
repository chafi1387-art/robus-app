import { db } from "@/db";
import { appareils, clients, sites } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { csvResponse, toCsv } from "@/lib/csv";
import { asc, eq } from "drizzle-orm";

export async function GET() {
  await requireUser(ROLES_BUREAU);

  // Phase 6 : l'Appareil n'est plus nécessairement rattaché à un Site — LEFT
  // JOIN pour ne pas faire disparaître les appareils indépendants de l'export.
  const lignes = await db
    .select({ appareil: appareils, site: sites, client: clients })
    .from(appareils)
    .leftJoin(sites, eq(appareils.siteId, sites.id))
    .leftJoin(clients, eq(sites.clientId, clients.id))
    .orderBy(asc(appareils.numeroInterne));

  const csv = toCsv(
    [
      "N° interne",
      "N° série",
      "Marque",
      "Modèle",
      "Type",
      "Année installation",
      "Statut",
      "Client",
      "Site",
    ],
    lignes.map(({ appareil, site, client }) => [
      appareil.numeroInterne,
      appareil.numeroSerie ?? "",
      appareil.marque ?? "",
      appareil.modele ?? "",
      appareil.typeAppareil ?? "",
      appareil.anneeInstallation ?? "",
      appareil.statut,
      client?.raisonSociale ?? "",
      site?.adresse ?? "",
    ])
  );

  return csvResponse("appareils.csv", csv);
}
