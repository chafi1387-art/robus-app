import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { SuiviEnvoi } from "@/components/suivi-envoi";
import { Card, StatutInterventionPill, TypeInterventionPill, PrioritePill, inputClass } from "@/components/ui";
import { BadgeEnCours } from "@/components/kit-tableau";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { db } from "@/db";
import { appareils, clients, interventions, projets, users } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { assignerIntervention } from "../actions";

// Vue « Par projet » du planning : l'ancienne liste (une table par projet,
// affectation directe dans la colonne Technicien), conservée telle quelle.

// Une intervention est encore modifiable tant que le travail n'a pas
// commencé — au-delà, changer le technicien fausserait l'historique.
const STATUTS_MODIFIABLES = new Set(["creee", "planifiee", "affectee"]);

// Une intervention sans Projet (legacy, pré-Phase 5) est regroupée à part.
const SANS_PROJET_KEY = "__sans_projet__";

export async function VueProjets({ technicienId, type, techniciens }: { technicienId: string | null; type: string | null; techniciens: { id: string; nom: string }[] }) {
  const rows = await db
    .select({
      id: interventions.id,
      type: interventions.type,
      statut: interventions.statut,
      priorite: interventions.priorite,
      dateProgrammee: interventions.dateProgrammee,
      appareilId: appareils.id,
      numeroInterne: appareils.numeroInterne,
      raisonSociale: clients.raisonSociale,
      technicien: users.nom,
      technicienId: interventions.technicienId,
      envoyeeLe: interventions.envoyeeLe,
      vueLe: interventions.vueLe,
      accepteeLe: interventions.accepteeLe,
      refuseeLe: interventions.refuseeLe,
      refusMotif: interventions.refusMotif,
      envoiEmail: interventions.envoiEmail,
      envoiPush: interventions.envoiPush,
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
    .where(
      and(
        technicienId ? eq(interventions.technicienId, technicienId) : undefined,
        type ? eq(interventions.type, type as "preventive") : undefined
      )
    )
    .orderBy(desc(interventions.dateProgrammee));

  type Row = (typeof rows)[number];
  const groupes = new Map<string, { projetId: string | null; reference: string | null; titre: string | null; createdAt: Date | null; interventions: Row[] }>();
  for (const r of rows) {
    const cle = r.projetId ?? SANS_PROJET_KEY;
    let groupe = groupes.get(cle);
    if (!groupe) {
      groupe = { projetId: r.projetId, reference: r.projetReference, titre: r.projetTitre, createdAt: r.projetCreatedAt, interventions: [] };
      groupes.set(cle, groupe);
    }
    groupe.interventions.push(r);
  }
  const groupesTries = [...groupes.values()].sort((a, b) => {
    if (a.projetId === null) return 1;
    if (b.projetId === null) return -1;
    return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
  });
  const retour = `/responsable/interventions?vue=projet${technicienId ? `&t=${technicienId}` : ""}${type ? `&type=${type}` : ""}`;

  if (rows.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm text-ink-soft">Aucune mission pour l&apos;instant. Pour créer une mission, ouvrez son projet.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groupesTries.map((groupe) => (
        <Card key={groupe.projetId ?? SANS_PROJET_KEY} className="p-4 sm:p-5">
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
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <Link href={`/responsable/missions/${i.id}`} className="font-semibold text-blue hover:underline">
                          {formatDateTime(i.dateProgrammee)}
                        </Link>
                        {i.statut === "en_cours" && (
                          <span className="ml-1.5">
                            <BadgeEnCours texte="DIRECT" petit />
                          </span>
                        )}
                      </td>
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
                            <input type="hidden" name="retour" value={retour} />
                            {!i.dateProgrammee && (
                              <input type="datetime-local" name="dateProgrammee" required title="Date obligatoire avant d'envoyer la mission" className={`${inputClass} !py-1 !text-xs w-44`} />
                            )}
                            <select name="technicienId" defaultValue={i.technicienId ?? ""} className={`${inputClass} !py-1 !text-xs w-36`}>
                              <option value="">Non affecté</option>
                              {techniciens.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.nom}
                                </option>
                              ))}
                            </select>
                            <BoutonEnvoi type="submit" className="text-xs font-bold px-2 py-1 rounded-lg border border-line hover:bg-blue-pale">
                              OK
                            </BoutonEnvoi>
                          </form>
                        ) : (
                          <span className="text-ink-soft">{i.technicien ?? "Non affecté"}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-col items-start gap-1">
                          <StatutInterventionPill statut={i.statut} />
                          <SuiviEnvoi m={i} />
                        </div>
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
