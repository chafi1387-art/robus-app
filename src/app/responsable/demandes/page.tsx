import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Inbox } from "lucide-react";
import { db } from "@/db";
import { appareils, clients, demandesClient } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { Card, Pill } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { STATUTS_DEMANDE, STATUTS_OUVERTS, TYPES_DEMANDE, delais, echeancePriseEnCharge, statsDemandes } from "@/lib/demandes";

// Phase 20 : toutes les demandes client (pannes, interventions, questions, documents).
export default async function DemandesPage({ searchParams }: { searchParams: Promise<{ vue?: string; type?: string }> }) {
  await requireUser(ROLES_BUREAU);
  const { vue = "ouvertes", type } = await searchParams;
  const typeValide = type && type in TYPES_DEMANDE ? type : null;
  const [rows, stats, dl] = await Promise.all([
    db
      .select({ d: demandesClient, appareil: appareils.numeroInterne, client: clients.raisonSociale })
      .from(demandesClient)
      .innerJoin(appareils, eq(demandesClient.appareilId, appareils.id))
      .leftJoin(clients, eq(demandesClient.clientId, clients.id))
      .where(
        and(
          vue === "toutes" ? undefined : inArray(demandesClient.statut, [...STATUTS_OUVERTS]),
          typeValide ? eq(demandesClient.type, typeValide) : undefined
        )
      )
      .orderBy(desc(demandesClient.createdAt))
      .limit(300),
    statsDemandes(),
    delais(),
  ]);
  // eslint-disable-next-line react-hooks/purity
  const maintenant = Date.now();
  const ordre = (s: string) => (s === "nouvelle" ? 0 : s === "prise_en_charge" ? 1 : s === "planifiee" ? 2 : 3);
  rows.sort((a, b) => ordre(a.d.statut) - ordre(b.d.statut) || (b.d.personneBloquee - a.d.personneBloquee) || b.d.createdAt.getTime() - a.d.createdAt.getTime());
  const lien = (v: string, t: string | null) => `/responsable/demandes?vue=${v}${t ? `&type=${t}` : ""}`;
  const puce = (on: boolean) => `px-3 py-1.5 rounded-lg text-sm font-semibold ${on ? "bg-navy text-white" : "border border-line text-ink-soft hover:bg-blue-pale"}`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold font-display flex items-center gap-2"><Inbox className="w-6 h-6 text-blue" /> Demandes clients</h1>
        <p className="text-sm text-ink-soft">Pannes, demandes d&apos;intervention, questions / réclamations et demandes de documents envoyées par vos clients.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tuile label="Ouvertes" valeur={String(stats.ouvertes)} />
        <Tuile label="À prendre en charge" valeur={String(stats.nouvelles)} rouge={stats.nouvelles > 0} />
        <Tuile label="Délai dépassé" valeur={String(stats.enRetard)} rouge={stats.enRetard > 0} />
        <Tuile label="Prise en charge moyenne (30 j)" valeur={stats.delaiMoyenMinutes == null ? "—" : stats.delaiMoyenMinutes < 60 ? `${stats.delaiMoyenMinutes} min` : `${(stats.delaiMoyenMinutes / 60).toFixed(1)} h`} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={lien("ouvertes", typeValide)} className={puce(vue !== "toutes")}>Ouvertes</Link>
        <Link href={lien("toutes", typeValide)} className={puce(vue === "toutes")}>Toutes</Link>
        <span className="w-px bg-line mx-1" />
        <Link href={lien(vue, null)} className={puce(!typeValide)}>Tous types</Link>
        {Object.entries(TYPES_DEMANDE).map(([k, t]) => (
          <Link key={k} href={lien(vue, k)} className={puce(typeValide === k)}>{t.icone} {t.label}</Link>
        ))}
      </div>
      <Card className="p-0 overflow-hidden">
        <div className="divide-y divide-line">
          {rows.map(({ d, appareil, client }) => {
            const s = STATUTS_DEMANDE[d.statut];
            const ech = echeancePriseEnCharge(d, dl);
            const retard = d.statut === "nouvelle" && ech.getTime() < maintenant;
            return (
              <Link key={d.id} href={`/responsable/demandes/${d.id}`} className={`flex items-center gap-3 px-4 py-3 hover:bg-blue-pale/40 flex-wrap ${d.personneBloquee && d.statut === "nouvelle" ? "bg-red-fill/40" : ""}`}>
                <span className="text-xl">{TYPES_DEMANDE[d.type]?.icone}</span>
                <span className="flex-1 min-w-[220px]">
                  <span className="font-semibold">{d.numero}</span> · {TYPES_DEMANDE[d.type]?.label} · <span className="font-semibold">{appareil}</span>
                  {client ? <span className="text-ink-soft"> · {client}</span> : null}
                  <span className="block text-xs text-ink-soft truncate">{d.nom ?? "Client"} — {d.description}</span>
                </span>
                <span className="text-xs text-ink-soft whitespace-nowrap">{formatDateTime(d.createdAt)}</span>
                {d.personneBloquee === 1 && <Pill tone="crit">Personne bloquée</Pill>}
                {retard && <Pill tone="crit">Délai dépassé</Pill>}
                <Pill tone={s.tone}>{s.label}</Pill>
              </Link>
            );
          })}
          {rows.length === 0 && <p className="text-sm text-ink-soft p-5">Aucune demande {vue === "toutes" ? "" : "ouverte"}.</p>}
        </div>
      </Card>
    </div>
  );
}

function Tuile({ label, valeur, rouge = false }: { label: string; valeur: string; rouge?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</div>
      <div className={`font-display text-2xl font-extrabold tabular ${rouge ? "text-red-ink" : ""}`}>{valeur}</div>
    </Card>
  );
}
