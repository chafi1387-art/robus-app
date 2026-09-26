import type { MetadataRoute } from "next";

// Phase 16 : application installable (PWA) — sans Google Play ni App Store.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ROBUS — Ascenseurs",
    short_name: "ROBUS",
    description: "Pilotage des projets, missions et qualité ISO 9001 — ROBUS Liften Ascenseurs",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#003366",
    theme_color: "#003366",
    lang: "fr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
