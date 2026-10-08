"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

// ==========================================================================
// Phase 25 — Bouton d'envoi avec retour visuel immédiat.
// Dès le clic : roue + bouton grisé et non cliquable tant que le serveur n'a
// pas répondu → plus de double clic, on voit que le clic est pris en compte.
// Les autres boutons du même formulaire sont aussi bloqués pendant l'envoi.
// ==========================================================================

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Texte affiché pendant l'envoi (sinon le texte du bouton est gardé). */
  enCours?: string;
  /** Demande une confirmation avant l'envoi. */
  confirmation?: string;
};

export function BoutonEnvoi({ children, className = "", enCours, confirmation, disabled, onClick, type = "submit", ...reste }: Props) {
  const { pending } = useFormStatus();
  const [clique, setClique] = useState(false);
  // Fin de l'envoi : on oublie le clic (synchronisation avec l'état du formulaire).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!pending) setClique(false);
  }, [pending]);
  const actif = pending && clique;
  return (
    <button
      {...reste}
      type={type}
      disabled={disabled || pending}
      aria-busy={actif || undefined}
      data-envoi={actif ? "" : undefined}
      onClick={(e) => {
        if (confirmation && !window.confirm(confirmation)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
        if (!e.defaultPrevented) setClique(true);
      }}
      className={`${className} relative disabled:cursor-wait ${pending && !actif ? "opacity-60" : ""}`}
    >
      {actif ? (
        <>
          <span className="bouton-roue" aria-hidden="true" />
          {enCours ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
