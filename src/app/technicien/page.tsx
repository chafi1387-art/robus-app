import { TypeInterventionPill, StatutInterventionPill } from "@/components/ui";
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

  const prenom = (user.name ?? "").split(" ")[0];
  const libelleJour = new Date().toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-4 -mt-4 px-5 pt-5 pb-5 bg-navy text-white rounded-b-3xl flex flex-col gap-4">
        <div>
          <div className="text-[12.5px] text-[#9fd3ee] capitalize">{libelleJour}</div>
          <h1 className="font-display font-extrabold text-[21px]">Bonjour {prenom}</h1>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white/10 px-3 py-2.5">
            <div className="text-[11px] text-[#cfe3f5]">Aujourd&apos;hui</div>
            <div className="font-display text-[21px] font-extrabold tabular">{ajourdhuiCount}</div>
          </div>
          <div className={`rounded-xl px-3 py-2.5 ${enRetard.length > 0 ? "bg-red-fill text-red-ink" : "bg-white/10"}`}>
            <div className={`text-[11px] ${enRetard.length > 0 ? "" : "text-[#cfe3f5]"}`}>En retard</div>
            <div className="font-display text-[21px] font-extrabold tabular">{enRetard.length}</div>
          </div>
          <div className="rounded-xl bg-white/10 px-3 py-2.5">
            <div className="text-[11px] text-[#cfe3f5]">{vue === "jour" ? "Ce jour" : vue === "semaine" ? "Cette semaine" : "Ce mois"}</div>
            <div className="font-display text-[21px] font-extrabold tabular">{periode.length}</div>
          </div>
        </div>
      </div>

      {enRetard.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide text-red-ink mb-2">En retard ({enRetard.length})</h2>
          <div className="flex flex-col gap-3">
            {enRetard.map((i) => (
              <InterventionCard key={i.id} i={i} retard />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex rounded-xl bg-[#e9eef4] p-1 mb-3">
          {VUES.map((v) => (
            <Link
              key={v}
              href={hrefVue(v, refDate)}
              className={`flex-1 text-center text-[13px] font-semibold py-2 rounded-lg ${vue === v ? "bg-white text-navy shadow-sm" : "text-ink-soft"}`}
            >
              {VUE_LABEL[v]}
            </Link>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 mb-3">
          {precedentBloque ? (
            <span className="text-[13px] font-semibold text-ink-soft/50 px-2 py-2">‹ Préc.</span>
          ) : (
            <Link href={hrefVue(vue, datePrecedent)} className="text-[13px] font-bold text-blue px-2 py-2">
              ‹ Préc.
            </Link>
          )}
          <div className="text-sm font-semibold text-center capitalize">{titrePeriode}</div>
          <Link href={hrefVue(vue, aujourdhui)} className="text-[13px] font-bold text-blue px-2 py-2">
            Auj.
          </Link>
          <Link href={hrefVue(vue, dateSuivant)} className="text-[13px] font-bold text-blue px-2 py-2">
            Suiv. ›
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

function InterventionCard({ i, retard = false }: { i: Row; retard?: boolean }) {
  const heure = formatDateTime(i.dateProgrammee).split(" ")[1] ?? "—";
  const itineraire = i.adresse ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(i.adresse)}` : null;
  const action = i.statut === "en_cours" ? "Continuer le rapport" : ["terminee", "validee", "cloturee"].includes(i.statut) ? "Voir la mission" : "Ouvrir la mission";
  return (
    <div className={`bg-surface rounded-2xl p-4 flex flex-col gap-2 shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${retard ? "border-[1.5px] border-[#f3b8b0]" : "border border-line"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`font-display font-extrabold text-[17px] tabular ${retard ? "text-red-ink" : "text-navy"}`}>
          {retard ? `${formatDate(i.dateProgrammee)} · ${heure}` : heure}
        </span>
        <StatutInterventionPill statut={i.statut} />
      </div>
      <div className="flex items-center gap-2">
        <TypeInterventionPill type={i.type} />
        <span className="font-display font-bold text-[15px]">{i.numeroInterne}</span>
      </div>
      <div className="text-[13px] text-ink-soft">
        {i.raisonSociale && i.adresse ? `${i.raisonSociale} — ${i.adresse}` : "Projet non renseigné"}
      </div>
      {i.description && <div className="text-[13px]">{i.description}</div>}
      <div className="flex gap-2 mt-1">
        <Link href={`/technicien/interventions/${i.id}`} className="flex-1 min-h-11 rounded-xl bg-blue text-white font-bold text-[14px] flex items-center justify-center">
          {action}
        </Link>
        {itineraire && (
          <a href={itineraire} target="_blank" rel="noreferrer" className="min-h-11 px-4 rounded-xl border border-[#cfd8e3] bg-white font-semibold text-[13.5px] flex items-center justify-center">
            Itinéraire
          </a>
        )}
      </div>
    </div>
  );
}
