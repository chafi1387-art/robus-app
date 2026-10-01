"use client";

import { Printer } from "lucide-react";

export function BoutonImprimer() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold font-display bg-blue text-white hover:bg-blue-light"
    >
      <Printer className="w-4 h-4" /> Imprimer l&apos;étiquette
    </button>
  );
}
