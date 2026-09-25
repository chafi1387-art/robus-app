import { db } from "@/db";
import { appareils, clients, nonConformites, sites } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDate } from "@/lib/format";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  await requireUser(ROLES_BUREAU);

  const lignes = await db
    .select({ nc: nonConformites, appareil: appareils, site: sites, client: clients })
    .from(nonConformites)
    .leftJoin(appareils, eq(nonConformites.appareilId, appareils.id))
    .leftJoin(sites, eq(nonConformites.siteId, sites.id))
    .leftJoin(clients, eq(nonConformites.clientId, clients.id))
    .orderBy(desc(nonConformites.createdAt));

  const csv = toCsv(
    ["Titre", "Gravité", "Statut", "Client", "Site", "Appareil", "Échéance", "Clôturée le", "Description"],
    lignes.map(({ nc, appareil, site, client }) => [
      nc.titre,
      nc.gravite,
      nc.statut,
      client?.raisonSociale ?? "",
      site?.adresse ?? "",
      appareil?.numeroInterne ?? "",
      formatDate(nc.dateEcheance),
      formatDate(nc.dateCloture),
      nc.description ?? "",
    ])
  );

  return csvResponse("non-conformites.csv", csv);
}
