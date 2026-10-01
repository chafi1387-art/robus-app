import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import { db } from "@/db";
import { appareils, demandesClient } from "@/db/schema";
import { Pill } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireObservateur } from "@/lib/observateur";
import { STATUTS_DEMANDE, TYPES_DEMANDE } from "@/lib/demandes";

// Phase 20 : les demandes de l'observateur (pannes, interventions, questions, documents).
export default async function MesDemandesPage() {
  const ctx = await requireObservateur();
  const rows = await db
    .select({ d: demandesClient, appareil: appareils.numeroInterne })
    .from(demandesClient)
    .innerJoin(appareils, eq(demandesClient.appareilId, appareils.id))
    .where(eq(demandesClient.auteurId, ctx.userId))
    .orderBy(desc(demandesClient.createdAt))
    .limit(100);
  const ouvertes = rows.filter((r) => !["resolue", "cloturee"].includes(r.d.statut));
  const fermees = rows.filter((r) => ["resolue", "cloturee"].includes(r.d.statut));
  const Carte = ({ r }: { r: (typeof rows)[number] }) => (
    <Link href={`/observateur/demandes/${r.d.id}`} className="bg-surface border border-line rounded-2xl p-4 flex flex-col gap-1.5 active:bg-blue-pale">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display font-bold text-[15px]">{TYPES_DEMANDE[r.d.type]?.icone} {TYPES_DEMANDE[r.d.type]?.label}</span>
        <Pill tone={STATUTS_DEMANDE[r.d.statut]?.tone ?? "neutral"}>{STATUTS_DEMANDE[r.d.statut]?.label}</Pill>
      </div>
      <div className="text-[13px] text-ink-soft truncate">{r.d.numero} · Ascenseur {r.appareil} · {formatDateTime(r.d.createdAt)}</div>
      <div className="text-[13px] truncate">{r.d.description}</div>
    </Link>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display font-extrabold text-[21px]">Mes demandes</h1>
        <Link href="/observateur/demandes/nouvelle" className="inline-flex items-center gap-1.5 rounded-xl bg-blue text-white font-bold text-sm px-3.5 py-2.5">
          <Plus className="w-4 h-4" /> Nouvelle
        </Link>
      </div>
      {ouvertes.length > 0 && <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft -mb-2">En cours ({ouvertes.length})</h2>}
      {ouvertes.map((r) => <Carte key={r.d.id} r={r} />)}
      {fermees.length > 0 && <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft -mb-2 mt-2">Terminées</h2>}
      {fermees.map((r) => <Carte key={r.d.id} r={r} />)}
      {rows.length === 0 && (
        <p className="text-sm text-ink-soft">Aucune demande pour l&apos;instant. Une panne, une question, un document à demander ? Appuyez sur « Nouvelle ».</p>
      )}
    </div>
  );
}
