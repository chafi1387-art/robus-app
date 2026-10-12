"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";

// Phase 31 : fenêtre (au centre de l'écran sur ordinateur, en bas sur
// téléphone) rendue dans <body>. Remplace les petits menus déroulants
// « Affecter » qui étaient coupés par les cartes / tableaux autour (le choix
// du technicien était caché ou minuscule).
// La fenêtre se ferme toute seule quand l'action a répondu (message ?ok= / ?erreur=).
export function Fenetre({
  libelle,
  titre,
  sousTitre,
  classeBouton,
  ouvertAuDepart = false,
  children,
}: {
  libelle: ReactNode;
  titre: string;
  sousTitre?: string;
  classeBouton: string;
  ouvertAuDepart?: boolean;
  children: ReactNode;
}) {
  const [ouvert, setOuvert] = useState(ouvertAuDepart);
  const params = useSearchParams();
  const cle = params.toString();
  // Quand l'action a renvoyé un message (?ok= / ?erreur=), on ferme la fenêtre.
  const [cleVue, setCleVue] = useState(cle);
  if (cle !== cleVue) {
    setCleVue(cle);
    if (params.get("ok") || params.get("erreur")) setOuvert(false);
  }

  useEffect(() => {
    if (!ouvert) return;
    const echap = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("keydown", echap);
    const avant = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", echap);
      document.body.style.overflow = avant;
    };
  }, [ouvert]);

  return (
    <>
      <button type="button" onClick={() => setOuvert(true)} className={classeBouton}>
        {libelle}
      </button>
      {ouvert &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={titre}>
            <button type="button" aria-label="Fermer" onClick={() => setOuvert(false)} className="absolute inset-0 bg-[rgba(11,37,69,0.55)]" />
            <div className="relative w-full sm:w-[min(30rem,calc(100vw-2rem))] max-h-[92vh] overflow-y-auto bg-surface rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="font-display font-extrabold text-lg text-navy">{titre}</h2>
                  {sousTitre && <p className="text-sm text-ink-soft mt-0.5">{sousTitre}</p>}
                </div>
                <button type="button" onClick={() => setOuvert(false)} aria-label="Fermer" className="w-10 h-10 -mr-1 -mt-1 rounded-xl flex items-center justify-center text-ink-soft hover:bg-blue-pale shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {children}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
