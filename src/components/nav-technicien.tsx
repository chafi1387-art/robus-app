"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, GraduationCap, Timer, User } from "lucide-react";

const TABS = [
  { href: "/technicien", label: "Missions", icon: CalendarDays },
  { href: "/technicien/heures", label: "Heures", icon: Timer },
  { href: "/technicien/formations", label: "Formations", icon: GraduationCap },
  { href: "/technicien/profil", label: "Profil", icon: User },
];

export function NavTechnicien() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-lg mx-auto grid grid-cols-4">
        {TABS.map((t) => {
          const on = t.href === "/technicien" ? pathname === t.href || pathname.startsWith("/technicien/interventions") : pathname.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-1 pt-2.5 pb-2 ${on ? "text-blue" : "text-ink-soft"}`}>
              <Icon className="w-[22px] h-[22px]" strokeWidth={on ? 2.4 : 1.9} />
              <span className="text-[11.5px] font-semibold">{t.label}</span>
              <span className={`h-[3px] w-6 rounded-full ${on ? "bg-blue" : "bg-transparent"}`} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
