import { Card, TypeInterventionPill, StatutInterventionPill } from "@/components/ui";
import { db } from "@/db";
import { appareils, clients, interventions, projets } from "@/db/schema";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import Link from "next/link";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { formatDate, formatDateTime } from "@/lib/format";

// Phase 6 : l'Appareil n'est plus rattaché à un Site — l'adresse et le
// client d'une intervention se dérivent désormais du Projet. On passe donc
// par des LEFT JOIN (une intervention sans Projet reste affichée).
function baseQuery() {
  return db
    .select({
      id: interventions.id,
      type: interventions.type,
      statut: interventions.statut,
      description: interventions.description,
      dateProgrammee: interventions.dateProgrammee,
      numeroInterne: appareils.numeroInterne,
      projetReference: projets.reference,
      adresse: projets.adresse,
      raisonSociale: clients.raisonSociale,
    })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .leftJoin(clients, eq(projets.clientId, clients.id));
}

type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>["where"]>>[number];

const VUES = ["jour", "semaine", "mois"] as const;
type Vue = (typeof VUES)[number];
const VUE_LABEL: Record<Vue, string> = { jour: "Jour", semaine: "Semaine", mois: "Mois" };

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}
// Lundi comme premier jour de semaine.
function startOfWeek(d: Date) {
  const day = d.getDay(); // 0 = dimanche
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function toDateParam(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayKey(d: Date) {
  return toDateParam(d);
}

export default async function MesInterventionsPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string; date?: string }>;
}) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const { vue: vueParam, date: dateParam } = await searchParams;
  const vue: Vue = (VUES as readonly string[]).includes(vueParam ?? "") ? (vueParam as Vue) : "jour";

  const aujourdhui = startOfDay(new Date());
  // Phase 10 : le technicien ne peut pas consulter son planning plus d'un
  // mois avant aujourd'hui.
  const limiteArriere = addMonths(aujourdhui, -1);

  let refDate = startOfDay(new Date());
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const parsed = new Date(`${dateParam}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) refDate = parsed;
  }
  if (refDate < limiteArriere) refDate = limiteArriere;

  // Bornes de la période affichée selon la vue.
  let periodeDebut: Date;
  let periodeFin: Date;
  if (vue === "jour") {
    periodeDebut = refDate;
    periodeFin = addDays(refDate, 1);
  } else if (vue === "semaine") {
    periodeDebut = startOfWeek(refDate);
    periodeFin = addDays(periodeDebut, 7);
  } else {
    periodeDebut = startOfMonth(refDate);
    periodeFin = startOfMonth(addMonths(refDate, 1));
  }

  // Navigation précédent/suivant, par unité de la vue active.
  const decalage = vue === "jour" ? (d: Date, n: number) => addDays(d, n) : vue === "semaine" ? (d: Date, n: number) => addDays(d, n * 7) : (d: Date, n: number) => addMonths(d, n);
  const datePrecedent = decalage(refDate, -1);
  const dateSuivant = decalage(refDate, 1);
  const precedentBloque = datePrecedent < limiteArriere;

  function hrefVue(v: Vue, d: Date) {
    return `/technicien?vue=${v}&date=${toDateParam(d)}`;
  }

  const [enRetard, periode, ajourdhuiCount] = await Promise.all([
    // "En retard" : seulement ce qui attend encore une action du technicien
    // (pas déjà terminé/validé/clôturé) — sinon une mission déjà bouclée
    // remonterait à tort comme "en retard".
    baseQuery()
      .where(
        and(
          eq(interventions.technicienId, user.id),
          lt(interventions.dateProgrammee, aujourdhui),
          sql`${interventions.statut} not in ('terminee', 'validee', 'cloturee')`
        )
      )
      .orderBy(asc(interventions.dateProgrammee)),
    baseQuery()
      .where(
        and(
          eq(interventions.technicienId, user.id),
          gte(interventions.dateProgrammee, periodeDebut),
          lt(interventions.dateProgrammee, periodeFin)
        )
      )
      .orderBy(asc(interventions.dateProgrammee)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(interventions)
      .where(
        and(
          eq(interventions.technicienId, user.id),
          gte(interventions.dateProgrammee, aujourdhui),
          lt(interventions.dateProgrammee, addDays(aujourdhui, 1)),
          sql`${interventions.statut} not in ('cloturee')`
        )
      )
      .then((r) => Number(r[0]?.n ?? 0)),
  ]);

  // Regroupement par jour pour les vues Semaine / Mois.
  const parJour = new Map<string, Row[]>();
  for (const r of periode) {
    if (!r.dateProgrammee) continue;
    const key = dayKey(r.dateProgrammee);
    const liste = parJour.get(key) ?? [];
    liste.push(r);
    parJour.set(key, liste);
  }
  const jours: { date: Date; rows: Row[] }[] = [];
  if (vue === "jour") {
    jours.push({ date: refDate, rows: periode });
  } else {
    const nbJours = vue === "semaine" ? 7 : Math.round((periodeFin.getTime() - periodeDebut.getTime()) / 86400000);
    for (let i = 0; i < nbJours; i++) {
      const d = addDays(periodeDebut, i);
      const rows = parJour.get(dayKey(d)) ?? [];
      if (rows.length > 0) jours.push({ date: d, rows });
    }
  }

  const titrePeriode =
    vue === "jour"
      ? formatDate(refDate)
      : vue === "semaine"
        ? `Semaine du ${formatDate(periodeDebut)} au ${formatDate(addDays(periodeFin, -1))}`
        : refDate.toLocaleDateString("fr-BE", { month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-extrabold font-display">Mes interventions</h1>
        <p className="text-sm text-ink-soft">
          Aujourd&apos;hui : {ajourdhuiCount}
          {enRetard.length > 0 ? ` · En retard : ${enRetard.length}` : ""}
        </p>
      </div>

      {enRetard.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide text-red-ink mb-2">
            ⚠️ En retard ({enRetard.length})
          </h2>
          <div className="flex flex-col gap-3">
            {enRetard.map((i) => (
              <InterventionCard key={i.id} i={i} />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2">
          {VUES.map((v) => (
            <Link
              key={v}
              href={hrefVue(v, refDate)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                vue === v ? "bg-blue text-white" : "bg-blue-pale text-blue"
              }`}
            >
              {VUE_LABEL[v]}
            </Link>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 mb-3">
          {precedentBloque ? (
            <span className="text-xs font-semibold text-ink-soft/50 px-2 py-1">◀ Précédent</span>
          ) : (
            <Link href={hrefVue(vue, datePrecedent)} className="text-xs font-bold text-blue px-2 py-1">
              ◀ Précédent
            </Link>
          )}
          <div className="text-sm font-semibold text-center capitalize">{titrePeriode}</div>
          <Link href={hrefVue(vue, aujourdhui)} className="text-xs font-bold text-blue px-2 py-1">
            Aujourd&apos;hui
          </Link>
          <Link href={hrefVue(vue, dateSuivant)} className="text-xs font-bold text-blue px-2 py-1">
            Suivant ▶
          </Link>
        </div>

        {vue === "jour" ? (
          <Section rows={periode} empty="Rien de prévu ce jour-là." />
        ) : (
          <div className="flex flex-col gap-4">
            {jours.map(({ date, rows }) => (
              <div key={dayKey(date)}>
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1.5">
                  {formatDate(date)}
                </h3>
                <Section rows={rows} empty="" />
              </div>
            ))}
            {jours.length === 0 && <p className="text-sm text-ink-soft">Rien de prévu sur cette période.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ rows, empty }: { rows: Row[]; empty: string }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((i) => (
        <InterventionCard key={i.id} i={i} />
      ))}
      {rows.length === 0 && empty && <p className="text-sm text-ink-soft">{empty}</p>}
    </div>
  );
}

function InterventionCard({ i }: { i: Row }) {
  return (
    <Link href={`/technicien/interventions/${i.id}`}>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <TypeInterventionPill type={i.type} />
          <span className="text-xs font-bold text-blue tabular">
            {formatDateTime(i.dateProgrammee).split(" ")[1]}
          </span>
        </div>
        <div className="font-display font-bold text-sm">{i.numeroInterne}</div>
        <div className="text-xs text-ink-soft">
          {i.raisonSociale && i.adresse ? `${i.raisonSociale} — ${i.adresse}` : "Projet non renseigné"}
        </div>
        {i.description && <div className="text-xs text-ink-soft mt-1">{i.description}</div>}
        <div className="mt-2">
          <StatutInterventionPill statut={i.statut} />
        </div>
      </Card>
    </Link>
  );
}
