"use client";

import { useState } from "react";
import { inputClass } from "@/components/ui";

// Phase 29 — « Mission pour : un appareil | une prestation ».
// Une mission « à la carte » (nettoyage, démolition, câblage…) est liée à une
// prestation ponctuelle du projet au lieu d'un appareil. La prestation peut
// être créée ici même : depuis le catalogue ou avec un nom libre.

type Option = { id: string; libelle: string };

export function ChoixCibleMission({
  appareils,
  prestations,
  catalogue,
  className = "",
}: {
  appareils: Option[];
  prestations: Option[];
  catalogue: Option[];
  className?: string;
}) {
  const [cible, setCible] = useState<"appareil" | "prestation">(appareils.length ? "appareil" : "prestation");
  const [prestationId, setPrestationId] = useState<string>(prestations[0]?.id ?? "nouvelle");
  const [catalogueId, setCatalogueId] = useState<string>(catalogue[0]?.id ?? "libre");
  const nouvelle = prestationId === "nouvelle";

  const bouton = (valeur: "appareil" | "prestation", texte: string, desactive: boolean) => (
    <button
      type="button"
      disabled={desactive}
      onClick={() => setCible(valeur)}
      aria-pressed={cible === valeur}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        cible === valeur ? "bg-navy text-white border-navy" : "bg-surface text-ink border-line hover:bg-blue-pale"
      }`}
    >
      {texte}
    </button>
  );

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <input type="hidden" name="cible" value={cible} />
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-ink-soft">Mission pour</span>
        <div className="flex gap-2 max-w-md">
          {bouton("appareil", "Un appareil", appareils.length === 0)}
          {bouton("prestation", "Une prestation", false)}
        </div>
        {appareils.length === 0 && (
          <span className="text-xs text-ink-soft">Aucun appareil dans ce projet : la mission sera liée à une prestation.</span>
        )}
      </div>

      {cible === "appareil" ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-ink-soft">Appareil</span>
            <select name="appareilId" required className={inputClass}>
              {appareils.map((a) => (
                <option key={a.id} value={a.id}>{a.libelle}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-ink-soft">Type de mission</span>
            <select name="type" className={inputClass} defaultValue="preventive">
              <option value="preventive">Maintenance préventive</option>
              <option value="corrective">Dépannage / corrective</option>
              <option value="systematique">Systématique / contrôle</option>
            </select>
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-ink-soft">Prestation</span>
            <select name="prestationId" required className={inputClass} value={prestationId} onChange={(e) => setPrestationId(e.target.value)}>
              {prestations.length > 0 && (
                <optgroup label="Prestations du projet">
                  {prestations.map((p) => (
                    <option key={p.id} value={p.id}>{p.libelle}</option>
                  ))}
                </optgroup>
              )}
              <option value="nouvelle">＋ Nouvelle prestation…</option>
            </select>
          </label>
          {nouvelle && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-ink-soft">Depuis le catalogue</span>
                <select name="nouveauCatalogueId" className={inputClass} value={catalogueId} onChange={(e) => setCatalogueId(e.target.value)}>
                  {catalogue.map((c) => (
                    <option key={c.id} value={c.id}>{c.libelle}</option>
                  ))}
                  <option value="libre">Autre — saisir le nom</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-ink-soft">
                  {catalogueId === "libre" ? "Nom de la prestation *" : "Précision (facultatif)"}
                </span>
                <input
                  name="nouvellePrestationNom"
                  required={catalogueId === "libre"}
                  maxLength={200}
                  className={inputClass}
                  placeholder={catalogueId === "libre" ? "Ex. Nettoyage de la cuvette" : "Ex. Démolition ancienne cabine"}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
