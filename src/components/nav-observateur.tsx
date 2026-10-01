"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Building, User } from "lucide-react";

// Phase 18 : barre du bas de l'espace Observateur.
export function NavObservateur({ tempsReel }: { tempsReel: boolean }) {
  const pathname = usePathname();
  const onglets = [
    { href: "/observateur", label: "Mes ascenseurs", icon: Building, actif: pathname === "/observateur" || pathname.startsWith("/observateur/appareils") || pathname.startsWith("/observateur/interventions") },
    ...(tempsReel ? [{ href: "/observateur/en-cours", label: "En cours", icon: Activity, actif: pathname.startsWith("/observateur/en-cours") }] : []),
    { href: "/observateur/compte", label: "Mon accès", icon: User, actif: pathname.startsWith("/observateur/compte") },
  ];
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-lg mx-auto grid" style={{ gridTemplateColumns: `repeat(${onglets.length}, minmax(0, 1fr))` }}>
        {onglets.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-1 pt-2.5 pb-2 ${t.actif ? "text-blue" : "text-ink-soft"}`}>
              <Icon className="w-[22px] h-[22px]" />
              <span className="text-[11.5px] font-semibold">{t.label}</span>
              <span className={`h-[3px] w-6 rounded-full ${t.actif ? "bg-blue" : "bg-transparent"}`} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
