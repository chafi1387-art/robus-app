"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Phase 18 : met la page à jour toute seule (mission en direct) — en pause
// quand l'onglet n'est pas visible.
export function RafraichissementAuto({ secondes = 15 }: { secondes?: number }) {
  const router = useRouter();
  const [maj, setMaj] = useState<string>("");
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setMaj(new Date().toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    const t = setInterval(tick, secondes * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, secondes]);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft">
      <span className="w-2 h-2 rounded-full bg-red-ink animate-pulse" />
      Mise à jour automatique{maj ? ` · ${maj}` : ` toutes les ${secondes} s`}
    </span>
  );
}
