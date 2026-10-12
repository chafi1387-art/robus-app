import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { inputClass } from "@/components/ui";

// Phase 31 : « Annuler et supprimer » (administrateur). Repliée par défaut,
// motif obligatoire + case de confirmation — pour ne jamais supprimer par erreur.

export const MOTIFS_ANNULATION = [
  "Erreur de saisie",
  "Doublon",
  "Annulé par le client",
  "Mission de test",
  "Reporté — sera recréé plus tard",
  "Autre",
] as const;

export function ZoneSuppression({
  action,
  champs,
  titre,
  bouton,
  avertissements,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  champs: Record<string, string>;
  titre: string;
  bouton: string;
  avertissements: ReactNode[];
  children?: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border-[1.5px] border-red/40 bg-surface">
      <summary className="list-none cursor-pointer px-5 py-3.5 flex items-center gap-2 text-sm font-bold text-red-ink">
        <Trash2 className="w-4 h-4" /> {titre}
        <span className="ml-auto text-xs font-semibold text-ink-soft group-open:hidden">Administrateur · ouvrir</span>
      </summary>
      <form action={action} className="px-5 pb-5 flex flex-col gap-3">
        {Object.entries(champs).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <ul className="text-sm bg-red-fill/60 text-red-ink rounded-xl px-4 py-3 flex flex-col gap-1 list-disc list-inside">
          {avertissements.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Motif *</span>
          <select name="motif" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Choisir…
            </option>
            {MOTIFS_ANNULATION.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <input name="precision" maxLength={300} placeholder="Précision (obligatoire si « Autre »)…" className={inputClass} />
        {children}
        <label className="flex items-start gap-2 text-sm font-semibold">
          <input type="checkbox" name="confirmation" required className="w-4 h-4 mt-0.5" />
          Je confirme : la suppression est définitive (une trace reste au journal d&apos;activité).
        </label>
        <BoutonEnvoi type="submit" enCours="Suppression…" className="self-start rounded-xl bg-red text-white font-display font-bold text-sm px-4 py-2.5 hover:opacity-90">
          {bouton}
        </BoutonEnvoi>
      </form>
    </details>
  );
}
