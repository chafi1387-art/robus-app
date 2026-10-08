"use client";

import { Printer } from "lucide-react";

export function BoutonImprimer({ libelle = "Imprimer l'étiquette", icone }: { libelle?: string; icone?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold font-display bg-blue text-white hover:bg-blue-light print:hidden"
    >
      {icone ?? <Printer className="w-4 h-4" />} {libelle}
    </button>
  );
}
