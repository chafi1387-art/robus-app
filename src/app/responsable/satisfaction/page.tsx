import { Card, Pill, Btn, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { appareils, clients, interventions, projets, sites } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import {
  createEnquete,
  createReclamation,
  getEnquetes,
  getReclamations,
  updateReclamationStatut,
} from "./actions";

const STATUT_RECLAMATION_LABEL: Record<string, string> = {
  ouverte: "Ouverte",
  en_cours: "En cours",
  cloturee: "Clôturée",
};
const STATUT_RECLAMATION_TONE: Record<string, "ok" | "warn" | "crit"> = {
  ouverte: "crit",
  en_cours: "warn",
  cloturee: "ok",
};
// Cycle de vie d'une réclamation : ouverte -> en_cours -> clôturée.
const PROCHAIN_STATUT: Record<string, { statut: string; label: string } | null> = {
  ouverte: { statut: "en_cours", label: "Passer en cours" },
  en_cours: { statut: "cloturee", label: "Clôturer" },
  cloturee: null,
};

async function getClientsOptions() {
  return db
    .select({ id: clients.id, raisonSociale: clients.raisonSociale })
    .from(clients)
    .orderBy(clients.raisonSociale);
}

async function getSitesOptions() {
  return db
    .select({ id: sites.id, adresse: sites.adresse, raisonSociale: clients.raisonSociale })
    .from(sites)
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .orderBy(clients.raisonSociale, sites.adresse);
}

// Phase 6 : le client d'une intervention se dérive désormais du Projet
// (l'Appareil n'étant plus nécessairement rattaché à un Site) — LEFT JOIN
// pour ne jamais faire disparaître une intervention sans Projet.
async function getInterventionsOptions() {
  return db
    .select({
      id: interventions.id,
      type: interventions.type,
      dateProgrammee: interventions.dateProgrammee,
      numeroInterne: appareils.numeroInterne,
      raisonSociale: clients.raisonSociale,
    })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .leftJoin(clients, eq(projets.clientId, clients.id))
    .orderBy(desc(interventions.dateProgrammee));
}

export default async function SatisfactionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireUser(ROLES_BUREAU);
  const { tab } = await searchParams;
  const activeTab = tab === "reclamations" ? "reclamations" : "enquetes";

  const [enquetes, reclamations, clientsOptions, sitesOptions, interventionsOptions] =
    await Promise.all([
      getEnquetes(),
      getReclamations(),
      getClientsOptions(),
      getSitesOptions(),
      getInterventionsOptions(),
    ]);

  const moyenne =
    enquetes.length > 0
      ? enquetes.reduce((sum, e) => sum + e.note, 0) / enquetes.length
      : null;
  const reclamationsOuvertes = reclamations.filter((r) => r.statut !== "cloturee").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Satisfaction client</h1>
        <p className="text-sm text-ink-soft">
          Enquêtes de satisfaction et réclamations — clause ISO 9001 9.1.2
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">
            Note moyenne
          </div>
          <div className="text-3xl font-extrabold font-display">
            {moyenne !== null ? `${moyenne.toFixed(1)} / 5` : "—"}
          </div>
          <div className="text-xs text-ink-soft mt-1">
            {enquetes.length} enquête(s) enregistrée(s)
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">
            Réclamations ouvertes
          </div>
          <div className="text-3xl font-extrabold font-display">{reclamationsOuvertes}</div>
          <div className="text-xs text-ink-soft mt-1">sur {reclamations.length} au total</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">
            Réclamations clôturées
          </div>
          <div className="text-3xl font-extrabold font-display">
            {reclamations.filter((r) => r.statut === "cloturee").length}
          </div>
          <div className="text-xs text-ink-soft mt-1">résolues à ce jour</div>
        </Card>
      </div>

      <div className="flex gap-2 border-b border-line">
        <a
          href="/responsable/satisfaction?tab=enquetes"
          className={`px-4 py-2.5 text-sm font-bold font-display border-b-2 -mb-px transition-colors ${
            activeTab === "enquetes"
              ? "border-blue text-blue"
              : "border-transparent text-ink-soft hover:text-ink"
          }`}
        >
          Enquêtes de satisfaction
        </a>
        <a
          href="/responsable/satisfaction?tab=reclamations"
          className={`px-4 py-2.5 text-sm font-bold font-display border-b-2 -mb-px transition-colors ${
            activeTab === "reclamations"
              ? "border-blue text-blue"
              : "border-transparent text-ink-soft hover:text-ink"
          }`}
        >
          Réclamations
        </a>
      </div>

      {activeTab === "enquetes" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-5 lg:col-span-2">
            <h2 className="font-display font-bold text-sm mb-3">Enquêtes récentes</h2>
            <div className="flex flex-col divide-y divide-line">
              {[...enquetes].reverse().map((e) => (
                <div key={e.id} className="py-3 flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm">{e.raisonSociale}</div>
                    <Pill tone={e.note >= 4 ? "ok" : e.note === 3 ? "warn" : "crit"}>
                      {e.note} / 5
                    </Pill>
                  </div>
                  {e.commentaire && (
                    <p className="text-sm text-ink-soft">{e.commentaire}</p>
                  )}
                  <div className="text-xs text-ink-soft">
                    {formatDateTime(e.dateEnquete)}
                    {e.interventionId && ` — intervention liée`}
                  </div>
                </div>
              ))}
              {enquetes.length === 0 && (
                <p className="text-sm text-ink-soft py-3">Aucune enquête pour l&apos;instant.</p>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Nouvelle enquête</h2>
            <form action={createEnquete} className="flex flex-col gap-3">
              <Field label="Client">
                <select name="clientId" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Sélectionner un client
                  </option>
                  {clientsOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.raisonSociale}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Intervention (optionnel)">
                <select name="interventionId" className={inputClass} defaultValue="">
                  <option value="">Aucune</option>
                  {interventionsOptions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.raisonSociale} — {i.numeroInterne} ({formatDate(i.dateProgrammee)})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Note de satisfaction">
                <select name="note" required className={inputClass} defaultValue="5">
                  <option value="5">5 — Très satisfait</option>
                  <option value="4">4 — Satisfait</option>
                  <option value="3">3 — Neutre</option>
                  <option value="2">2 — Insatisfait</option>
                  <option value="1">1 — Très insatisfait</option>
                </select>
              </Field>
              <Field label="Commentaire">
                <textarea
                  name="commentaire"
                  rows={3}
                  className={inputClass}
                  placeholder="Retour du client..."
                />
              </Field>
              <Btn>Enregistrer l&apos;enquête</Btn>
            </form>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-5 lg:col-span-2">
            <h2 className="font-display font-bold text-sm mb-3">Réclamations récentes</h2>
            <div className="flex flex-col divide-y divide-line">
              {[...reclamations].reverse().map((r) => {
                const suivant = PROCHAIN_STATUT[r.statut];
                return (
                  <div key={r.id} className="py-3 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-sm">
                        {r.raisonSociale}
                        {r.adresse && (
                          <span className="text-ink-soft font-normal"> — {r.adresse}</span>
                        )}
                      </div>
                      <Pill tone={STATUT_RECLAMATION_TONE[r.statut] ?? "neutral"}>
                        {STATUT_RECLAMATION_LABEL[r.statut] ?? r.statut}
                      </Pill>
                    </div>
                    <p className="text-sm text-ink-soft">{r.description}</p>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-ink-soft">
                        Déclarée le {formatDateTime(r.dateReclamation)}
                        {r.dateResolution && ` — résolue le ${formatDateTime(r.dateResolution)}`}
                      </div>
                      {suivant && (
                        <form action={updateReclamationStatut}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="statut" value={suivant.statut} />
                          <Btn variant="ghost" className="!py-1 !px-3 text-xs">
                            {suivant.label}
                          </Btn>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })}
              {reclamations.length === 0 && (
                <p className="text-sm text-ink-soft py-3">Aucune réclamation pour l&apos;instant.</p>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Nouvelle réclamation</h2>
            <form action={createReclamation} className="flex flex-col gap-3">
              <Field label="Client">
                <select name="clientId" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Sélectionner un client
                  </option>
                  {clientsOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.raisonSociale}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Site (optionnel)">
                <select name="siteId" className={inputClass} defaultValue="">
                  <option value="">Aucun</option>
                  {sitesOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.raisonSociale} — {s.adresse}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Description">
                <textarea
                  name="description"
                  required
                  rows={4}
                  className={inputClass}
                  placeholder="Détail de la réclamation..."
                />
              </Field>
              <Btn>Enregistrer la réclamation</Btn>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
