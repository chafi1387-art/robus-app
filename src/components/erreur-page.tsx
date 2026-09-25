"use client";

import { useEffect, useState } from "react";

// Phase 13b : page d'erreur ROBUS. Cas fréquent : une page restée ouverte
// pendant une mise à jour du serveur (ex. écran de connexion) — un simple
// rechargement suffit. On recharge donc automatiquement UNE fois (garde de
// 30 s pour ne jamais boucler), sinon on affiche les boutons.
const CLE = "robus-auto-reload";

export function ErreurPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [rechargement, setRechargement] = useState(false);
  useEffect(() => {
    try {
      const dernier = Number(sessionStorage.getItem(CLE) ?? 0);
      if (Date.now() - dernier > 30_000) {
        sessionStorage.setItem(CLE, String(Date.now()));
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRechargement(true);
        window.location.reload();
      }
    } catch {
      /* stockage indisponible : pas d'auto-rechargement */
    }
  }, []);

  if (rechargement) {
    return <div className="max-w-xl mx-auto my-16 text-center text-sm text-ink-soft">Mise à jour de la page…</div>;
  }
  return (
    <div className="max-w-xl mx-auto my-10 bg-white border border-line rounded-2xl p-7 flex flex-col gap-4 shadow-sm">
      <h1 className="font-display font-extrabold text-xl text-[#0b2545]">L&apos;opération n&apos;a pas pu aboutir</h1>
      <p className="text-sm text-ink-soft leading-relaxed">
        Rien n&apos;a été perdu de ce qui était déjà enregistré. Rechargez la page, vérifiez les informations saisies puis
        réessayez. Si le problème continue, notez l&apos;heure et prévenez l&apos;administrateur.
      </p>
      {error.digest && <p className="text-xs text-ink-soft">Référence : {error.digest}</p>}
      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-blue text-white px-4 py-2.5 text-sm font-bold">
          Recharger la page
        </button>
        <button type="button" onClick={() => retry()} className="rounded-xl border border-[#cfd8e3] px-4 py-2.5 text-sm font-semibold">
          Réessayer
        </button>
        <button type="button" onClick={() => window.history.back()} className="rounded-xl border border-[#cfd8e3] px-4 py-2.5 text-sm font-semibold">
          Revenir en arrière
        </button>
      </div>
    </div>
  );
}
