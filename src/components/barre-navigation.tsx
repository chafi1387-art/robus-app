"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Phase 25 : fine barre en haut de l'écran dès le clic sur un lien →
// on voit tout de suite que la page suivante arrive.
export function BarreNavigation() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [largeur, setLargeur] = useState<number | null>(null);
  const minuterie = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/uploads/") || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setLargeur(15);
      if (minuterie.current) clearInterval(minuterie.current);
      minuterie.current = setInterval(() => setLargeur((l) => (l === null ? null : Math.min(88, l + (90 - l) * 0.12))), 200);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (minuterie.current) clearInterval(minuterie.current);
    minuterie.current = null;
    // Navigation terminée (changement d'adresse) : la barre se complète puis disparaît.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLargeur((l) => (l === null ? null : 100));
    const t = setTimeout(() => setLargeur(null), 300);
    return () => clearTimeout(t);
  }, [pathname, sp]);

  if (largeur === null) return null;
  return <div className="barre-navigation print:hidden" style={{ width: `${largeur}%`, opacity: largeur >= 100 ? 0 : 1 }} aria-hidden="true" />;
}
