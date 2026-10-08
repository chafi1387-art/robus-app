"use client";

// Phase 27 : liste déroulante de filtre qui s'applique dès qu'on choisit
// (formulaire GET, sans bouton « Filtrer »).
export function FiltreAuto({ name, valeur, options, label }: { name: string; valeur: string; options: { valeur: string; label: string }[]; label: string }) {
  return (
    <select
      name={name}
      defaultValue={valeur}
      aria-label={label}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="h-[34px] px-3 rounded-full border border-line bg-surface text-[13px] font-semibold text-ink hover:bg-blue-pale cursor-pointer max-w-[12rem]"
    >
      {options.map((o) => (
        <option key={o.valeur} value={o.valeur}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
