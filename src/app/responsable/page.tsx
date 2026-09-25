import { Card, Pill, StatutInterventionPill, TypeInterventionPill } from "@/components/ui";
import { db } from "@/db";
import {
  appareils,
  clients,
  garanties,
  interventions,
  projets,
  scoreIsoSaisies,
  sites,
  users,
} from "@/db/schema";
import { and, count, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { formatDateTime } from "@/lib/format";
import { BLOCS_ISO, calculerScoreGlobal } from "@/lib/score-iso";
import Link from "next/link";

const DONE_STATUSES = ["terminee", "validee", "cloturee"] as const;

async function getStats() {
  const now = new Date();

  const [[{ n: nbClients }], [{ n: nbSites }], [{ n: nbAppareils }], [{ n: nbInterventions }]] =
    await Promise.all([
      db.select({ n: count() }).from(clients),
      db.select({ n: count() }).from(sites),
      db.select({ n: count() }).from(appareils),
      db.select({ n: count() }).from(interventions),
    ]);

  const [[{ n: nbAppareilsEnPanne }]] = await Promise.all([
    db.select({ n: count() }).from(appareils).where(eq(appareils.statut, "en_panne")),
  ]);

  const [[{ n: nbDone }]] = await Promise.all([
    db
      .select({ n: count() })
      .from(interventions)
      .where(sql`${interventions.statut} in ('terminee','validee','cloturee')`),
  ]);

  const [[{ n: nbEnRetard }]] = await Promise.all([
    db
      .select({ n: count() })
      .from(interventions)
      .where(
        and(
          lt(interventions.dateProgrammee, now),
          sql`${interventions.statut} not in ('terminee','validee','cloturee')`
        )
      ),
  ]);

  const [[{ n: nbNonAffectees }]] = await Promise.all([
    db
      .select({ n: count() })
      .from(interventions)
      .where(and(ne(interventions.statut, "cloturee"), isNull(interventions.technicienId))),
  ]);

  const tauxRealisation =
    Number(nbInterventions) > 0 ? Math.round((Number(nbDone) / Number(nbInterventions)) * 100) : 0;

  return {
    nbClients: Number(nbClients),
    nbSites: Number(nbSites),
    nbAppareils: Number(nbAppareils),
    nbInterventions: Number(nbInterventions),
    nbAppareilsEnPanne: Number(nbAppareilsEnPanne),
    nbEnRetard: Number(nbEnRetard),
    nbNonAffectees: Number(nbNonAffectees),
    tauxRealisation,
  };
}

async function getAlertes() {
  const now = new Date();

  // Phase 6 : l'Appareil n'est plus rattaché à un Site — le client se
  // dérive désormais du Projet. LEFT JOIN pour ne jamais faire disparaître
  // (ou planter sur) une intervention/un appareil sans Projet/Site.
  const enRetard = await db
    .select({
      id: interventions.id,
      description: interventions.description,
      type: interventions.type,
      dateProgrammee: interventions.dateProgrammee,
      numeroInterne: appareils.numeroInterne,
      raisonSociale: clients.raisonSociale,
    })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .leftJoin(clients, eq(projets.clientId, clients.id))
    .where(
      and(
        lt(interventions.dateProgrammee, now),
        sql`${interventions.statut} not in ('terminee','validee','cloturee')`
      )
    )
    .limit(6);

  const enPanne = await db
    .select({
      id: appareils.id,
      numeroInterne: appareils.numeroInterne,
      raisonSociale: clients.raisonSociale,
    })
    .from(appareils)
    .leftJoin(sites, eq(appareils.siteId, sites.id))
    .leftJoin(clients, eq(sites.clientId, clients.id))
    .where(eq(appareils.statut, "en_panne"))
    .limit(6);

  return { enRetard, enPanne };
}

const JOURS_ALERTE_GARANTIE = 60;

async function getGarantiesStats() {
  const now = new Date();
  const [[{ n: nbActives }]] = await Promise.all([
    db.select({ n: count() }).from(garanties).where(gte(garanties.dateFin, now)),
  ]);

  const seuil = new Date(now.getTime() + JOURS_ALERTE_GARANTIE * 24 * 60 * 60 * 1000);
  const echeanceProche = await db
    .select({
      id: garanties.id,
      dateFin: garanties.dateFin,
      projetId: projets.id,
      reference: projets.reference,
      raisonSociale: clients.raisonSociale,
    })
    .from(garanties)
    .innerJoin(projets, eq(garanties.projetId, projets.id))
    .innerJoin(clients, eq(projets.clientId, clients.id))
    .where(and(gte(garanties.dateFin, now), lt(garanties.dateFin, seuil)))
    .limit(6);

  return { nbActives: Number(nbActives), echeanceProche };
}

async function getPlanningDuJour() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 86400000);

  return db
    .select({
      id: interventions.id,
      type: interventions.type,
      statut: interventions.statut,
      dateProgrammee: interventions.dateProgrammee,
      numeroInterne: appareils.numeroInterne,
      raisonSociale: clients.raisonSociale,
      technicien: users.nom,
    })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .leftJoin(clients, eq(projets.clientId, clients.id))
    .leftJoin(users, eq(interventions.technicienId, users.id))
    .where(and(gte(interventions.dateProgrammee, startOfDay), lt(interventions.dateProgrammee, endOfDay)))
    .orderBy(interventions.dateProgrammee);
}

function moisCourant() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getScoreIsoTeaser() {
  const mois = moisCourant();
  const rows = await db
    .select()
    .from(scoreIsoSaisies)
    .where(eq(scoreIsoSaisies.mois, mois));
  const valeurs: Record<string, number> = {};
  for (const r of rows) valeurs[r.bloc] = Number(r.valeur);
  return {
    mois,
    score: calculerScoreGlobal(valeurs),
    nbBlocsSaisis: rows.length,
    totalBlocs: BLOCS_ISO.length,
  };
}

function toneScore(score: number): "ok" | "warn" | "crit" {
  if (score >= 80) return "ok";
  if (score >= 50) return "warn";
  return "crit";
}

const TONE_TEXT: Record<"ok" | "warn" | "crit", string> = {
  ok: "text-green-ink",
  warn: "text-orange-ink",
  crit: "text-red-ink",
};

export default async function DashboardPage() {
  const [stats, alertes, planning, scoreIso, garantiesStats] = await Promise.all([
    getStats(),
    getAlertes(),
    getPlanningDuJour(),
    getScoreIsoTeaser(),
    getGarantiesStats(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Tableau de bord synthétique</h1>
        <p className="text-sm text-ink-soft">
          Vue d&apos;ensemble qualité &amp; exploitation — données réelles de la base.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile label="Clients" value={stats.nbClients} href="/responsable/clients" />
        <StatTile label="Sites" value={stats.nbSites} />
        <StatTile label="Appareils" value={stats.nbAppareils} href="/responsable/appareils" />
        <StatTile label="Interventions" value={stats.nbInterventions} href="/responsable/interventions" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">
            Taux de réalisation
          </div>
          <div className="font-display text-3xl font-extrabold tabular">
            {stats.tauxRealisation}%
          </div>
          <div className="text-xs text-ink-soft mt-1">
            Interventions terminées, validées ou clôturées
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">
            En retard
          </div>
          <div className="font-display text-3xl font-extrabold tabular text-red-ink">
            {stats.nbEnRetard}
          </div>
          <div className="text-xs text-ink-soft mt-1">Interventions dépassant leur échéance</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">
            Appareils en panne
          </div>
          <div className="font-display text-3xl font-extrabold tabular text-red-ink">
            {stats.nbAppareilsEnPanne}
          </div>
          <div className="text-xs text-ink-soft mt-1">Nécessitent une intervention corrective</div>
        </Card>
        <Link href="/responsable/garanties" className="block hover:shadow-md transition-shadow rounded-2xl">
          <Card className="p-5 h-full">
            <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">
              Garanties actives
            </div>
            <div className="font-display text-3xl font-extrabold tabular text-green-ink">
              {garantiesStats.nbActives}
            </div>
            <div className="text-xs text-ink-soft mt-1">
              {garantiesStats.echeanceProche.length > 0
                ? `${garantiesStats.echeanceProche.length} à échéance sous ${JOURS_ALERTE_GARANTIE} j`
                : "Aucune échéance proche"}
            </div>
          </Card>
        </Link>
      </div>

      <Link
        href="/responsable/score-iso"
        className="flex items-center justify-between gap-4 bg-blue-pale rounded-xl px-5 py-4 hover:bg-blue-pale/70 transition-colors"
      >
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">
            Score ISO 9001 — {scoreIso.mois}
          </div>
          <div className="text-xs text-ink-soft">
            {scoreIso.nbBlocsSaisis} / {scoreIso.totalBlocs} blocs saisis ce mois — voir le détail
            et l&apos;historique
          </div>
        </div>
        <div className={`font-display text-3xl font-extrabold tabular ${TONE_TEXT[toneScore(scoreIso.score)]}`}>
          {scoreIso.score}%
        </div>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Alertes</h2>
          <div className="flex flex-col divide-y divide-line">
            {alertes.enPanne.map((a) => (
              <Link
                key={`panne-${a.id}`}
                href={`/responsable/appareils/${a.id}`}
                className="py-2.5 flex items-center gap-3 hover:bg-blue-pale rounded-lg px-1.5 -mx-1.5"
              >
                <Pill tone="crit">Panne</Pill>
                <div className="text-sm">
                  <span className="font-semibold">{a.numeroInterne}</span> — {a.raisonSociale}
                </div>
              </Link>
            ))}
            {alertes.enRetard.map((a) => (
              <Link
                key={`retard-${a.id}`}
                href={`/responsable/interventions`}
                className="py-2.5 flex items-center gap-3 hover:bg-blue-pale rounded-lg px-1.5 -mx-1.5"
              >
                <Pill tone="warn">Retard</Pill>
                <div className="text-sm">
                  <span className="font-semibold">{a.numeroInterne}</span> — {a.raisonSociale} —{" "}
                  {formatDateTime(a.dateProgrammee)}
                </div>
              </Link>
            ))}
            {garantiesStats.echeanceProche.map((g) => (
              <Link
                key={`garantie-${g.id}`}
                href={`/responsable/projets/${g.projetId}`}
                className="py-2.5 flex items-center gap-3 hover:bg-blue-pale rounded-lg px-1.5 -mx-1.5"
              >
                <Pill tone="warn">Garantie</Pill>
                <div className="text-sm">
                  <span className="font-semibold">{g.reference}</span> — {g.raisonSociale} — échéance{" "}
                  {new Date(g.dateFin).toLocaleDateString("fr-BE")}
                </div>
              </Link>
            ))}
            {alertes.enPanne.length === 0 &&
              alertes.enRetard.length === 0 &&
              garantiesStats.echeanceProche.length === 0 && (
                <p className="text-sm text-ink-soft py-2">Aucune alerte pour le moment.</p>
              )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Planning — aujourd&apos;hui</h2>
          <div className="flex flex-col divide-y divide-line">
            {planning.map((p) => (
              <div key={p.id} className="py-2.5 flex items-center gap-3">
                <div className="font-display font-bold text-blue text-sm tabular w-14 shrink-0">
                  {formatDateTime(p.dateProgrammee).split(" ")[1]}
                </div>
                <TypeInterventionPill type={p.type} />
                <div className="text-sm flex-1 min-w-0">
                  <span className="font-semibold">{p.numeroInterne}</span> — {p.raisonSociale}
                  <div className="text-xs text-ink-soft">{p.technicien ?? "Non affecté"}</div>
                </div>
                <StatutInterventionPill statut={p.statut} />
              </div>
            ))}
            {planning.length === 0 && (
              <p className="text-sm text-ink-soft py-2">Rien de planifié aujourd&apos;hui.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatTile({ label, value, href }: { label: string; value: number; href?: string }) {
  const content = (
    <Card className="p-5 h-full">
      <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">{label}</div>
      <div className="font-display text-3xl font-extrabold tabular">{value}</div>
    </Card>
  );
  return href ? (
    <Link href={href} className="block hover:shadow-md transition-shadow rounded-2xl">
      {content}
    </Link>
  ) : (
    content
  );
}
