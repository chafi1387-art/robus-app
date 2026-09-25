"use client";

/**
 * Phase 11 : bouton de soumission avec confirmation navigateur — utilisé
 * pour les actions irréversibles (ex. suppression définitive d'une pièce).
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
    <button
      type="submit"
      disabled={disabled}
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}
