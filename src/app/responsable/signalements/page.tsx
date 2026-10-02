import Link from "next/link";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { Download, TriangleAlert } from "lucide-react";
import { db } from "@/db";
import { appareils, signalements, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { Card, inputClass } from "@/components/ui";
import { ListeSignalements } from "@/components/liste-signalements";
import { TYPES_SIGNALEMENT } from "@/lib/signalements-types";
import { statsSecurite } from "@/lib/signalements-stats";

// Phase 21 : tous les signalements des techniciens — filtres, indicateurs
// sécurité (jours sans accident), export pour l'audit.
export default async function SignalementsPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string; type?: string; technicien?: string }>;
}) {
  await requireUser(ROLES_BUREAU);
  const sp = await searchParams;
  const vue = ["ouverts", "clotures", "tous"].includes(sp.vue ?? "") ? sp.vue! : "ouverts";
  const type = sp.type && TYPES_SIGNALEMENT[sp.type] ? sp.type : "";
  const technicien = sp.technicien && /^[0-9a-f-]{36}$/i.test(sp.technicien) ? sp.technicien : "";
  const conds: SQL[] = [];
  if (vue === "ouverts") conds.push(inArray(signalements.statut, ["nouveau", "pris_en_charge"]));
  if (vue === "clotures") conds.push(eq(signalements.statut, "cloture"));
  if (type) conds.push(eq(signalements.type, type));
  if (technicien) conds.push(eq(signalements.technicienId, technicien));

  const [lignes, techs, stats] = await Promise.all([
    db
      .select({
        id: signalements.id,
        numero: signalements.numero,
        type: signalements.type,
        gravite: signalements.gravite,
        statut: signalements.statut,
        description: signalements.description,
        blesse: signalements.blesse,
        bloquant: signalements.bloquant,
        createdAt: signalements.createdAt,
        technicien: users.nom,
        appareil: appareils.numeroInterne,
      })
      .from(signalements)
      .innerJoin(users, eq(signalements.technicienId, users.id))
      .leftJoin(appareils, eq(signalements.appareilId, appareils.id))
      .where(conds.length ? and(...conds) : undefined)
      // Nouveaux et graves d'abord.
      .orderBy(
        sql`case ${signalements.statut} when 'nouveau' then 0 when 'pris_en_charge' then 1 else 2 end`,
        sql`case ${signalements.gravite} when 'critique' then 0 when 'elevee' then 1 else 2 end`,
        desc(signalements.createdAt)
      )
      .limit(300),
    db.select({ id: users.id, nom: users.nom }).from(users).where(eq(users.role, "technicien")).orderBy(users.nom),
    statsSecurite(),
  ]);
  const qs = (v: string) => {
    const p = new URLSearchParams({ vue: v });
    if (type) p.set("type", type);
    if (technicien) p.set("technicien", technicien);
    return p.toString();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold font-display flex items-center gap-2">
            <TriangleAlert className="w-6 h-6 text-red-ink" /> Signalements des techniciens
          </h1>
          <p className="text-sm text-ink-soft">Accidents, véhicules, météo, matériel, accès… — traçabilité sécurité et ISO 9001.</p>
        </div>
        <a href={`/api/export/signalements?${qs(vue)}`} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold border border-line hover:bg-blue-pale">
          <Download className="w-4 h-4" /> Export CSV (audit)
        </a>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Indicateur label="À prendre en charge" valeur={stats.nouveaux} alerte={stats.nouveaux > 0} />
        <Indicateur label="En cours de traitement" valeur={stats.enCours} />
        <Indicateur label="Jours sans accident" valeur={stats.joursSansAccident ?? "—"} />
        <Indicateur label={`Accidents ${new Date().getFullYear()} (dont presque)`} valeur={`${stats.accidentsAnnee} (${stats.presqueAnnee})`} />
      </div>

      <Card className="p-4 flex flex-col gap-3">
        <div className="flex gap-1 flex-wrap">
          {[
            ["ouverts", "Ouverts"],
            ["clotures", "Clôturés"],
            ["tous", "Tous"],
          ].map(([k, l]) => (
            <Link key={k} href={`/responsable/signalements?${qs(k)}`} className={`text-xs font-bold px-3 py-1.5 rounded-full border ${vue === k ? "bg-blue text-white border-blue" : "border-line text-ink-soft hover:bg-blue-pale"}`}>
              {l}
            </Link>
          ))}
        </div>
        <form className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="vue" value={vue} />
          <label className="flex flex-col gap-1 min-w-48">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Type</span>
            <select name="type" defaultValue={type} className={inputClass}>
              <option value="">Tous les types</option>
              {Object.entries(TYPES_SIGNALEMENT).map(([k, t]) => (
                <option key={k} value={k}>{t.icone} {t.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-48">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Technicien</span>
            <select name="technicien" defaultValue={technicien} className={inputClass}>
              <option value="">Tous</option>
              {techs.map((t) => (
                <option key={t.id} value={t.id}>{t.nom}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-lg px-4 py-2 text-sm font-bold bg-blue text-white">Filtrer</button>
        </form>
      </Card>

      <Card className="p-5">
        <ListeSignalements lignes={lignes} vide={vue === "ouverts" ? "Aucun signalement ouvert." : "Aucun signalement."} />
      </Card>
    </div>
  );
}

function Indicateur({ label, valeur, alerte = false }: { label: string; valeur: number | string; alerte?: boolean }) {
  return (
    <Card className={`p-4 ${alerte ? "border-red/50 border-[1.5px]" : ""}`}>
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`font-display text-2xl font-extrabold tabular ${alerte ? "text-red-ink" : ""}`}>{valeur}</div>
    </Card>
  );
}
