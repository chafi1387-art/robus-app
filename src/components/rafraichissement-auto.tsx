"use client";

import { useEtatDirect } from "@/components/temps-reel";

// Phase 18 : indicateur « mise à jour automatique ».
// Phase 25 : la page est mise à jour en temps réel (signal du serveur) —
// ce composant affiche seulement l'état de la connexion et l'heure de la
// dernière mise à jour.
export function RafraichissementAuto(_props: { secondes?: number }) {
  const { connecte, derniere } = useEtatDirect();
  const heure = derniere
    ? new Date(derniere).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft" data-direct={connecte ? "oui" : "non"}>
      <span className={`w-2 h-2 rounded-full ${connecte ? "bg-green animate-pulse" : "bg-orange"}`} />
      {connecte ? "En direct" : "Reconnexion…"}
      {heure ? ` · mis à jour à ${heure}` : ""}
    </span>
  );
}
