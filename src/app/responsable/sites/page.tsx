import { Card, Btn, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { appareils, clients, sites } from "@/db/schema";
import { count, eq } from "drizzle-orm";
import Link from "next/link";
import { createSite, getClientsForSelect } from "../actions";

export default async function SitesPage() {
  const [siteRows, clientRows] = await Promise.all([
    db
      .select({
        id: sites.id,
        adresse: sites.adresse,
        raisonSociale: clients.raisonSociale,
        clientId: clients.id,
      })
      .from(sites)
      .innerJoin(clients, eq(sites.clientId, clients.id))
      .orderBy(clients.raisonSociale, sites.adresse),
    getClientsForSelect(),
  ]);

  const rows = await Promise.all(
    siteRows.map(async (s) => {
      const [{ n }] = await db.select({ n: count() }).from(appareils).where(eq(appareils.siteId, s.id));
      return { ...s, nbAppareils: Number(n) };
    })
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Sites</h1>
        <p className="text-sm text-ink-soft">{rows.length} site(s) enregistré(s)</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-col divide-y divide-line">
            {rows.map((s) => (
              <Link
                key={s.id}
                href={`/responsable/sites/${s.id}`}
                className="py-3 flex items-center justify-between gap-3 hover:bg-blue-pale rounded-lg px-2 -mx-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{s.adresse}</div>
                  <div className="text-xs text-ink-soft truncate">{s.raisonSociale}</div>
                </div>
                <div className="text-xs text-ink-soft whitespace-nowrap">{s.nbAppareils} appareil(s)</div>
              </Link>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun site pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">Nouveau site</h2>
          <form action={createSite} className="flex flex-col gap-3">
            <Field label="Client">
              <select name="clientId" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Choisir un client...
                </option>
                {clientRows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.raisonSociale}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Adresse complète">
              <textarea name="adresse" required rows={2} className={inputClass} />
            </Field>
            <Field label="Instructions d'accès">
              <textarea name="instructionsAcces" rows={2} className={inputClass} />
            </Field>
            <Btn>Créer le site</Btn>
          </form>
          {clientRows.length === 0 && (
            <p className="text-xs text-ink-soft mt-2">
              Créez d&apos;abord un client depuis la page Clients &amp; Sites.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
