import Link from "next/link";
import { Card, inputClass } from "@/components/ui";
import { HeuresSousTraitanceForm, MESSAGES_ERREUR, MESSAGES_OK } from "@/components/heures-sous-traitance-form";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { db } from "@/db";
import { clients, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  aujourdhuiBruxelles,
  formatDateJour,
  formatMinutes,
  libelleMois,
  minutesEnHeuresDecimales,
  moisDecale,
  moisOuCourant,
} from "@/lib/sous-traitance";
import { chargerHeures } from "./donnees";
import { modifierHeuresSousTraitance, supprimerHeuresSousTraitance } from "@/app/technicien/heures/actions";

const uuidOk = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

export default async function SousTraitancePage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string; client?: string; technicien?: string; ok?: string; erreur?: string }>;
}) {
  const user = await requireUser(ROLES_BUREAU);
  const params = await searchParams;
  const mois = moisOuCourant(params.mois);
  const clientId = uuidOk(params.client);
  const technicienId = uuidOk(params.technicien);
  const estAdmin = user.role === "administrateur";

  const [lignes, listeClients, listeTechniciens] = await Promise.all([
    chargerHeures({ mois, clientId, technicienId }),
    db
      .select({ id: clients.id, raisonSociale: clients.raisonSociale })
      .from(clients)
      .where(eq(clients.type, "sous_traitance"))
      .orderBy(clients.raisonSociale),
    db.select({ id: users.id, nom: users.nom }).from(users).where(eq(users.role, "technicien")).orderBy(users.nom),
  ]);

  const qs = (m: string) => {
    const p = new URLSearchParams({ mois: m });
    if (clientId) p.set("client", clientId);
    if (technicienId) p.set("technicien", technicienId);
    return p.toString();
  };
  const retour = `/responsable/sous-traitance?${qs(mois)}`;
  const total = lignes.reduce((s, l) => s + l.minutes, 0);

  // Récapitulatif par client puis par technicien
  const parClient = new Map<string, { client: string; minutes: number; parTech: Map<string, number> }>();
  for (const l of lignes) {
    const c = parClient.get(l.clientId) ?? { client: l.client, minutes: 0, parTech: new Map() };
    c.minutes += l.minutes;
    c.parTech.set(l.technicien, (c.parTech.get(l.technicien) ?? 0) + l.minutes);
    parClient.set(l.clientId, c);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold font-display">Sous-traitance</h1>
          <p className="text-sm text-ink-soft">Heures déclarées par les techniciens pour les clients en sous-traitance.</p>
        </div>
        <a
          href={`/api/export/sous-traitance?${qs(mois)}`}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold font-display border border-line hover:bg-blue-pale"
        >
          ⬇ Export CSV (Excel)
        </a>
      </div>

      {params.ok && MESSAGES_OK[params.ok] && (
        <div className="text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">✓ {MESSAGES_OK[params.ok]}</div>
      )}
      {params.erreur && (
        <div className="text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">⚠ {MESSAGES_ERREUR[params.erreur] ?? "Erreur."}</div>
      )}

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Mois</span>
            <input type="month" name="mois" defaultValue={mois} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 min-w-48">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Client</span>
            <select name="client" defaultValue={clientId ?? ""} className={inputClass}>
              <option value="">Tous les clients</option>
              {listeClients.map((c) => (
                <option key={c.id} value={c.id}>{c.raisonSociale}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-48">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Technicien</span>
            <select name="technicien" defaultValue={technicienId ?? ""} className={inputClass}>
              <option value="">Tous les techniciens</option>
              {listeTechniciens.map((t) => (
                <option key={t.id} value={t.id}>{t.nom}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-lg px-4 py-2 text-sm font-bold font-display bg-blue text-white hover:bg-blue-light">
            Filtrer
          </button>
        </form>
        <div className="flex items-center gap-4 mt-3 text-sm">
          <Link href={`/responsable/sous-traitance?${qs(moisDecale(mois, -1))}`} className="font-semibold text-blue">‹ Mois précédent</Link>
          <span className="font-display font-bold">{libelleMois(mois)}</span>
          <Link href={`/responsable/sous-traitance?${qs(moisDecale(mois, 1))}`} className="font-semibold text-blue">Mois suivant ›</Link>
          <Link href={`/responsable/sous-traitance?mois=${aujourdhuiBruxelles().slice(0, 7)}`} className="text-ink-soft ml-auto">Réinitialiser</Link>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs text-ink-soft">Total du mois</div>
          <div className="font-display text-3xl font-extrabold tabular">{formatMinutes(total)}</div>
          <div className="text-xs text-ink-soft mt-1">soit {minutesEnHeuresDecimales(total)} h · {lignes.length} saisie(s)</div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display font-bold text-sm mb-3">Récapitulatif à facturer</h2>
          {parClient.size === 0 && <p className="text-sm text-ink-soft">Aucune heure sur cette période.</p>}
          <div className="flex flex-col divide-y divide-line">
            {[...parClient.entries()].map(([id, c]) => (
              <div key={id} className="py-2.5">
                <div className="flex items-center justify-between">
                  <Link href={`/responsable/clients/${id}`} className="font-semibold text-sm hover:text-blue">{c.client}</Link>
                  <span className="font-display font-extrabold tabular">
                    {formatMinutes(c.minutes)} <span className="text-xs text-ink-soft font-normal">({minutesEnHeuresDecimales(c.minutes)} h)</span>
                  </span>
                </div>
                <div className="text-xs text-ink-soft mt-0.5">
                  {[...c.parTech.entries()].map(([t, m]) => `${t} : ${formatMinutes(m)}`).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-display font-bold text-sm mb-3">Détail des saisies</h2>
        {lignes.length === 0 ? (
          <p className="text-sm text-ink-soft">Aucune saisie.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Technicien</th>
                  <th className="py-2 pr-3 text-right">Durée</th>
                  <th className="py-2 pr-3">Commentaire</th>
                  {estAdmin && <th className="py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.id} className="border-b border-line align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDateJour(l.dateTravail)}</td>
                    <td className="py-2 pr-3">{l.client}</td>
                    <td className="py-2 pr-3">{l.technicien}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular whitespace-nowrap">{formatMinutes(l.minutes)}</td>
                    <td className="py-2 pr-3 text-ink-soft whitespace-pre-line">{l.commentaire ?? "—"}</td>
                    {estAdmin && (
                      <td className="py-2 min-w-40">
                        <details>
                          <summary className="text-xs font-semibold text-blue cursor-pointer">Corriger</summary>
                          <div className="mt-2 flex flex-col gap-2 w-72">
                            <HeuresSousTraitanceForm
                              action={modifierHeuresSousTraitance}
                              clients={listeClients}
                              retour={retour}
                              dateMax={aujourdhuiBruxelles()}
                              submitLabel="Enregistrer"
                              valeurs={l}
                            />
                            <form action={supprimerHeuresSousTraitance}>
                              <input type="hidden" name="id" value={l.id} />
                              <input type="hidden" name="retour" value={retour} />
                              <button type="submit" className="w-full text-xs font-semibold text-red-ink border border-red-ink/30 rounded-lg py-1.5">
                                Supprimer
                              </button>
                            </form>
                          </div>
                        </details>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
