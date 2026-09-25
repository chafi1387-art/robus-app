import { Card, Btn, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { clients, sites } from "@/db/schema";
import { count, eq } from "drizzle-orm";
import Link from "next/link";
import { createClient } from "../actions";

async function getClients() {
  const rows = await db
    .select({
      id: clients.id,
      raisonSociale: clients.raisonSociale,
      type: clients.type,
    })
    .from(clients)
    .orderBy(clients.raisonSociale);

  const withCounts = await Promise.all(
    rows.map(async (c) => {
      const [{ n }] = await db.select({ n: count() }).from(sites).where(eq(sites.clientId, c.id));
      return { ...c, nbSites: Number(n) };
    })
  );
  return withCounts;
}

const TYPE_LABEL: Record<string, string> = {
  copropriete: "Copropriété",
  entreprise: "Entreprise",
  particulier: "Particulier",
  syndicat: "Syndicat",
};

export default async function ClientsPage() {
  const rows = await getClients();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold font-display">Clients</h1>
          <p className="text-sm text-ink-soft">{rows.length} client(s) enregistré(s)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-col divide-y divide-line">
            {rows.map((c) => (
              <Link
                key={c.id}
                href={`/responsable/clients/${c.id}`}
                className="py-3 flex items-center justify-between hover:bg-blue-pale rounded-lg px-2 -mx-2"
              >
                <div>
                  <div className="font-semibold text-sm">{c.raisonSociale}</div>
                  <div className="text-xs text-ink-soft">{TYPE_LABEL[c.type] ?? c.type}</div>
                </div>
                <div className="text-xs text-ink-soft">{c.nbSites} site(s)</div>
              </Link>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun client pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Nouveau client</h2>
          <form action={createClient} className="flex flex-col gap-3">
            <Field label="Raison sociale / Nom">
              <input name="raisonSociale" required className={inputClass} placeholder="Copropriété..." />
            </Field>
            <Field label="Type de client">
              <select name="type" className={inputClass} defaultValue="copropriete">
                <option value="copropriete">Copropriété</option>
                <option value="entreprise">Entreprise</option>
                <option value="particulier">Particulier</option>
                <option value="syndicat">Syndicat</option>
              </select>
            </Field>
            <Btn>Créer le client</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
