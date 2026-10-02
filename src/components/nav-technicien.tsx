"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, GraduationCap, Timer, TriangleAlert, User } from "lucide-react";

// Phase 21 : bouton rouge « Signaler » au centre de la barre — accessible
// depuis n'importe quel écran (accident, véhicule, météo…).
const GAUCHE = [
  { href: "/technicien", label: "Missions", icon: CalendarDays },
  { href: "/technicien/heures", label: "Heures", icon: Timer },
];
const DROITE = [
  { href: "/technicien/formations", label: "Formations", icon: GraduationCap },
  { href: "/technicien/profil", label: "Profil", icon: User },
];

export function NavTechnicien() {
  const pathname = usePathname();
  const onglet = (t: (typeof GAUCHE)[number]) => {
    const on = t.href === "/technicien" ? pathname === t.href || pathname.startsWith("/technicien/interventions") : pathname.startsWith(t.href);
    const Icon = t.icon;
    return (
      <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-1 pt-2.5 pb-2 ${on ? "text-blue" : "text-ink-soft"}`}>
        <Icon className="w-[22px] h-[22px]" strokeWidth={on ? 2.4 : 1.9} />
        <span className="text-[11.5px] font-semibold">{t.label}</span>
        <span className={`h-[3px] w-6 rounded-full ${on ? "bg-blue" : "bg-transparent"}`} />
      </Link>
    );
  };
  const signalerActif = pathname.startsWith("/technicien/signal");
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-lg mx-auto grid grid-cols-5">
        {GAUCHE.map(onglet)}
        <Link href="/technicien/signaler" aria-label="Signaler un problème" className="flex flex-col items-center gap-1 pb-2 -mt-4">
          <span
            className={`w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg ring-4 ring-surface ${signalerActif ? "bg-red-ink" : "bg-red"}`}
          >
            <TriangleAlert className="w-7 h-7" strokeWidth={2.4} />
          </span>
          <span className="text-[11.5px] font-bold text-red-ink">Signaler</span>
        </Link>
        {DROITE.map(onglet)}
      </div>
    </nav>
  );
}
