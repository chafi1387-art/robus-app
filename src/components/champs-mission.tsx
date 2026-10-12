import { inputClass } from "@/components/ui";

// Phase 31 : champs communs aux formulaires de mission.

type Tech = { id: string; nom: string; detail?: string | null };

/**
 * Choix du technicien en grandes cases (lisible sur téléphone), au lieu d'une
 * petite liste déroulante.
 */
export function ChoixTechnicien({ techniciens, defaut, requis = true, name = "technicienId" }: { techniciens: Tech[]; defaut?: string | null; requis?: boolean; name?: string }) {
  if (techniciens.length === 0) {
    return <p className="text-sm text-red-ink font-semibold">Aucun technicien actif. Créez d&apos;abord un technicien (Équipe technique).</p>;
  }
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1.5">Technicien</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[42vh] overflow-y-auto pr-0.5">
        {techniciens.map((t, i) => (
          <label
            key={t.id}
            className="flex items-center gap-3 rounded-xl border-[1.5px] border-line px-3 py-2.5 cursor-pointer hover:border-blue has-[:checked]:border-blue has-[:checked]:bg-blue-pale"
          >
            <input type="radio" name={name} value={t.id} required={requis && i === 0} defaultChecked={defaut === t.id} className="w-5 h-5 accent-[#0055A4] shrink-0" />
            <span className="w-9 h-9 rounded-full bg-navy text-white font-display font-bold text-sm flex items-center justify-center shrink-0" aria-hidden>
              {initiales(t.nom)}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-bold text-ink truncate">{t.nom}</span>
              {t.detail && <span className="block text-xs text-ink-soft truncate">{t.detail}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function initiales(nom: string) {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]!.toUpperCase())
    .join("");
}

/** « 2026-10-14T09:00 » d'une heure programmée (stockée telle que saisie). */
export function valeurDateHeure(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 16) : "";
}

/**
 * Début (date + heure) et, si la mission dure plusieurs jours, le dernier jour
 * (+ samedi/dimanche inclus ou non).
 */
export function ChampsDatesMission({
  debut,
  finPrevue,
  weekendInclus,
  debutRequis = true,
}: {
  debut?: Date | null;
  finPrevue?: Date | null;
  weekendInclus?: number | boolean | null;
  debutRequis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Date et heure de début</span>
        <input type="datetime-local" name="dateProgrammee" required={debutRequis} defaultValue={valeurDateHeure(debut)} className={inputClass} />
      </label>
      <details className="rounded-xl border border-line px-3 py-2 open:bg-blue-pale/40" open={!!finPrevue}>
        <summary className="cursor-pointer text-sm font-bold text-blue select-none">📅 Mission sur plusieurs jours</summary>
        <div className="flex flex-col gap-2 pt-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Dernier jour</span>
            <input type="date" name="dateFinPrevue" defaultValue={finPrevue ? finPrevue.toISOString().slice(0, 10) : ""} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="weekendInclus" defaultChecked={!!weekendInclus} className="w-4 h-4" />
            Travailler aussi le samedi et le dimanche
          </label>
          <p className="text-[11px] text-ink-soft">Une seule mission : elle apparaît chaque jour dans le planning, le technicien l&apos;accepte une fois, envoie photos et notes quand il veut, et fait un seul rapport à la fin. Laissez vide pour une mission d&apos;un jour.</p>
        </div>
      </details>
    </div>
  );
}
