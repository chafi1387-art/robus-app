import { Card, Pill, Btn, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { clients, devis, sites } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { createDevis, updateDevisStatut } from "./actions";

const STATUT_LABEL: Record<string, string> = {
  brouillon: "Brouillon",
  envoye: "Envoyé",
  accepte: "Accepté",
  refuse: "Refusé",
};

const STATUT_TONE: Record<string, "ok" | "warn" | "crit" | "neutral"> = {
  brouillon: "neutral",
  envoye: "warn",
  accepte: "ok",
  refuse: "crit",
};

const STATUTS_SUIVANTS: Record<string, { statut: string; label: string }[]> = {
  brouillon: [{ statut: "envoye", label: "Envoyer" }],
  envoye: [
    { statut: "accepte", label: "Accepter" },
    { statut: "refuse", label: "Refuser" },
  ],
  accepte: [],
  refuse: [],
};

function formatMontant(v: string | null) {
  if (v === null) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

async function getDevis() {
  return db
    .select({
      id: devis.id,
      numero: devis.numero,
      statut: devis.statut,
      montantHt: devis.montantHt,
      description: devis.description,
      createdAt: devis.createdAt,
      dateEnvoi: devis.dateEnvoi,
      dateReponse: devis.dateReponse,
      raisonSociale: clients.raisonSociale,
      siteAdresse: sites.adresse,
    })
    .from(devis)
    .innerJoin(clients, eq(devis.clientId, clients.id))
    .leftJoin(sites, eq(devis.siteId, sites.id))
    .orderBy(desc(devis.createdAt));
}

async function getClientsEtSites() {
  const clientRows = await db
    .select({ id: clients.id, raisonSociale: clients.raisonSociale })
    .from(clients)
    .orderBy(clients.raisonSociale);

  const sitesByClient = await Promise.all(
    clientRows.map(async (c) => {
      const siteRows = await db
        .select({ id: sites.id, adresse: sites.adresse })
        .from(sites)
        .where(eq(sites.clientId, c.id));
      return { client: c, siteRows };
    })
  );
  return sitesByClient;
}

export default async function DevisPage() {
  await requireUser(ROLES_BUREAU);
  const [rows, clientsAvecSites] = await Promise.all([getDevis(), getClientsEtSites()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Devis</h1>
        <p className="text-sm text-ink-soft">{rows.length} devis enregistré(s)</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="pb-2 pr-3">Numéro</th>
                  <th className="pb-2 pr-3">Client</th>
                  <th className="pb-2 pr-3">Montant HT</th>
                  <th className="pb-2 pr-3">Statut</th>
                  <th className="pb-2 pr-3">Créé le</th>
                  <th className="pb-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-b border-line last:border-0 align-top">
                    <td className="py-2.5 pr-3 font-semibold whitespace-nowrap">{d.numero}</td>
                    <td className="py-2.5 pr-3">
                      <div>{d.raisonSociale}</div>
                      {d.siteAdresse && (
                        <div className="text-xs text-ink-soft">{d.siteAdresse}</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">{formatMontant(d.montantHt)}</td>
                    <td className="py-2.5 pr-3">
                      <Pill tone={STATUT_TONE[d.statut] ?? "neutral"}>
                        {STATUT_LABEL[d.statut] ?? d.statut}
                      </Pill>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-ink-soft">
                      {formatDate(d.createdAt)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1.5">
                        {(STATUTS_SUIVANTS[d.statut] ?? []).map((next) => (
                          <form key={next.statut} action={updateDevisStatut}>
                            <input type="hidden" name="id" value={d.id} />
                            <input type="hidden" name="statut" value={next.statut} />
                            <button
                              type="submit"
                              className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-line hover:bg-blue-pale hover:border-blue-pale"
                            >
                              {next.label}
                            </button>
                          </form>
                        ))}
                        {(STATUTS_SUIVANTS[d.statut] ?? []).length === 0 && (
                          <span className="text-xs text-ink-soft">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun devis pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Nouveau devis</h2>
          <form action={createDevis} className="flex flex-col gap-3">
            <Field label="Client">
              <select name="clientId" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Choisir un client...
                </option>
                {clientsAvecSites.map(({ client }) => (
                  <option key={client.id} value={client.id}>
                    {client.raisonSociale}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Site (optionnel)">
              <select name="siteId" className={inputClass} defaultValue="">
                <option value="">Aucun site précis</option>
                {clientsAvecSites.map(({ client, siteRows }) =>
                  siteRows.length > 0 ? (
                    <optgroup key={client.id} label={client.raisonSociale}>
                      {siteRows.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.adresse}
                        </option>
                      ))}
                    </optgroup>
                  ) : null
                )}
              </select>
            </Field>
            <Field label="Montant HT (€)">
              <input
                type="number"
                step="0.01"
                min="0"
                name="montantHt"
                className={inputClass}
                placeholder="0.00"
              />
            </Field>
            <Field label="Description">
              <textarea
                name="description"
                rows={3}
                className={inputClass}
                placeholder="Objet du devis..."
              />
            </Field>
            <Btn>Créer le devis</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
