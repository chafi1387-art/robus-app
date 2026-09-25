"use client";

// Phase 13b : page d'erreur à l'intérieur de l'application (le menu reste
// visible) au lieu de l'écran noir « This page couldn't load ».
export default function Erreur({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const ancienneVersion = /Server Action|older or newer deployment/i.test(error.message ?? "");
  return (
    <div className="max-w-xl mx-auto my-10 bg-white border border-line rounded-2xl p-7 flex flex-col gap-4 shadow-sm">
      <h1 className="font-display font-extrabold text-xl text-[#0b2545]">
        {ancienneVersion ? "La page a été mise à jour" : "L'opération n'a pas pu aboutir"}
      </h1>
      <p className="text-sm text-ink-soft leading-relaxed">
        {ancienneVersion
          ? "Une nouvelle version de l'application a été installée pendant que cette page était ouverte. Rechargez la page puis recommencez."
          : "Rien n'a été perdu de ce qui était déjà enregistré. Vérifiez les informations saisies (par exemple un email déjà utilisé) puis réessayez. Si le problème continue, notez l'heure et prévenez l'administrateur."}
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
