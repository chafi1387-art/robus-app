"use client";

import { BoutonEnvoi } from "@/components/bouton-envoi";

/**
 * Phase 11 : bouton de soumission avec confirmation navigateur — utilisé
 * pour les actions irréversibles (ex. suppression définitive d'une pièce).
 * Phase 25 : roue + non cliquable pendant l'envoi.
 */
export function ConfirmSubmitButton({
  children,
  confirmMessage,
  className = "",
  disabled = false,
}: {
  children: React.ReactNode;
  confirmMessage: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <BoutonEnvoi disabled={disabled} className={className} confirmation={confirmMessage}>
      {children}
    </BoutonEnvoi>
  );
}
