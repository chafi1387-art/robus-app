"use client";

import { useState } from "react";

// Phase 20 : choix du type de demande (+ options propres à chaque type).
export function ChoixTypeDemande({ types, initial }: { types: { id: string; label: string; icone: string }[]; initial: string }) {
  const [type, setType] = useState(initial);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Type de demande</span>
      <div className="grid grid-cols-2 gap-2">
        {types.map((t) => (
          <label key={t.id} className={`rounded-xl border px-3 py-3 text-sm font-semibold cursor-pointer ${type === t.id ? "border-blue bg-blue-pale text-navy" : "border-line"}`}>
            <input type="radio" name="type" value={t.id} checked={type === t.id} onChange={() => setType(t.id)} className="sr-only" />
            <span className="mr-1">{t.icone}</span> {t.label}
          </label>
        ))}
      </div>
      {type === "panne" && (
        <label className="flex items-center gap-2.5 rounded-xl bg-red-fill text-red-ink px-3 py-3 font-bold">
          <input type="checkbox" name="personneBloquee" className="w-5 h-5" /> Une personne est bloquée dans la cabine
        </label>
      )}
      {type === "question" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="reclamation" /> Il s&apos;agit d&apos;une réclamation
        </label>
      )}
    </div>
  );
}
