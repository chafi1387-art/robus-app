"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

// Phase 19 : message de retour d'une action (?erreur=… ou ?ok=…), affiché en
// haut de n'importe quelle page du bureau — évite l'écran d'erreur générique.
export function BandeauMessages() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const erreur = sp.get("erreur");
  const ok = sp.get("ok");
  if (!erreur && !ok) return null;
  // Pages qui affichent déjà elles-mêmes leurs messages.
  if (pathname === "/responsable/techniciens" || pathname.startsWith("/responsable/observateurs")) return null;
  // Certaines pages gèrent déjà leurs propres codes courts (ex. « telephone »).
  if (erreur && erreur.length < 16 && !erreur.includes(" ")) return null;
  function fermer() {
    const p = new URLSearchParams(sp.toString());
    p.delete("erreur");
    p.delete("ok");
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }
  return (
    <div
      role={erreur ? "alert" : "status"}
      className={`mb-4 flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium ${erreur ? "bg-red-fill text-red-ink" : "bg-green-fill text-green-ink"}`}
    >
      <span className="flex-1">{erreur ?? ok}</span>
      <button type="button" onClick={fermer} aria-label="Fermer" className="shrink-0 opacity-70 hover:opacity-100">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
