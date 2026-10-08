import Link from "next/link";
import { FileSignature, History } from "lucide-react";
import { Card, Pill } from "@/components/ui";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { GaleriePhotos } from "@/components/galerie-photos";
import { STATUTS_DEVIS } from "@/lib/devis";
import { formatDateTime } from "@/lib/format";
import { ouvrirDevisMission } from "@/app/responsable/devis/actions";

type DevisLigne = {
  id: string;
  numero: string;
  statut: string;
  titre: string | null;
  besoinTechnicien: string | null;
  dateEnvoi: Date | null;
  decideLe: Date | null;
  decideParNom: string | null;
  travauxPlanifiesLe: Date | null;
  realiseLe: Date | null;
  motifRefus: string | null;
};

const ETAT_APPAREIL: Record<string, string> = {
  en_service: "En service",
  sous_surveillance: "Sous surveillance",
  en_panne: "En panne",
  hors_service: "Hors service",
  en_travaux: "En travaux",
};

function libelle(d: DevisLigne) {
  if (d.statut === "accepte") return d.travauxPlanifiesLe ? "Accepté — travaux planifiés" : "Accepté — travaux à planifier";
  return STATUTS_DEVIS[d.statut]?.label ?? d.statut;
}

/** Phase 25b : bloc « Devis » de la page mission (bureau). */
export function CarteDevisMission({ interventionId, devis, peutCreer }: { interventionId: string; devis: DevisLigne[]; peutCreer: boolean }) {
  const ouvert = devis.find((d) => d.statut === "a_preparer" || d.statut === "brouillon");
  return (
    <Card className="p-5" id="devis">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h2 className="font-display font-bold text-sm flex items-center gap-2">
          <FileSignature className="w-4 h-4 text-blue" /> Devis
        </h2>
        {peutCreer && (
          <form action={ouvrirDevisMission}>
            <input type="hidden" name="interventionId" value={interventionId} />
            <BoutonEnvoi className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold font-display bg-blue text-white hover:bg-blue-light" enCours="Ouverture…">
              {ouvert ? (ouvert.statut === "a_preparer" ? "Préparer le devis demandé" : "Continuer le devis") : "Ajouter un devis"}
            </BoutonEnvoi>
          </form>
        )}
      </div>
      {devis.length === 0 ? (
        <p className="text-sm text-ink-soft">Aucun devis. Saisissez-le ou joignez un devis déjà prêt (PDF), puis envoyez-le au client par email ou dans son espace.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {devis.map((d) => (
            <li key={d.id} className="py-2.5 flex items-start gap-3 flex-wrap">
              <Link href={`/responsable/devis/${d.id}`} className="font-semibold text-blue hover:underline">
                {d.numero}
              </Link>
              <div className="flex-1 min-w-[200px] text-sm">
                <div>{d.titre ?? "Devis"}</div>
                {d.statut === "a_preparer" && d.besoinTechnicien && <div className="text-xs text-orange-ink mt-0.5">Besoin du technicien : {d.besoinTechnicien.slice(0, 200)}</div>}
                {d.decideParNom && <div className="text-xs text-ink-soft mt-0.5">Réponse de {d.decideParNom} le {formatDateTime(d.decideLe)}{d.motifRefus ? ` — « ${d.motifRefus} »` : ""}</div>}
              </div>
              <Pill tone={STATUTS_DEVIS[d.statut]?.ton ?? "neutral"}>{libelle(d)}</Pill>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Passage = {
  p: {
    id: string;
    numero: number;
    dateDebut: Date | null;
    dateFin: Date | null;
    valideeLe: Date | null;
    rapport: unknown;
    photos: string[];
    motif: string | null;
  };
  technicien: string | null;
};

/** Phase 25b : passages précédents de la même mission (ex. diagnostic avant le devis). */
export function PassagesPrecedents({ passages, photos = true }: { passages: Passage[]; photos?: boolean }) {
  if (!passages.length) return null;
  return (
    <Card className="p-5">
      <h2 className="font-display font-bold text-sm flex items-center gap-2 mb-2">
        <History className="w-4 h-4 text-blue" /> Passages précédents de cette mission
      </h2>
      <ol className="flex flex-col gap-3">
        {passages.map(({ p, technicien }) => {
          const r = (p.rapport ?? {}) as { travauxRealises?: string | null; observations?: string | null; tempsPasseMinutes?: number | null; statutFinalAppareil?: string | null };
          return (
            <li key={p.id} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold text-navy">Passage {p.numero}{technicien ? ` — ${technicien}` : ""}</span>
                <span className="text-xs text-ink-soft">{p.dateFin ? `Terminé le ${formatDateTime(p.dateFin)}` : ""}{p.valideeLe ? " · rapport validé" : ""}</span>
              </div>
              {r.travauxRealises && <p className="mt-1 whitespace-pre-wrap">{r.travauxRealises}</p>}
              {r.observations && <p className="mt-1 text-ink-soft whitespace-pre-wrap">{r.observations}</p>}
              <div className="text-xs text-ink-soft mt-1">
                {r.statutFinalAppareil ? `État de l'appareil : ${ETAT_APPAREIL[r.statutFinalAppareil] ?? r.statutFinalAppareil}` : ""}
                {r.tempsPasseMinutes ? ` · ${r.tempsPasseMinutes} min` : ""}
                {p.motif ? ` · Suite : ${p.motif}` : ""}
              </div>
              {photos && p.photos.length > 0 && (
                <div className="mt-2">
                  <GaleriePhotos photos={p.photos.map((url) => ({ url }))} taille="sm" />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
