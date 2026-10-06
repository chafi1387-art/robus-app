"use client";

import { useState } from "react";
import { inputClass } from "@/components/ui";
import { fmtMois, moisPassages } from "@/lib/mois-passages";

// Phase 24 : choix « ponctuelle » / « contrat à passages » dans le catalogue,
// avec l'aperçu des mois de passage (au milieu de chaque période).

type Defauts = {
  mode?: string;
  dureeMois?: number | null;
  nbPassages?: number | null;
  typeMission?: string | null;
  anticipationJours?: number | null;
  checklistModeleId?: string | null;
};


export function ChampsContrat({ defauts, checklists }: { defauts?: Defauts; checklists: { id: string; nom: string }[] }) {
  const [mode, setMode] = useState(defauts?.mode === "contrat" ? "contrat" : "ponctuelle");
  const [duree, setDuree] = useState(String(defauts?.dureeMois ?? 12));
  const [n, setN] = useState(String(defauts?.nbPassages ?? 4));
  const mois = moisPassages(Number(duree), Number(n));

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-semibold text-ink-soft mb-1">Type de prestation</legend>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="radio" name="mode" value="ponctuelle" checked={mode === "ponctuelle"} onChange={() => setMode("ponctuelle")} className="mt-1" />
          <span>
            <span className="font-semibold">Ponctuelle</span>
            <span className="block text-xs text-ink-soft">Une réparation, une maintenance hors contrat…</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="radio" name="mode" value="contrat" checked={mode === "contrat"} onChange={() => setMode("contrat")} className="mt-1" />
          <span>
            <span className="font-semibold">Contrat à passages</span>
            <span className="block text-xs text-ink-soft">Abonnement de maintenance : durée + nombre de passages, planifiés automatiquement.</span>
          </span>
        </label>
      </fieldset>

      {mode === "contrat" && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-blue-pale/40 p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
              Durée du contrat (mois)
              <input type="number" name="dureeMois" min={1} max={120} required value={duree} onChange={(e) => setDuree(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
              Nombre de passages
              <input type="number" name="nbPassages" min={1} max={120} required value={n} onChange={(e) => setN(e.target.value)} className={inputClass} />
            </label>
          </div>
          <p className="text-xs text-ink-soft" data-apercu-passages>
            {mois.length
              ? <>Par appareil, un passage au milieu de chaque période : mois {mois.map(fmtMois).join(" · ")}.</>
              : "Indiquez la durée et le nombre de passages."}
          </p>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
            Type de mission
            <select name="typeMission" defaultValue={defauts?.typeMission ?? "preventive"} className={inputClass}>
              <option value="preventive">Préventive</option>
              <option value="systematique">Systématique</option>
              <option value="corrective">Corrective</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
            Checklist (facultatif)
            <select name="checklistModeleId" defaultValue={defauts?.checklistModeleId ?? ""} className={inputClass}>
              <option value="">La plus adaptée (automatique)</option>
              {checklists.map((c) => (
                <option key={c.id} value={c.id}>{c.nom}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
            Créer la mission combien de jours avant le passage ?
            <input type="number" name="anticipationJours" min={1} max={90} required defaultValue={defauts?.anticipationJours ?? 30} className={inputClass} />
          </label>
        </div>
      )}
    </div>
  );
}
