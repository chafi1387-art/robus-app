import Link from "next/link";
import { ETAT_PASSAGE, type EtatPassage } from "@/lib/garantie-passages";

// Phase 19 : frise des passages de garantie (une ligne par appareil).
type P = { id: string; appareilId: string; numeroAppareil: string; numero: number; total: number; datePrevue: Date; etat: EtatPassage; realiseLe: Date | null };

const fmt = (d: Date) => d.toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "2-digit" });

export function FrisePassages({ passages, lien = true }: { passages: P[]; lien?: boolean }) {
  const parAppareil = new Map<string, P[]>();
  for (const p of passages) parAppareil.set(p.appareilId, [...(parAppareil.get(p.appareilId) ?? []), p]);
  if (!passages.length) return <p className="text-sm text-ink-soft">Aucun passage programmé.</p>;
  return (
    <div className="flex flex-col gap-4">
      {[...parAppareil.values()].map((liste) => {
        const faits = liste.filter((p) => p.etat === "realise").length;
        return (
          <div key={liste[0].appareilId}>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-bold">{liste[0].numeroAppareil}</span>
              <span className="text-ink-soft">Réalisés {faits}/{liste[0].total}</span>
            </div>
            <ol className="flex items-start">
              {liste.map((p, i) => {
                const e = ETAT_PASSAGE[p.etat];
                const contenu = (
                  <>
                    <span className={`relative z-10 w-6 h-6 rounded-full ${e.couleur} text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-white`}>{p.numero}</span>
                    <span className="mt-1 text-[10.5px] text-ink-soft tabular">{fmt(p.realiseLe ?? p.datePrevue)}</span>
                    <span className={`text-[10px] font-semibold ${e.tone === "crit" ? "text-red-ink" : e.tone === "warn" ? "text-orange-ink" : e.tone === "ok" ? "text-green-ink" : "text-ink-soft"}`}>{e.label}</span>
                  </>
                );
                return (
                  <li key={p.id} className="flex-1 flex flex-col items-center text-center relative min-w-[56px]">
                    {i > 0 && <span className="absolute top-3 right-1/2 w-full h-[2px] bg-line" />}
                    {lien ? (
                      <Link href={`/responsable/garanties/passages/${p.id}`} className="flex flex-col items-center hover:opacity-80" title={`Passage ${p.numero}/${p.total} — ${e.label}`}>
                        {contenu}
                      </Link>
                    ) : (
                      <span className="flex flex-col items-center">{contenu}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
