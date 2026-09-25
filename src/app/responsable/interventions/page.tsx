import {
  Card,
  Btn,
  StatutInterventionPill,
  TypeInterventionPill,
  PrioritePill,
  inputClass,
} from "@/components/ui";
import { db } from "@/db";
import { appareils, clients, interventions, projets, sites, users } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/format";
import { assignerIntervention, getDemandesAideOuvertes, getTechniciens, resoudreDemandeAide } from "../actions";

// Une intervention est encore modifiable tant que le travail n'a pas
// commencé — au-delà, changer le technicien fausserait l'historique.
const STATUTS_MODIFIABLES = new Set(["creee", "planifiee", "affectee"]);

// Une intervention sans Projet (legacy, pré-Phase 5) est regroupée à part,
// sous cette clé conventionnelle (aucun id de Projet ne peut la produire).
const SANS_PROJET_KEY = "__sans_projet__";

export default async function InterventionsPage() {
  const [rows, techniciens, demandesAide] = await Promise.all([
    db
      .select({
        id: interventions.id,
        type: interventions.type,
        statut: interventions.statut,
        priorite: interventions.priorite,
        dateProgrammee: interventions.dateProgrammee,
        appareilId: appareils.id,
        numeroInterne: appareils.numeroInterne,
        // Phase 6 : le Client d'une intervention se dérive désormais du
        // Projet (l'Appareil n'étant plus nécessairement rattaché à un Site).
        raisonSociale: clients.raisonSociale,
        technicien: users.nom,
        technicienId: interventions.technicienId,
        projetId: interventions.projetId,
        projetReference: projets.reference,
        projetTitre: projets.titre,
        projetCreatedAt: projets.createdAt,
      })
      .from(interventions)
      .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
      .leftJoin(projets, eq(interventions.projetId, projets.id))
      .leftJoin(clients, eq(projets.clientId, clients.id))
      .leftJoin(users, eq(interventions.technicienId, users.id))
      .orderBy(desc(interventions.dateProgrammee)),
    getTechniciens(),
    getDemandesAideOuvertes(),
  ]);

  // Regroupement en mémoire par Projet (une seule requête ci-dessus, pas de
  // N+1) — ordonné par Projet le plus récemment créé en premier ; les
  // interventions sans Projet (legacy, pré-Phase 5) finissent dans un groupe
  // "Sans projet" affiché en dernier.
  type Row = (typeof rows)[number];
  const groupes = new Map<
    string,
    { projetId: string | null; reference: string | null; titre: string | null; createdAt: Date | null; interventions: Row[] }
  >();
  for (const r of rows) {
    const cle = r.projetId ?? SANS_PROJET_KEY;
    let groupe = groupes.get(cle);
    if (!groupe) {
      groupe = {
        projetId: r.projetId,
        reference: r.projetReference,
        titre: r.projetTitre,
        createdAt: r.projetCreatedAt,
        interventions: [],
      };
      groupes.set(cle, groupe);
    }
    groupe.interventions.push(r);
  }
  const groupesTries = [...groupes.values()].sort((a, b) => {
    if (a.projetId === null) return 1;
    if (b.projetId === null) return -1;
    return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold font-display">Interventions</h1>
          <p className="text-sm text-ink-soft">{rows.length} intervention(s)</p>
        </div>
        <Btn href="/api/export/interventions" variant="ghost">
          Exporter CSV
        </Btn>
      </div>

      {demandesAide.length > 0 && (
        <Card className="p-5 border-red/40">
          <h2 className="font-display font-bold text-sm mb-3 text-red-ink">
            🆘 Demandes d&apos;aide en cours ({demandesAide.length})
          </h2>
          <div className="flex flex-col divide-y divide-line">
            {demandesAide.map((d) => (
              <div key={d.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {d.technicienNom} — {d.numeroInterne ?? "Appareil inconnu"}
                  </div>
                  {d.message && <div className="text-xs text-ink-soft">{d.message}</div>}
                  <div className="text-xs text-ink-soft">{formatDate(d.createdAt)}</div>
                </div>
                <form action={resoudreDemandeAide}>
                  <input type="hidden" name="id" value={d.id} />
                  <Btn type="submit" variant="ghost" className="!px-3 !py-1.5 !text-xs">
                    Marquer résolu
                  </Btn>
                </form>
              </div>
            ))}
          </div>
        </Card>
      )}

      {rows.length === 0 && (
        <Card className="p-5">
          <p className="text-sm text-ink-soft">Aucune intervention pour l&apos;instant.</p>
        </Card>
      )}

      {groupesTries.map((groupe) => (
        <Card key={groupe.projetId ?? SANS_PROJET_KEY} className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">
            {groupe.projetId ? (
              <Link href={`/responsable/projets/${groupe.projetId}`} className="text-blue hover:underline">
                {groupe.reference} — {groupe.titre}
              </Link>
            ) : (
              "Sans projet"
            )}{" "}
            <span className="text-ink-soft font-normal">({groupe.interventions.length})</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Appareil</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Priorité</th>
                  <th className="pb-2 pr-3">Technicien</th>
                  <th className="pb-2 pr-3">Statut</th>
                </tr>
              </thead>
              <tbody>
                {groupe.interventions.map((i) => {
                  const modifiable = STATUTS_MODIFIABLES.has(i.statut);
                  return (
                    <tr key={i.id} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-3 whitespace-nowrap">{formatDateTime(i.dateProgrammee)}</td>
                      <td className="py-2.5 pr-3">
                        <Link href={`/responsable/appareils/${i.appareilId}`} className="font-semibold text-blue">
                          {i.numeroInterne}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3">
                        <TypeInterventionPill type={i.type} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <PrioritePill priorite={i.priorite} />
                      </td>
                      <td className="py-2.5 pr-3">
                        {modifiable ? (
                          <form action={assignerIntervention} className="flex items-center gap-1.5">
                            <input type="hidden" name="interventionId" value={i.id} />
                            <select
                              name="technicienId"
                              defaultValue={i.technicienId ?? ""}
                              className={`${inputClass} !py-1 !text-xs w-36`}
                            >
                              <option value="">Non affecté</option>
                              {techniciens.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.nom}
                                </option>
                              ))}
                            </select>
                            <button
                              type="submit"
                              className="text-xs font-bold px-2 py-1 rounded-lg border border-line hover:bg-blue-pale"
                            >
                              OK
                            </button>
                          </form>
                        ) : (
                          <span className="text-ink-soft">{i.technicien ?? "Non affecté"}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatutInterventionPill statut={i.statut} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
