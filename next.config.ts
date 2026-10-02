import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Par défaut Next limite le corps d'une Server Action à 1 Mo, ce qui
      // bloque tout upload de photo. Phase 5 : le rapport de fin de mission
      // accepte plusieurs photos obligatoires (8 Mo max chacune) dans le
      // même envoi. Phase 6 : Documents & Formations accepte désormais
      // l'upload direct de vidéos (jusqu'à 200 Mo) — on relève encore la
      // limite en conséquence (marge incluse).
      bodySizeLimit: "250mb",
    },
    // Phase 21 : une page déjà visitée se réaffiche instantanément pendant
    // 30 s (retour arrière, changement d'onglet). Toute action (envoi,
    // validation…) vide ce cache : les données restent à jour.
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default nextConfig;
