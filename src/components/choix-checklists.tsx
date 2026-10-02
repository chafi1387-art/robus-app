// Phase 23 : choisir les checklists en créant (ou en modifiant) une mission.
// Aucune case cochée = la checklist la plus adaptée est mise automatiquement
// (type de mission + marque + type d'appareil).
type Modele = { id: string; nom: string; nbTaches: number; typeIntervention: string | null; marque: string | null; typeAppareil: string | null };

const TYPES: Record<string, string> = { preventive: "Préventive", corrective: "Corrective", systematique: "Systématique" };

export function ChoixChecklists({ modeles, className = "" }: { modeles: Modele[]; className?: string }) {
  return (
    <div className={`rounded-xl border border-line p-3 ${className}`}>
      <input type="hidden" name="checklistsForm" value="1" />
      <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">Checklists à réaliser</div>
      <p className="text-xs text-ink-soft mb-2">Aucune case cochée : la checklist la plus adaptée est ajoutée automatiquement. Vous pouvez en cocher plusieurs.</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {modeles.map((m) => (
          <label key={m.id} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="checklistIds" value={m.id} />
            <span>
              {m.nom} <span className="text-ink-soft text-xs">({m.nbTaches} tâches{[m.typeIntervention ? TYPES[m.typeIntervention] : null, m.marque, m.typeAppareil].filter(Boolean).length ? ` · ${[m.typeIntervention ? TYPES[m.typeIntervention] : null, m.marque, m.typeAppareil].filter(Boolean).join(", ")}` : ""})</span>
            </span>
          </label>
        ))}
        <label className="flex items-center gap-1.5 text-sm text-ink-soft">
          <input type="checkbox" name="sansChecklist" /> Sans checklist
        </label>
      </div>
    </div>
  );
}
