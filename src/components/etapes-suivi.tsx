import { ETAPES } from "@/lib/observateur";

// Phase 18 : suivi façon « colis » pour l'observateur.
export function EtapesSuivi({ etape, compact = false }: { etape: number; compact?: boolean }) {
  return (
    <ol className="flex items-start w-full">
      {ETAPES.map((libelle, i) => {
        const fait = i <= etape;
        const courant = i === etape;
        return (
          <li key={libelle} className="flex-1 flex flex-col items-center text-center relative">
            {i > 0 && <span className={`absolute top-[9px] right-1/2 w-full h-[3px] ${i <= etape ? "bg-blue" : "bg-line"}`} />}
            <span
              className={`relative z-10 w-5 h-5 rounded-full border-[3px] ${fait ? "bg-blue border-blue" : "bg-surface border-line"} ${courant ? "ring-4 ring-blue/20" : ""}`}
            />
            {!compact && (
              <span className={`mt-1.5 text-[11px] leading-tight ${courant ? "font-bold text-navy" : fait ? "text-ink" : "text-ink-soft"}`}>{libelle}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
