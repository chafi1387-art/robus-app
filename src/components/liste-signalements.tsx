import Link from "next/link";
import { Pill } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { GRAVITES_SIGNALEMENT, STATUTS_SIGNALEMENT, TYPES_SIGNALEMENT } from "@/lib/signalements-types";

// Phase 21 : liste compacte des signalements (fiche technicien, projet, mission).
export type LigneSignalement = {
  id: string;
  numero: string;
  type: string;
  gravite: string;
  statut: string;
  description: string;
  blesse: number;
  bloquant: number;
  createdAt: Date;
  technicien: string;
  appareil: string | null;
};

export function ListeSignalements({ lignes, avecTechnicien = true, vide = "Aucun signalement." }: { lignes: LigneSignalement[]; avecTechnicien?: boolean; vide?: string }) {
  if (!lignes.length) return <p className="text-sm text-ink-soft">{vide}</p>;
  return (
    <div className="flex flex-col divide-y divide-line">
      {lignes.map((s) => {
        const t = TYPES_SIGNALEMENT[s.type];
        const st = STATUTS_SIGNALEMENT[s.statut] ?? STATUTS_SIGNALEMENT.nouveau;
        const g = GRAVITES_SIGNALEMENT[s.gravite];
        return (
          <Link key={s.id} href={`/responsable/signalements/${s.id}`} className="py-2.5 flex items-start justify-between gap-3 hover:bg-blue-pale/40 -mx-2 px-2 rounded-lg">
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {t?.icone} {t?.label ?? s.type} <span className="text-ink-soft font-normal">· {s.numero}</span>
              </div>
              <div className="text-xs text-ink-soft">
                {formatDateTime(s.createdAt)}
                {avecTechnicien ? ` · ${s.technicien}` : ""}
                {s.appareil ? ` · ${s.appareil}` : ""}
              </div>
              <div className="text-[13px] text-ink truncate">{s.description}</div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Pill tone={st.tone}>{st.label}</Pill>
              {s.gravite !== "normale" && g && <Pill tone={g.tone}>{s.blesse ? "Blessé" : g.label}</Pill>}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
