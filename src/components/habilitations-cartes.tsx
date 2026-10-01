import { Pill } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { STATUT_HAB, type StatutHab } from "@/lib/habilitations";
import { FileCheck2 } from "lucide-react";

// Phase 19 : habilitations d'un technicien avec statut couleur + certificat.
export type HabCarte = {
  id: string;
  nom: string;
  etat: StatutHab;
  dateObtention: Date;
  dateExpiration: Date | null;
  organisme: string | null;
  numeroCertificat: string | null;
  certificatUrl: string | null;
};

export function HabilitationsCartes({ habilitations, actions }: { habilitations: HabCarte[]; actions?: (h: HabCarte) => React.ReactNode }) {
  if (!habilitations.length) return <p className="text-sm text-ink-soft">Aucune habilitation enregistrée.</p>;
  return (
    <div className="flex flex-col gap-2">
      {habilitations.map((h) => {
        const s = STATUT_HAB[h.etat];
        return (
          <div key={h.id} className="rounded-xl border border-line bg-surface p-3.5 flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-sm min-w-0">{h.nom}</div>
              <Pill tone={s.tone}>{s.label}</Pill>
            </div>
            <div className="text-xs text-ink-soft">
              Obtenue le {formatDate(h.dateObtention)}
              {h.dateExpiration ? ` · ${h.etat === "expiree" ? "expirée le" : "valable jusqu'au"} ${formatDate(h.dateExpiration)}` : " · sans échéance"}
              {h.organisme ? ` · ${h.organisme}` : ""}
              {h.numeroCertificat ? ` · n° ${h.numeroCertificat}` : ""}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {h.certificatUrl ? (
                <a href={h.certificatUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue inline-flex items-center gap-1">
                  <FileCheck2 className="w-3.5 h-3.5" /> Certificat
                </a>
              ) : (
                <span className="text-xs text-ink-soft">Pas de certificat joint</span>
              )}
              {actions?.(h)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
