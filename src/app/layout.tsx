import type { Metadata, Viewport } from "next";
// Refonte premium : typographies auto-hébergées (paquets @fontsource) —
// aucun appel à Google, ni au build ni dans le navigateur.
import "@fontsource-variable/manrope/wght.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ROBUS — Dashboard Qualité ISO 9001",
  description: "Pilotage qualité ISO 9001 — ROBUS Liften Ascenseurs",
};

export const viewport: Viewport = {
  themeColor: "#003366",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-bg text-ink">{children}</body>
    </html>
  );
}
