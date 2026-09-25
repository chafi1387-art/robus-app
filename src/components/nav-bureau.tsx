"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive, ArrowUpDown, BookOpen, Building2, CalendarDays, ClipboardList, FileText, FolderKanban,
  HardHat, LayoutDashboard, ListChecks, MapPin, OctagonAlert, Package, Presentation, Receipt, Ruler,
  ScrollText, ShieldCheck, Smile, Target, Timer, TriangleAlert, UserCog, UserSearch, Search,
} from "lucide-react";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean; badge?: "panne" | "nonAffectees" };

// Refonte Phase 13 : plus d'entrée « Interventions » — les missions vivent
// dans chaque Projet ; « Planning des missions » les montre toutes.
const NAV_GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Pilotage",
    items: [
      { href: "/responsable", label: "Tableau de bord", icon: LayoutDashboard },
      { href: "/responsable/projets", label: "Projets", icon: FolderKanban },
      { href: "/responsable/interventions", label: "Planning des missions", icon: CalendarDays, badge: "nonAffectees" },
      { href: "/responsable/sous-traitance", label: "Sous-traitance", icon: Timer },
    ],
  },
  {
    title: "Ressources",
    items: [
      { href: "/responsable/clients", label: "Clients", icon: Building2 },
      { href: "/responsable/sites", label: "Sites", icon: MapPin },
      { href: "/responsable/appareils", label: "Appareils", icon: ArrowUpDown, badge: "panne" },
      { href: "/responsable/techniciens", label: "Équipe technique", icon: HardHat },
      { href: "/responsable/stock", label: "Stock", icon: Package },
      { href: "/responsable/prestations-catalogue", label: "Catalogue prestations", icon: ClipboardList },
      { href: "/responsable/garanties", label: "Garanties", icon: ShieldCheck },
      { href: "/responsable/devis", label: "Devis", icon: Receipt },
      { href: "/responsable/documents", label: "Documents & formations", icon: BookOpen },
    ],
  },
  {
    title: "Qualité ISO 9001",
    items: [
      { href: "/responsable/score-iso", label: "Score ISO 9001", icon: Target },
      { href: "/responsable/non-conformites", label: "Non-conformités", icon: OctagonAlert },
      { href: "/responsable/checklists", label: "Checklists", icon: ListChecks },
      { href: "/responsable/audits", label: "Audits", icon: Search },
      { href: "/responsable/auditeurs", label: "Auditeurs", icon: UserSearch },
      { href: "/responsable/risques", label: "Risques & opportunités", icon: TriangleAlert },
      { href: "/responsable/etalonnage", label: "Étalonnage", icon: Ruler },
      { href: "/responsable/revues-direction", label: "Revue de direction", icon: Presentation },
      { href: "/responsable/satisfaction", label: "Satisfaction client", icon: Smile },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/responsable/utilisateurs", label: "Utilisateurs", icon: UserCog, adminOnly: true },
      { href: "/responsable/journal", label: "Journal d'activité", icon: ScrollText, adminOnly: true },
      { href: "/responsable/prestations", label: "Toutes les prestations", icon: FileText },
      { href: "/responsable/planification", label: "Règles de planification", icon: Archive },
    ],
  },
];

export function NavBureau({ role, badges }: { role: string; badges: { panne: number; nonAffectees: number } }) {
  const pathname = usePathname();
  const actif = (href: string) => (href === "/responsable" ? pathname === href : pathname === href || pathname.startsWith(href + "/"));
  return (
    <nav className="px-3 py-4 flex flex-col gap-4 overflow-y-auto">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => !i.adminOnly || role === "administrateur");
        if (items.length === 0) return null;
        return (
          <div key={group.title} className="flex flex-col gap-0.5">
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7fb0d6]">{group.title}</div>
            {items.map((item) => {
              const on = actif(item.href);
              const Icon = item.icon;
              const n = item.badge ? badges[item.badge] : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-[7px] rounded-lg text-[13.5px] transition-colors ${
                    on ? "bg-blue text-white font-semibold shadow-sm" : "text-[#d6e6f5] hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon className={`w-[17px] h-[17px] shrink-0 ${on ? "opacity-100" : "opacity-75"}`} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {n > 0 && (
                    <span
                      className={`min-w-5 h-5 px-1.5 rounded-full text-white text-[11px] font-bold flex items-center justify-center ${
                        item.badge === "panne" ? "bg-red" : "bg-orange"
                      }`}
                    >
                      {n}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
