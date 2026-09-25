import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { db } from "@/db";
import { appareils, reglesPlanification, sites, clients } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { asc, eq } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import { createRegle, genererInterventionsPlanifiees, toggleRegleActive } from "./actions";

const JOUR_MS = 24 * 60 * 60 * 1000;

const TYPE_LABEL: Record<string, string> = {
  preventive: "Préventive",
  corrective: "Corrective",
  systematique: "Systématique",
};

function statutEcheance(prochaineDate: Date, anticipationJours: number) {
  const joursRestants = Math.ceil((prochaineDate.getTime() - Date.now()) / JOUR_MS);
  if (joursRestants < 0) return { label: "Échéance dépassée", tone: "crit" as const };
  if (joursRestants <= anticipationJours) return { label: `Dans ${joursRestants} j`, tone: "warn" as const };
  return { label: `Dans ${joursRestants} j`, tone: "ok" as const };
}

// Phase 6 : l'Appareil n'étant plus nécessairement rattaché à un Site, ces
// requêtes passent en LEFT JOIN pour ne jamais exclure ni faire planter
// l'affichage d'un appareil/d'une règle sans Site.
async function getRegles() {
  return db
    .select({ regle: reglesPlanification, appareil: appareils, site: sites, client: clients })
    .from(reglesPlanification)
    .innerJoin(appareils, eq(reglesPlanification.appareilId, appareils.id))
    .leftJoin(sites, eq(appareils.siteId, sites.id))
    .leftJoin(clients, eq(sites.clientId, clients.id))
    .orderBy(asc(reglesPlanification.prochaineDate));
}

async function getAppareils() {
  return db
    .select({ appareil: appareils, site: sites, client: clients })
    .from(appareils)
    .leftJoin(sites, eq(appareils.siteId, sites.id))
    .leftJoin(clients, eq(sites.clientId, clients.id))
    .orderBy(asc(appareils.numeroInterne));
}

export default async function PlanificationPage({
  searchParams,
}: {
  searchParams: Promise<{ generees?: string }>;
}) {
  await requireUser(ROLES_BUREAU);
  const { generees } = await searchParams;
  const [regles, listeAppareils] = await Promise.all([getRegles(), getAppareils()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold font-display">Planning automatique</h1>
          <p className="text-sm text-ink-soft">
            Règles de récurrence par appareil — génère les interventions préventives à venir.
          </p>
        </div>
        <form action={genererInterventionsPlanifiees}>
          <Btn type="submit">Générer les interventions à venir</Btn>
        </form>
      </div>

      {generees !== undefined && (
        <div className="text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">
          {Number(generees) > 0
            ? `${generees} intervention(s) préventive(s) générée(s).`
            : "Aucune échéance dans la fenêtre d'anticipation pour le moment."}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="pb-2 pr-3">Appareil</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Périodicité</th>
                  <th className="pb-2 pr-3">Prochaine échéance</th>
                  <th className="pb-2 pr-3">Statut</th>
                  <th className="pb-2 pr-3">Actif</th>
                </tr>
              </thead>
              <tbody>
                {regles.map(({ regle, appareil, site, client }) => {
                  const statut = statutEcheance(regle.prochaineDate, regle.anticipationJours);
                  return (
                    <tr key={regle.id} className="border-b border-line last:border-0 align-top">
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold">{appareil.numeroInterne}</div>
                        <div className="text-xs text-ink-soft">
                          {client && site ? `${client.raisonSociale} — ${site.adresse}` : "—"}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-ink-soft">{TYPE_LABEL[regle.type]}</td>
                      <td className="py-2.5 pr-3 text-ink-soft">{regle.periodiciteMois} mois</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">{formatDate(regle.prochaineDate)}</td>
                      <td className="py-2.5 pr-3">
                        {regle.actif === 1 ? (
                          <Pill tone={statut.tone}>{statut.label}</Pill>
                        ) : (
                          <Pill tone="neutral">Inactive</Pill>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <form action={toggleRegleActive}>
                          <input type="hidden" name="id" value={regle.id} />
                          <Btn type="submit" variant="ghost" className="!px-3 !py-1.5 !text-xs">
                            {regle.actif === 1 ? "Désactiver" : "Activer"}
                          </Btn>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {regles.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucune règle de planification définie.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Nouvelle règle</h2>
          <form action={createRegle} className="flex flex-col gap-3">
            <Field label="Appareil">
              <select name="appareilId" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Sélectionner un appareil
                </option>
                {listeAppareils.map(({ appareil, site, client }) => (
                  <option key={appareil.id} value={appareil.id}>
                    {appareil.numeroInterne}
                    {client && site ? ` — ${client.raisonSociale} (${site.adresse})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type d'intervention">
              <select name="type" className={inputClass} defaultValue="preventive">
                <option value="preventive">Préventive</option>
                <option value="systematique">Systématique</option>
                <option value="corrective">Corrective</option>
              </select>
            </Field>
            <Field label="Périodicité (mois)">
              <input type="number" name="periodiciteMois" min={1} defaultValue={6} required className={inputClass} />
            </Field>
            <Field label="Anticipation (jours)">
              <input type="number" name="anticipationJours" min={0} defaultValue={15} className={inputClass} />
            </Field>
            <Field label="Prochaine échéance">
              <input type="date" name="prochaineDate" required className={inputClass} />
            </Field>
            <Btn>Créer la règle</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
