"use client";

import { useState } from "react";
import { BoutonEnvoi } from "@/components/bouton-envoi";

// Phase 18 : choix des appareils, des informations partagées (droits), du
// modèle prêt à l'emploi et de la date de fin d'accès d'un observateur.

type Droit = { id: string; label: string; aide: string };
type Appareil = { id: string; numeroInterne: string; adresse: string | null; marque: string | null };

export function FormulaireObservateur({
  action,
  droits,
  modeles,
  appareils,
  clientId,
  observateurId,
  initial,
  creation,
}: {
  action: (fd: FormData) => void | Promise<void>;
  droits: Droit[];
  modeles: Record<string, { label: string; droits: string[]; joursAcces?: number }>;
  appareils: Appareil[];
  clientId: string;
  observateurId?: string;
  initial: { modele: string; droits: string[]; appareilIds: string[]; dateFin: string; histo12: boolean };
  creation: boolean;
}) {
  const [modele, setModele] = useState(initial.modele);
  const [coches, setCoches] = useState<Set<string>>(new Set(initial.droits));
  const [apps, setApps] = useState<Set<string>>(new Set(initial.appareilIds));
  const [dateFin, setDateFin] = useState(initial.dateFin);
  const [histo12, setHisto12] = useState(initial.histo12);

  function choisirModele(m: string) {
    setModele(m);
    const def = modeles[m];
    if (!def || m === "personnalise") return;
    setCoches(new Set(def.droits));
    if (def.joursAcces) {
      // Appelé au clic (pas pendant le rendu).
      // eslint-disable-next-line react-hooks/purity
      const d = new Date(Date.now() + def.joursAcces * 86400000);
      setDateFin(d.toISOString().slice(0, 10));
    } else {
      setDateFin("");
    }
  }
  function basculer(set: Set<string>, id: string, maj: (s: Set<string>) => void) {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    maj(n);
  }
  const champ = "w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface";
  const etiquette = "text-xs font-bold uppercase tracking-wide text-ink-soft";

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="clientId" value={clientId} />
      {observateurId && <input type="hidden" name="observateurId" value={observateurId} />}
      <input type="hidden" name="modele" value={modele} />

      {creation && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={etiquette}>Nom *</span>
            <input name="nom" required minLength={2} className={champ} placeholder="Ex. Syndic Dupont" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={etiquette}>Email *</span>
            <input name="email" type="email" required className={champ} placeholder="nom@exemple.be" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={etiquette}>Téléphone</span>
            <input name="telephone" className={champ} placeholder="+32 …" />
          </label>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <span className={etiquette}>Modèle prêt à l&apos;emploi</span>
        <div className="flex flex-wrap gap-2">
          {Object.entries(modeles).map(([id, m]) => (
            <button
              key={id}
              type="button"
              onClick={() => choisirModele(id)}
              className={`px-3.5 py-2 rounded-xl text-sm font-bold border ${modele === id ? "bg-navy text-white border-navy" : "bg-surface border-line text-ink hover:bg-blue-pale"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className={etiquette}>A — Appareils ({apps.size}/{appareils.length})</span>
          <div className="flex gap-3 text-xs font-bold">
            <button type="button" className="text-blue" onClick={() => setApps(new Set(appareils.map((a) => a.id)))}>
              Tout le client
            </button>
            <button type="button" className="text-ink-soft" onClick={() => setApps(new Set())}>
              Aucun
            </button>
          </div>
        </div>
        {appareils.length === 0 ? (
          <p className="text-sm text-ink-soft">Ce client n&apos;a encore aucun appareil (via un site ou un projet).</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {appareils.map((a) => (
              <label key={a.id} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer ${apps.has(a.id) ? "border-blue bg-blue-pale/40" : "border-line"}`}>
                <input type="checkbox" name="appareilIds" value={a.id} checked={apps.has(a.id)} onChange={() => basculer(apps, a.id, setApps)} className="mt-1" />
                <span className="text-sm">
                  <span className="font-bold">{a.numeroInterne}</span>
                  {a.marque ? <span className="text-ink-soft"> · {a.marque}</span> : null}
                  <span className="block text-xs text-ink-soft">{a.adresse ?? "Adresse non renseignée"}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <span className={etiquette}>B — Informations partagées ({coches.size})</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {droits.map((d) => (
            <label key={d.id} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer ${coches.has(d.id) ? "border-blue bg-blue-pale/40" : "border-line"}`}>
              <input
                type="checkbox"
                name="droits"
                value={d.id}
                checked={coches.has(d.id)}
                onChange={() => {
                  basculer(coches, d.id, setCoches);
                  setModele("personnalise");
                }}
                className="mt-1"
              />
              <span className="text-sm">
                <span className="font-semibold">{d.label}</span>
                <span className="block text-xs text-ink-soft">{d.aide}</span>
                {d.id === "historique" && coches.has("historique") && (
                  <span className="mt-1.5 flex items-center gap-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" name="historique_12_mois" checked={histo12} onChange={(e) => setHisto12(e.target.checked)} />
                    Seulement les 12 derniers mois
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-1.5 max-w-xs">
        <span className={etiquette}>C — Fin d&apos;accès (facultatif)</span>
        <input type="date" name="dateFin" value={dateFin} onChange={(e) => setDateFin(e.target.value)} className={champ} />
        <span className="text-xs text-ink-soft">Vide = accès permanent (jusqu&apos;à ce que vous le retiriez).</span>
      </section>

      <BoutonEnvoi type="submit" className="self-start bg-blue hover:bg-blue-light text-white font-display font-bold text-sm rounded-lg px-5 py-3">
        {creation ? "Créer et envoyer l'invitation" : "Enregistrer les droits"}
      </BoutonEnvoi>
    </form>
  );
}
