import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ROBUS — Dashboard Qualité ISO 9001",
  description: "Pilotage qualité ISO 9001 — ROBUS Liften Ascenseurs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-bg text-ink">{children}</body>
    </html>
  );
}
