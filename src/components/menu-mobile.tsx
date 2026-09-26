"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import { NavBureau } from "@/components/nav-bureau";

// Phase 15 : sur téléphone/tablette, le menu latéral se replie derrière ☰.
// Rendu dans <body> (portail) : l'en-tête a un flou d'arrière-plan qui
// empêcherait le panneau de couvrir tout l'écran.
export function MenuMobile({ role, badges }: { role: string; badges: { panne: number; nonAffectees: number } }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-label="Ouvrir le menu"
        className="lg:hidden w-10 h-10 -ml-1 rounded-xl flex items-center justify-center text-navy hover:bg-blue-pale"
      >
        <Menu className="w-6 h-6" />
      </button>
      {ouvert &&
        createPortal(
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Fermer le menu" onClick={() => setOuvert(false)} className="absolute inset-0 bg-[rgba(11,37,69,0.5)]" />
          <aside className="absolute left-0 top-0 bottom-0 w-[82%] max-w-[300px] bg-navy text-blue-pale flex flex-col shadow-2xl">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-robus.png" alt="ROBUS" className="h-8 w-auto object-contain" />
              <div className="flex-1 font-display font-extrabold text-white text-sm tracking-wide">ROBUS</div>
              <button type="button" onClick={() => setOuvert(false)} aria-label="Fermer le menu" className="w-9 h-9 rounded-lg flex items-center justify-center text-white hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOuvert(false); }}>
              <NavBureau role={role} badges={badges} />
            </div>
          </aside>
        </div>,
          document.body
        )}
    </>
  );
}
