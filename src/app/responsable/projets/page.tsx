import { db } from "@/db";
import { clients, garanties, interventions, projetAppareils, projets, projetTechniciens } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { Plus, Search, ShieldCheck, ArrowUpDown, HardHat, CalendarDays } from "lucide-react";
import { formatDate } from "@/lib/format";

const STATUT: Record<string, { label: string; cls: string }> = {
  cree: { label: "Créé", cls: "bg-[#eef2f6] text-ink-soft" },
  planifie: { label: "Planifié", cls: "bg-blue-pale text-blue" },
  en_cours: { label: "En cours", cls: "bg-orange-fill text-orange-ink" },
  termine: { label: "Terminé", cls: "bg-green-fill text-green-ink" },
  valide_iso: { label: "Validé ISO", cls: "bg-green-fill text-green-ink" },
};
const TYPE: Record<string, string> = { installation: "Installation", maintenance: "Maintenance", modernisation: "Modernisation", reparation: "Réparation" };
const FILTRES = [
  ["actifs", "En cours"],
  ["tous", "Tous"],
  ["termines", "Terminés"],
] as const;

export default async function ProjetsPage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  await requireUser(ROLES_BUREAU);
  const { q = "", f = "actifs" } = await searchParams;

  const rows = await db
    .select({
      id: projets.id,
      reference: projets.reference,
      titre: projets.titre,
      statut: projets.statut,
      typeProjet: projets.typeProjet,
      dateDebut: projets.dateDebutPrevue,
      dateFin: projets.dateFinPrevue,
      clientNom: clients.raisonSociale,
      aGarantie: sql<boolean>`exists(select 1 from ${garanties} where ${garanties.projetId} = ${projets.id})`,
      nbAppareils: sql<number>`(select count(*)::int from ${projetAppareils} where ${projetAppareils.projetId} = ${projets.id})`,
      nbTech: sql<number>`(select count(*)::int from ${projetTechniciens} where ${projetTechniciens.projetId} = ${projets.id})`,
      nbMissions: sql<number>`(select count(*)::int from ${interventions} where ${interventions.projetId} = ${projets.id} and ${interventions.statut} not in ('terminee','validee','cloturee'))`,
      nbRetard: sql<number>`(select count(*)::int from ${interventions} where ${interventions.projetId} = ${projets.id} and ${interventions.statut} not in ('terminee','validee','cloturee') and ${interventions.dateProgrammee} < now())`,
    })
    .from(projets)
    .innerJoin(clients, eq(projets.clientId, clients.id))
    .orderBy(desc(projets.createdAt));

  const qn = q.trim().toLowerCase();
  const filtres = rows.filter((p) => {
    const fini = p.statut === "termine" || p.statut === "valide_iso";
    if (f === "actifs" && fini) return false;
    if (f === "termines" && !fini) return false;
    return !qn || `${p.reference} ${p.titre} ${p.clientNom}`.toLowerCase().includes(qn);
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-extrabold font-display text-[#0b2545]">Projets</h1>
          <p className="text-sm text-ink-soft">{rows.length} projet(s) — chaque projet réunit client, appareils, équipe, garantie, prestations et missions.</p>
        </div>
        <Link href="/responsable/projets/nouveau" className="inline-flex items-center gap-2 rounded-xl bg-blue hover:bg-blue-light text-white px-5 py-3 text-sm font-bold shadow-sm">
          <Plus className="w-4 h-4" /> Nouveau projet
        </Link>
      </div>

      <form className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 rounded-xl border border-[#cfd8e3] bg-white px-3.5 py-2.5 w-full max-w-md">
          <Search className="w-4 h-4 text-ink-soft" />
          <input name="q" defaultValue={q} placeholder="Référence, nom, client…" className="flex-1 bg-transparent text-[15px] focus:outline-none" />
          <input type="hidden" name="f" value={f} />
        </div>
        <div className="flex gap-1.5">
          {FILTRES.map(([id, label]) => (
            <Link
              key={id}
              href={`/responsable/projets?f=${id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`rounded-full px-4 py-2 text-[13px] font-semibold border ${f === id ? "bg-blue border-blue text-white" : "bg-white border-line text-ink hover:border-[#b9c6d6]"}`}
            >
              {label}
            </Link>
          ))}
        </div>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
        {filtres.map((p) => {
          const st = STATUT[p.statut] ?? STATUT.cree;
          return (
            <Link
              key={p.id}
              href={`/responsable/projets/${p.id}`}
              className="group bg-white border border-line rounded-2xl p-5 flex flex-col gap-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-blue/50 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-ink-soft font-semibold">{p.reference}{p.typeProjet ? ` · ${TYPE[p.typeProjet] ?? p.typeProjet}` : ""}</div>
                  <div className="font-display font-bold text-[16.5px] leading-snug text-[#0b2545] group-hover:text-blue truncate">{p.titre}</div>
                  <div className="text-[13px] text-ink-soft truncate">{p.clientNom}</div>
                </div>
                <span className={`shrink-0 text-xs font-bold rounded-full px-2.5 py-1 ${st.cls}`}>{st.label}</span>
              </div>
              <div className="flex items-center gap-4 text-[13px] text-ink-soft flex-wrap">
                <span className="inline-flex items-center gap-1.5"><ArrowUpDown className="w-3.5 h-3.5" />{p.nbAppareils}</span>
                <span className="inline-flex items-center gap-1.5"><HardHat className="w-3.5 h-3.5" />{p.nbTech}</span>
                <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" />{p.nbMissions} mission(s)</span>
                {p.aGarantie && <span className="inline-flex items-center gap-1.5 text-green-ink"><ShieldCheck className="w-3.5 h-3.5" />Garantie</span>}
                {p.nbRetard > 0 && <span className="text-xs font-bold rounded-full px-2 py-0.5 bg-red-fill text-red-ink">{p.nbRetard} en retard</span>}
              </div>
              {(p.dateDebut || p.dateFin) && (
                <div className="text-xs text-ink-soft">{formatDate(p.dateDebut)} → {formatDate(p.dateFin)}</div>
              )}
            </Link>
          );
        })}
        {filtres.length === 0 && (
          <div className="col-span-full bg-white border border-dashed border-[#cfd8e3] rounded-2xl p-10 text-center text-ink-soft">
            Aucun projet ici. <Link href="/responsable/projets/nouveau" className="text-blue font-semibold">Créer un projet</Link>
          </div>
        )}
      </div>
    </div>
  );
}
