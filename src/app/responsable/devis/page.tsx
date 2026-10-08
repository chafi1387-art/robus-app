import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Card, Pill, Btn, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { appareils, clients, devis, sites } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { STATUTS_DEVIS, montant } from "@/lib/devis";
import { createDevis } from "./actions";

// Phase 25b : liste des devis (missions et clients) — un clic ouvre le devis.
const FILTRES: Record<string, { label: string; statuts: string[] | null }> = {
  ouverts: { label: "À traiter", statuts: ["a_preparer", "brouillon", "envoye", "accepte"] },
  tous: { label: "Tous", statuts: null },
};

export default async function DevisPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await requireUser(ROLES_BUREAU);
  const sp = await searchParams;
  const filtre = FILTRES[sp.f ?? ""] ? (sp.f as string) : "ouverts";
  const statuts = FILTRES[filtre].statuts;
  const [rows, listeClients, compteurs] = await Promise.all([
    db
      .select({
        id: devis.id,
        numero: devis.numero,
        statut: devis.statut,
        titre: devis.titre,
        montantHt: devis.montantHt,
        description: devis.description,
        createdAt: devis.createdAt,
        dateEnvoi: devis.dateEnvoi,
        interventionId: devis.interventionId,
        travauxPlanifiesLe: devis.travauxPlanifiesLe,
        raisonSociale: clients.raisonSociale,
        siteAdresse: sites.adresse,
        appareil: appareils.numeroInterne,
      })
      .from(devis)
      .innerJoin(clients, eq(devis.clientId, clients.id))
      .leftJoin(sites, eq(devis.siteId, sites.id))
      .leftJoin(appareils, eq(devis.appareilId, appareils.id))
      .where(statuts ? sql`${devis.statut}::text in (${sql.join(statuts.map((s) => sql`${s}`), sql`, `)})` : undefined)
      .orderBy(desc(devis.createdAt))
      .limit(300),
    db.select({ id: clients.id, raisonSociale: clients.raisonSociale }).from(clients).orderBy(clients.raisonSociale),
    db.select({ statut: devis.statut, n: sql<number>`count(*)::int` }).from(devis).groupBy(devis.statut),
  ]);
  const nb = (s: string) => compteurs.find((c) => c.statut === s)?.n ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold font-display">Devis</h1>
          <p className="text-sm text-ink-soft">Montants hors taxes — la facturation se fait dans Odoo.</p>
        </div>
        <div className="flex gap-2">
          {Object.entries(FILTRES).map(([k, f]) => (
            <Link key={k} href={`/responsable/devis?f=${k}`} className={`text-sm font-bold rounded-lg px-3 py-1.5 border ${filtre === k ? "bg-navy text-white border-navy" : "border-line hover:bg-blue-pale"}`}>
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["a_preparer", "À préparer", "warn"],
          ["envoye", "En attente du client", "warn"],
          ["accepte", "Acceptés", "ok"],
          ["refuse", "Refusés", "crit"],
        ].map(([s, l]) => (
          <Card key={s} className="p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{l}</div>
            <div className="font-display font-extrabold text-2xl text-navy">{nb(s)}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="pb-2 pr-3">Numéro</th>
                  <th className="pb-2 pr-3">Client / ascenseur</th>
                  <th className="pb-2 pr-3">Montant HT</th>
                  <th className="pb-2 pr-3">Statut</th>
                  <th className="pb-2 pr-3">Créé le</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const st = STATUTS_DEVIS[d.statut] ?? { label: d.statut, ton: "neutral" as const };
                  return (
                    <tr key={d.id} className="border-b border-line last:border-0 align-top hover:bg-blue-pale/30">
                      <td className="py-2.5 pr-3 font-semibold whitespace-nowrap">
                        <Link href={`/responsable/devis/${d.id}`} className="text-blue hover:underline">{d.numero}</Link>
                        {d.interventionId && <div className="text-[11px] text-ink-soft font-normal">Lié à une mission</div>}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div>{d.raisonSociale}</div>
                        <div className="text-xs text-ink-soft">{[d.appareil ? `Ascenseur ${d.appareil}` : null, d.titre ?? d.description, d.siteAdresse].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap tabular-nums">{d.montantHt !== null ? montant(Number(d.montantHt)) : "—"}</td>
                      <td className="py-2.5 pr-3">
                        <Pill tone={st.ton}>{d.statut === "accepte" && d.travauxPlanifiesLe ? "Accepté — travaux planifiés" : d.statut === "accepte" ? "Accepté — travaux à planifier" : st.label}</Pill>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-ink-soft">{formatDate(d.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="text-sm text-ink-soft py-3">Aucun devis {filtre === "ouverts" ? "à traiter" : ""} pour l&apos;instant.</p>}
          </div>
        </Card>

        <Card className="p-5 self-start">
          <h2 className="font-display font-bold text-sm mb-1">Nouveau devis (hors mission)</h2>
          <p className="text-xs text-ink-soft mb-3">Pour un devis lié à une intervention, ouvrez la mission → « Devis ».</p>
          <form action={createDevis} className="flex flex-col gap-3">
            <Field label="Client">
              <select name="clientId" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Choisir un client...
                </option>
                {listeClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.raisonSociale}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Objet">
              <input name="description" maxLength={200} className={inputClass} placeholder="Ex. Modernisation de la cabine" />
            </Field>
            <Btn enCours="Création…">Créer et compléter le devis</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
