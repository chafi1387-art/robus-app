"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2, Undo2, X } from "lucide-react";
import { annulerRetrait } from "@/app/annulation/actions";

// Phase 19 : message de retour d'une action (?erreur=… ou ?ok=…).
// Phase 25 : affiché en bas de l'écran (toujours visible, même en bas de
// page), dans les trois espaces ; disparaît seul après quelques secondes ;
// bouton « Annuler » quand l'action le permet (ex. photo retirée).

// Pages qui affichent déjà elles-mêmes leurs erreurs dans le formulaire.
const ERREURS_INLINE: Record<string, (p: string) => boolean> = {
  bureau: (p) => p === "/responsable/techniciens" || p.startsWith("/responsable/observateurs/"),
  technicien: (p) => p === "/technicien/signaler" || p === "/technicien/heures" || p.startsWith("/technicien/formations/"),
  observateur: (p) => p.startsWith("/observateur/demandes/") || p.startsWith("/observateur/appareils/") || p.startsWith("/observateur/interventions/"),
};

export function BandeauMessages({ espace = "bureau" }: { espace?: "bureau" | "technicien" | "observateur" }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [enCours, demarrer] = useTransition();
  const [retour, setRetour] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  let erreur = sp.get("erreur");
  const ok = sp.get("ok");
  const annuler = sp.get("annuler");
  // Certaines pages gèrent déjà leurs propres codes courts (ex. « telephone »).
  if (erreur && ((erreur.length < 16 && !erreur.includes(" ")) || ERREURS_INLINE[espace]?.(pathname))) erreur = null;
  const message = retour ?? (erreur ? { type: "erreur" as const, texte: erreur } : ok ? { type: "ok" as const, texte: ok } : null);
  const cle = `${pathname}|${erreur}|${ok}|${annuler}|${retour?.texte ?? ""}`;

  function fermer() {
    setRetour(null);
    const p = new URLSearchParams(window.location.search);
    if (!p.has("erreur") && !p.has("ok") && !p.has("annuler")) return;
    p.delete("erreur");
    p.delete("ok");
    p.delete("annuler");
    const q = p.toString();
    router.replace(`${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`, { scroll: false });
  }

  // Un message de réussite disparaît tout seul (plus longtemps s'il peut être annulé).
  const typeMessage = message?.type;
  useEffect(() => {
    if (typeMessage !== "ok") return;
    const t = setTimeout(fermer, annuler && !retour ? 9000 : 4500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, typeMessage]);

  if (!message) return null;

  function onAnnuler() {
    if (!annuler) return;
    demarrer(async () => {
      const r = await annulerRetrait(annuler);
      if (r.erreur) setRetour({ type: "erreur", texte: r.erreur });
      else {
        setRetour({ type: "ok", texte: r.message ?? "Annulé ✓" });
        router.refresh();
      }
    });
  }

  const bas = espace === "bureau" ? "bottom-5" : "bottom-[calc(5.5rem+env(safe-area-inset-bottom))]";
  return (
    <div className={`print:hidden fixed inset-x-0 ${bas} z-[60] flex justify-center px-3 pointer-events-none`}>
      <div
        role={message.type === "erreur" ? "alert" : "status"}
        aria-live="polite"
        data-toast={message.type}
        className={`toast-entree pointer-events-auto max-w-lg w-full flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ring-1 ${
          message.type === "erreur" ? "bg-red-fill text-red-ink ring-red-ink/20" : "bg-navy text-white ring-black/10"
        }`}
      >
        {message.type === "ok" && <Check className="w-5 h-5 shrink-0 text-green" strokeWidth={3} />}
        <span className="flex-1">{message.texte}</span>
        {message.type === "ok" && annuler && !retour && (
          <button
            type="button"
            onClick={onAnnuler}
            disabled={enCours}
            className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-white/15 hover:bg-white/25 px-2.5 py-1 text-xs font-bold"
          >
            {enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />} Annuler
          </button>
        )}
        <button type="button" onClick={fermer} aria-label="Fermer" className="shrink-0 opacity-70 hover:opacity-100">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
