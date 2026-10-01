import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Star } from "lucide-react";
import { db } from "@/db";
import { appareils, enquetesSatisfaction, interventions, missionNotes, rapportPhotos, rapports, users } from "@/db/schema";
import { Card } from "@/components/ui";
import { EtapesSuivi } from "@/components/etapes-suivi";
import { GaleriePhotos } from "@/components/galerie-photos";
import { formatDateTime } from "@/lib/format";
import { DROIT_HISTO_12_MOIS, etapeObservateur, exigerAppareil, requireObservateur } from "@/lib/observateur";
import { prenom } from "@/lib/observateur-donnees";
import { piecesNettes } from "@/lib/pieces-mission";
import { noterIntervention } from "../../actions";

const TYPE: Record<string, string> = { preventive: "Maintenance préventive", corrective: "Dépannage", systematique: "Contrôle systématique" };
const STATUT_APPAREIL: Record<string, string> = {
  en_service: "En service",
  sous_surveillance: "Sous surveillance",
  en_panne: "En panne",
  hors_service: "Hors service",
  en_travaux: "En travaux",
};

// Phase 18 : une intervention vue par l'observateur. Le rapport (texte,
// photos) n'apparaît qu'après validation par le bureau et avec le droit
// « rapports » ; les pièces avec le droit « pièces » (désignation, sans prix).
export default async function InterventionObservateurPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ merci?: string; erreur?: string }>;
}) {
  const ctx = await requireObservateur();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ m: interventions, numero: appareils.numeroInterne, technicien: users.nom })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(users, eq(interventions.technicienId, users.id))
    .where(eq(interventions.id, id))
    .limit(1);
  if (!row) notFound();
  exigerAppareil(ctx, row.m.appareilId);
  const d = ctx.droits;
  const m = row.m;
  const finie = ["terminee", "validee", "cloturee"].includes(m.statut);
  // Sans droit « historique », une intervention terminée n'est pas consultable ;
  // sans « temps réel », une intervention en cours non plus.
  if ((finie && !d.has("historique")) || (!finie && !d.has("temps_reel"))) notFound();
  // eslint-disable-next-line react-hooks/purity
  if (finie && d.has(DROIT_HISTO_12_MOIS) && m.dateFin && m.dateFin.getTime() < Date.now() - 366 * 86400000) notFound();
  const rapportVisible = d.has("rapports") && !!m.valideeLe;

  const [[rapport], piecesUtilisees, [dejaNote]] = await Promise.all([
    rapportVisible ? db.select().from(rapports).where(eq(rapports.interventionId, id)).limit(1) : Promise.resolve([]),
    d.has("pieces") && finie ? piecesNettes(id).then((r) => r.filter((p) => p.quantite > 0)) : Promise.resolve([]),
    d.has("satisfaction")
      ? db
          .select({ note: enquetesSatisfaction.note })
          .from(enquetesSatisfaction)
          .where(and(eq(enquetesSatisfaction.interventionId, id), eq(enquetesSatisfaction.auteurId, ctx.userId)))
          .limit(1)
      : Promise.resolve([]),
  ]);
  // Phase 19 : rapports du bureau rendus visibles au client.
  const rapportsBureau = d.has("rapports")
    ? await db
        .select()
        .from(missionNotes)
        .where(and(eq(missionNotes.interventionId, id), eq(missionNotes.type, "rapport_bureau"), eq(missionNotes.visibleClient, 1), isNull(missionNotes.archiveLe)))
        .orderBy(asc(missionNotes.createdAt))
    : [];
  const photos = rapport ? await db.select({ url: rapportPhotos.url }).from(rapportPhotos).where(eq(rapportPhotos.rapportId, rapport.id)).orderBy(asc(rapportPhotos.createdAt)) : [];

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/observateur/appareils/${m.appareilId}`} className="text-xs text-blue font-semibold">&larr; Ascenseur {row.numero}</Link>
      <div>
        <h1 className="font-display font-extrabold text-[21px] text-navy">{TYPE[m.type] ?? "Intervention"}</h1>
        <p className="text-sm text-ink-soft">
          Ascenseur {row.numero} · {formatDateTime(m.dateFin ?? m.dateProgrammee)}
          {prenom(row.technicien) ? ` · ${prenom(row.technicien)}` : ""}
        </p>
      </div>

      <Card className="p-4">
        <EtapesSuivi etape={etapeObservateur(m)} />
      </Card>

      {finie && d.has("rapports") && !rapportVisible && (
        <p className="text-sm bg-blue-pale text-blue rounded-lg px-3 py-2">Le rapport est en cours de validation par ROBUS. Vous serez prévenu dès qu&apos;il sera disponible.</p>
      )}

      {rapport && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Rapport d&apos;intervention</h2>
          <dl className="text-sm flex flex-col gap-2">
            <div>
              <dt className="text-xs text-ink-soft">Travaux réalisés</dt>
              <dd className="whitespace-pre-wrap">{rapport.travauxRealises}</dd>
            </div>
            {rapport.observations && (
              <div>
                <dt className="text-xs text-ink-soft">Observations</dt>
                <dd className="whitespace-pre-wrap">{rapport.observations}</dd>
              </div>
            )}
            {rapport.statutFinalAppareil && (
              <div className="flex justify-between">
                <dt className="text-ink-soft">État de l&apos;appareil après l&apos;intervention</dt>
                <dd className="font-semibold">{STATUT_APPAREIL[rapport.statutFinalAppareil] ?? rapport.statutFinalAppareil}</dd>
              </div>
            )}
          </dl>
          {photos.length > 0 && (
            <div className="mt-3">
              <GaleriePhotos photos={photos} />
            </div>
          )}
        </Card>
      )}

      {rapportsBureau.map((r) => (
        <Card key={r.id} className="p-4">
          <h2 className="font-display font-bold text-sm mb-1">{r.titre ?? "Rapport ROBUS"}</h2>
          <p className="text-xs text-ink-soft mb-2">ROBUS · {formatDateTime(r.createdAt)}</p>
          {r.texte && <p className="text-sm whitespace-pre-wrap">{r.texte}</p>}
          {r.fichiers.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {r.fichiers.map((f) => (
                <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue border border-line rounded-lg px-2 py-1">
                  📎 {f.nom}
                </a>
              ))}
            </div>
          )}
        </Card>
      ))}

      {piecesUtilisees.length > 0 && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Pièces remplacées</h2>
          <ul className="text-sm flex flex-col gap-1">
            {piecesUtilisees.map((p, i) => (
              <li key={i}>{p.quantite} × {p.nom}</li>
            ))}
          </ul>
        </Card>
      )}

      {finie && d.has("satisfaction") && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Votre avis</h2>
          {sp.merci || dejaNote ? (
            <p className="text-sm text-green-ink flex items-center gap-1">
              Merci pour votre note{dejaNote ? ` (${dejaNote.note}/5)` : ""} !
            </p>
          ) : (
            <form action={noterIntervention} className="flex flex-col gap-3">
              <input type="hidden" name="interventionId" value={m.id} />
              <div className="flex flex-row-reverse justify-end gap-1">
                {[5, 4, 3, 2, 1].map((n) => (
                  <label key={n} className="cursor-pointer peer group">
                    <input type="radio" name="note" value={n} required className="sr-only peer" />
                    <span className="flex flex-col items-center gap-0.5 rounded-xl border border-line px-2.5 py-2 peer-checked:bg-blue peer-checked:text-white peer-checked:border-blue">
                      <Star className="w-5 h-5" />
                      <span className="text-xs font-bold">{n}</span>
                    </span>
                  </label>
                ))}
              </div>
              {sp.erreur === "note" && <p className="text-xs text-red-ink">Choisissez une note de 1 à 5.</p>}
              <textarea name="commentaire" rows={2} maxLength={1000} placeholder="Un commentaire ? (facultatif)" className="rounded-lg border border-line px-3 py-2.5 text-[15px]" />
              <button type="submit" className="bg-blue text-white font-display font-bold rounded-xl py-3">Envoyer ma note</button>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
