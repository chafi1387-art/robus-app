"use client";

import { useState } from "react";
import { FileText, ListOrdered, Plus, Trash2 } from "lucide-react";
import { EnvoiFichiers } from "@/components/envoi-fichiers";

// Phase 25b : contenu du devis — lignes saisies (total HT en direct) OU
// devis déjà prêt (PDF scanné, ex. sous-traitance) avec son montant HT.

type Ligne = { cle: string; designation: string; quantite: string; pu: string };
const champ = "w-full rounded-lg border border-line px-2.5 py-2 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-blue-accent";

function nouvelle(): Ligne {
  return { cle: Math.random().toString(36).slice(2), designation: "", quantite: "1", pu: "" };
}
function nombre(v: string) {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function euros(n: number) {
  return `${n.toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT`;
}

export function EditeurDevis({
  modeInitial,
  lignesInitiales,
  document,
  montantDocument,
  besoin,
  pieces,
}: {
  modeInitial: "lignes" | "document";
  lignesInitiales: { designation: string; quantite: string; prixUnitaireHt: string | null }[];
  document: { url: string; nom: string | null } | null;
  montantDocument: string | null;
  besoin: string | null;
  pieces: { id: string; label: string }[];
}) {
  const [mode, setMode] = useState(modeInitial);
  const [lignes, setLignes] = useState<Ligne[]>(() =>
    lignesInitiales.length
      ? lignesInitiales.map((l) => ({ cle: Math.random().toString(36).slice(2), designation: l.designation, quantite: String(Number(l.quantite)), pu: l.prixUnitaireHt ?? "" }))
      : besoin
        ? [{ ...nouvelle(), designation: besoin.slice(0, 500) }]
        : [nouvelle()]
  );
  const maj = (cle: string, c: Partial<Ligne>) => setLignes((l) => l.map((x) => (x.cle === cle ? { ...x, ...c } : x)));
  const total = lignes.reduce((t, l) => t + (l.pu.trim() ? nombre(l.quantite) * nombre(l.pu) : 0), 0);
  const sansPrix = lignes.filter((l) => l.designation.trim() && !l.pu.trim()).length;

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="mode" value={mode} />
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Type de devis">
        {(
          [
            ["lignes", ListOrdered, "Saisir le devis", "Lignes, quantités, prix HT"],
            ["document", FileText, "Devis déjà prêt", "Joindre le PDF scanné (ex. sous-traitance)"],
          ] as const
        ).map(([v, Icone, titre, aide]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={mode === v}
            onClick={() => setMode(v)}
            className={`text-left rounded-xl border-[1.5px] px-3 py-2.5 transition-colors ${mode === v ? "border-blue bg-blue-pale/60" : "border-line hover:bg-blue-pale/30"}`}
          >
            <span className="flex items-center gap-2 font-display font-bold text-sm text-navy">
              <Icone className="w-4 h-4" /> {titre}
            </span>
            <span className="block text-xs text-ink-soft mt-0.5">{aide}</span>
          </button>
        ))}
      </div>

      {mode === "lignes" ? (
        <div className="flex flex-col gap-2">
          <div className="hidden sm:grid grid-cols-[1fr_80px_120px_110px_32px] gap-2 text-[11px] font-bold uppercase tracking-wide text-ink-soft px-1">
            <span>Désignation</span>
            <span>Qté</span>
            <span>Prix unit. HT</span>
            <span className="text-right">Total HT</span>
            <span />
          </div>
          {lignes.map((l, i) => (
            <div key={l.cle} className="grid grid-cols-[1fr_32px] sm:grid-cols-[1fr_80px_120px_110px_32px] gap-2 items-start rounded-lg sm:rounded-none border sm:border-0 border-line p-2 sm:p-0">
              <textarea name="designation" rows={1} value={l.designation} onChange={(e) => maj(l.cle, { designation: e.target.value })} placeholder={`Ligne ${i + 1} — ex. Remplacement contacteur KM1`} className={`${champ} resize-y min-h-[38px] col-span-1`} />
              <button type="button" onClick={() => setLignes((x) => (x.length > 1 ? x.filter((y) => y.cle !== l.cle) : [nouvelle()]))} aria-label="Supprimer la ligne" className="sm:order-last w-8 h-9 flex items-center justify-center rounded-lg text-ink-soft hover:text-red-ink hover:bg-red-fill">
                <Trash2 className="w-4 h-4" />
              </button>
              <div className="col-span-2 sm:col-span-1 grid grid-cols-3 sm:contents gap-2">
                <input name="quantite" inputMode="decimal" value={l.quantite} onChange={(e) => maj(l.cle, { quantite: e.target.value })} aria-label="Quantité" className={champ} />
                <input name="pu" inputMode="decimal" value={l.pu} onChange={(e) => maj(l.cle, { pu: e.target.value })} placeholder="0,00" aria-label="Prix unitaire HT" className={champ} />
                <span className="text-sm font-semibold text-right py-2 tabular-nums">{l.pu.trim() ? euros(nombre(l.quantite) * nombre(l.pu)) : "—"}</span>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setLignes((x) => [...x, nouvelle()])} className="inline-flex items-center gap-1.5 text-sm font-bold text-blue rounded-lg border border-dashed border-blue/50 px-3 py-1.5 hover:bg-blue-pale">
              <Plus className="w-4 h-4" /> Ajouter une ligne
            </button>
            {pieces.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  const p = pieces.find((x) => x.id === e.target.value);
                  if (p) setLignes((x) => [...x.filter((y) => y.designation.trim() || y.pu.trim()), { ...nouvelle(), designation: p.label }]);
                }}
                className="text-sm rounded-lg border border-line px-2 py-1.5 bg-surface max-w-[260px]"
                aria-label="Ajouter une pièce du stock"
              >
                <option value="">+ Pièce du stock…</option>
                {pieces.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-line pt-2">
            {sansPrix > 0 && <span className="text-xs text-orange-ink">{sansPrix} ligne(s) sans prix</span>}
            <span className="text-sm text-ink-soft">Total</span>
            <span className="font-display font-extrabold text-lg text-navy tabular-nums" data-total-devis="">
              {euros(total)}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {document && (
            <a href={document.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-blue underline">
              <FileText className="w-4 h-4" /> {document.nom ?? "Devis joint"} (actuel)
            </a>
          )}
          <EnvoiFichiers type="fichier" name="document" dossier="devis" max={1} libelle={document ? "Remplacer le devis (PDF ou photo)" : "Devis à joindre (PDF ou photo)"} />
          <label className="flex flex-col gap-1.5 max-w-xs">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Montant HT (facultatif)</span>
            <input name="montantDocument" inputMode="decimal" defaultValue={montantDocument ?? ""} placeholder="0,00" className={champ} />
          </label>
        </div>
      )}
    </div>
  );
}
