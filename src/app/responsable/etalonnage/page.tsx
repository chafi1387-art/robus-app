import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { db } from "@/db";
import { instrumentsMesure } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { asc } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import { createInstrument, enregistrerEtalonnage } from "./actions";

const JOUR_MS = 24 * 60 * 60 * 1000;

function statutEtalonnage(dateProchainEtalonnage: Date | null) {
  if (!dateProchainEtalonnage) return { label: "Non étalonné", tone: "neutral" as const };
  const joursRestants = Math.ceil(
    (dateProchainEtalonnage.getTime() - Date.now()) / JOUR_MS
  );
  if (joursRestants < 0) return { label: "Étalonnage dépassé", tone: "crit" as const };
  if (joursRestants <= 30) return { label: `À échéance dans ${joursRestants} j`, tone: "warn" as const };
  return { label: "À jour", tone: "ok" as const };
}

async function getInstruments() {
  return db.select().from(instrumentsMesure).orderBy(asc(instrumentsMesure.nom));
}

export default async function EtalonnagePage() {
  await requireUser(ROLES_BUREAU);
  const rows = await getInstruments();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Étalonnage des instruments de mesure</h1>
        <p className="text-sm text-ink-soft">
          Clause 7.1.5 — {rows.length} instrument(s) suivi(s)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="pb-2 pr-3">Instrument</th>
                  <th className="pb-2 pr-3">Référence</th>
                  <th className="pb-2 pr-3">Dernier étalonnage</th>
                  <th className="pb-2 pr-3">Prochain étalonnage</th>
                  <th className="pb-2 pr-3">Statut</th>
                  <th className="pb-2 pr-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((instrument) => {
                  const statut = statutEtalonnage(instrument.dateProchainEtalonnage);
                  return (
                    <tr key={instrument.id} className="border-b border-line last:border-0 align-top">
                      <td className="py-2.5 pr-3 font-semibold">{instrument.nom}</td>
                      <td className="py-2.5 pr-3 text-ink-soft">{instrument.reference ?? "—"}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {formatDate(instrument.dateDernierEtalonnage)}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {formatDate(instrument.dateProchainEtalonnage)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Pill tone={statut.tone}>{statut.label}</Pill>
                      </td>
                      <td className="py-2.5 pr-3">
                        <details className="group">
                          <summary className="list-none cursor-pointer inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold font-display bg-transparent border border-line text-ink hover:bg-blue-pale hover:border-blue-pale transition-colors">
                            Enregistrer un étalonnage
                          </summary>
                          <form
                            action={enregistrerEtalonnage}
                            className="mt-2 flex flex-wrap items-end gap-2"
                          >
                            <input type="hidden" name="instrumentId" value={instrument.id} />
                            <input
                              type="date"
                              name="date"
                              required
                              className={`${inputClass} !py-1 !text-xs w-auto`}
                            />
                            <Btn type="submit" variant="primary" className="!px-3 !py-1.5 !text-xs">
                              Valider
                            </Btn>
                          </form>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun instrument enregistré.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Nouvel instrument</h2>
          <form action={createInstrument} className="flex flex-col gap-3">
            <Field label="Nom">
              <input name="nom" required className={inputClass} placeholder="Ex. Télémètre laser" />
            </Field>
            <Field label="Référence">
              <input name="reference" className={inputClass} placeholder="Référence / numéro de série" />
            </Field>
            <Field label="Date du dernier étalonnage">
              <input type="date" name="dateDernierEtalonnage" className={inputClass} />
            </Field>
            <Field label="Périodicité (mois)">
              <input
                type="number"
                name="periodiciteMois"
                min={1}
                defaultValue={12}
                className={inputClass}
              />
            </Field>
            <Btn>Ajouter l&apos;instrument</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
