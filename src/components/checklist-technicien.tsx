"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { repondreTache } from "@/app/technicien/checklist-actions";
import { compter, evaluerMesure, libelleLimites, type TacheChecklist } from "@/lib/checklists-regles";

// Phase 23 : la checklist sur le téléphone du technicien. ✓ = conforme en un
// geste ; ✗ = non conforme, il écrit pourquoi ; mesure = valeur + limites.
// Chaque réponse est enregistrée immédiatement.

type Liste = { id: string; nom: string; taches: TacheChecklist[] };

export function ChecklistTechnicien({ listes, modifiable }: { listes: Liste[]; modifiable: boolean }) {
  const [taches, setTaches] = useState<Record<string, TacheChecklist>>(() =>
    Object.fromEntries(listes.flatMap((l) => l.taches).map((t) => [t.id, t]))
  );
  const toutes = Object.values(taches);
  const c = compter(toutes);
  const pct = c.total ? Math.round((c.faites / c.total) * 100) : 0;
  const maj = (t: TacheChecklist) => setTaches((s) => ({ ...s, [t.id]: t }));

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">
            {c.faites}/{c.total} tâche(s)
            {c.nok > 0 && <span className="text-red-ink"> · {c.nok} ✗</span>}
          </span>
          {c.manquantes > 0 ? (
            <span className="text-xs text-orange-ink font-semibold">{c.manquantes} obligatoire(s) restante(s)</span>
          ) : (
            <span className="text-xs text-green-ink font-semibold">Complète ✓</span>
          )}
        </div>
        <div className="h-2 rounded-full bg-line mt-1.5 overflow-hidden">
          <div className={`h-full ${c.nok ? "bg-orange" : "bg-green-ink"}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      {listes.map((l) => (
        <div key={l.id} className="flex flex-col gap-1">
          {listes.length > 1 && <div className="text-xs font-bold uppercase tracking-wide text-navy mt-1">{l.nom}</div>}
          {l.taches.map((t0, i) => {
            const t = taches[t0.id];
            const nouvelleSection = t.section && t.section !== l.taches[i - 1]?.section;
            return (
              <div key={t.id}>
                {nouvelleSection && <div className="text-[11px] font-bold uppercase tracking-wide text-ink-soft mt-2 mb-1">{t.section}</div>}
                <Tache t={t} modifiable={modifiable} onMaj={maj} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Tache({ t, modifiable, onMaj }: { t: TacheChecklist; modifiable: boolean; onMaj: (t: TacheChecklist) => void }) {
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvrirNok, setOuvrirNok] = useState(false);
  const [commentaire, setCommentaire] = useState(t.commentaire ?? "");
  const [valeur, setValeur] = useState(t.valeur ?? "");
  const mesure = t.type === "mesure";
  const apercu = mesure && valeur !== "" && !Number.isNaN(Number(valeur.replace(",", "."))) ? evaluerMesure(Number(valeur.replace(",", ".")), t.valeurMin, t.valeurMax) : null;
  // Mesure déjà enregistrée et inchangée : pas besoin de ré-afficher le formulaire.
  const mesureModifiee = !t.resultat || Number(valeur.replace(",", ".")) !== Number(t.valeur);
  const besoinCommentaire = (mesure && apercu === "nok" && mesureModifiee) || (!mesure && ouvrirNok);

  const envoyer = (resultat?: "ok" | "nok") => {
    setErreur(null);
    demarrer(async () => {
      const r = await repondreTache({ tacheId: t.id, resultat, valeur: mesure ? valeur : undefined, commentaire: commentaire || undefined });
      if (!r.ok) {
        setErreur(r.erreur);
        return;
      }
      setOuvrirNok(false);
      onMaj({ ...t, resultat: r.resultat, valeur: r.valeur, commentaire: r.commentaire, rempliLe: new Date() });
    });
  };

  const cadre = t.resultat === "ok" ? "border-green/50 bg-green-fill/40" : t.resultat === "nok" ? "border-red/50 bg-red-fill/40" : "border-line bg-surface";
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${cadre} ${enCours ? "opacity-60" : ""}`} data-tache={t.id}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 text-[14.5px] leading-snug">
          {t.libelle}
          {t.obligatoire ? <span className="text-red-ink"> *</span> : null}
          {mesure && <span className="block text-xs text-ink-soft">Mesure {libelleLimites(t)}</span>}
          {t.resultat === "nok" && t.commentaire && !ouvrirNok && <span className="block text-xs text-red-ink mt-0.5">✗ {t.commentaire}</span>}
          {mesure && t.valeur && <span className={`block text-xs font-semibold ${t.resultat === "nok" ? "text-red-ink" : "text-green-ink"}`}>Relevé : {Number(t.valeur).toLocaleString("fr-BE")} {t.unite ?? ""}</span>}
        </div>
        {!mesure && (
          <div className="flex gap-1.5 shrink-0">
            <button
              type="button"
              aria-label="Conforme"
              disabled={!modifiable || enCours}
              onClick={() => envoyer("ok")}
              className={`w-11 h-11 rounded-xl flex items-center justify-center border-2 ${t.resultat === "ok" ? "bg-green-ink border-green-ink text-white" : "border-green/60 text-green-ink bg-white"} disabled:opacity-50`}
            >
              <Check className="w-6 h-6" strokeWidth={3} />
            </button>
            <button
              type="button"
              aria-label="Non conforme"
              disabled={!modifiable || enCours}
              onClick={() => {
                setOuvrirNok(true);
                setErreur(null);
              }}
              className={`w-11 h-11 rounded-xl flex items-center justify-center border-2 ${t.resultat === "nok" ? "bg-red border-red text-white" : "border-red/50 text-red-ink bg-white"} disabled:opacity-50`}
            >
              <X className="w-6 h-6" strokeWidth={3} />
            </button>
          </div>
        )}
      </div>
      {mesure && modifiable && (
        <div className="flex items-center gap-2 mt-2">
          <input
            type="text"
            inputMode="decimal"
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            placeholder="Valeur"
            aria-label={`Valeur mesurée — ${t.libelle}`}
            className="w-28 rounded-lg border border-line px-3 py-2 text-[15px] bg-white"
          />
          <span className="text-sm text-ink-soft">{t.unite}</span>
          {apercu && <span className={`text-sm font-bold ${apercu === "ok" ? "text-green-ink" : "text-red-ink"}`}>{apercu === "ok" ? "✓ conforme" : "✗ hors limite"}</span>}
          {!besoinCommentaire && mesureModifiee && (
            <button type="button" disabled={enCours || valeur === ""} onClick={() => envoyer()} className="ml-auto rounded-lg bg-blue text-white font-bold text-sm px-3 py-2 disabled:opacity-50">
              Enregistrer
            </button>
          )}
        </div>
      )}
      {modifiable && besoinCommentaire && (
        <div className="flex flex-col gap-2 mt-2">
          <textarea
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Pourquoi ce point n'est pas conforme ?"
            aria-label={`Commentaire — ${t.libelle}`}
            className="rounded-lg border border-red/40 px-3 py-2 text-[15px] bg-white"
          />
          <div className="flex gap-2">
            <button type="button" disabled={enCours} onClick={() => envoyer(mesure ? undefined : "nok")} className="flex-1 rounded-lg bg-red text-white font-bold text-sm py-2.5 disabled:opacity-50">
              Enregistrer ✗ non conforme
            </button>
            {!mesure && (
              <button type="button" onClick={() => setOuvrirNok(false)} className="rounded-lg border border-line px-3 text-sm font-semibold">
                Annuler
              </button>
            )}
          </div>
        </div>
      )}
      {erreur && <p className="text-xs text-red-ink font-semibold mt-1.5">{erreur}</p>}
    </div>
  );
}
