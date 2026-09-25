import Link from "next/link";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { db } from "@/db";
import { interventions, appareils } from "@/db/schema";
import { and, eq, count, ne, isNull } from "drizzle-orm";
import { signOut } from "@/auth";
import { getNotifications } from "@/lib/notifications";

async function getBadgeCounts() {
  const [[{ n: retard }], [{ n: nonAffectees }]] = await Promise.all([
    db
      .select({ n: count() })
      .from(appareils)
      .where(eq(appareils.statut, "en_panne")),
    db
      .select({ n: count() })
      .from(interventions)
      .where(and(ne(interventions.statut, "cloturee"), isNull(interventions.technicienId))),
  ]);
  return { retard: Number(retard), nonAffectees: Number(nonAffectees) };
}

const NAV_GROUPS: {
  title: string;
  items: { href: string; label: string; icon: string; adminOnly?: boolean }[];
}[] = [
  {
    title: "Exploitation",
    items: [
      { href: "/responsable", label: "Tableau de bord", icon: "📊" },
      { href: "/responsable/projets", label: "Projets", icon: "🗂️" },
      { href: "/responsable/clients", label: "Clients", icon: "🏢" },
      { href: "/responsable/sites", label: "Sites", icon: "📍" },
      { href: "/responsable/appareils", label: "Appareils", icon: "🛗" },
      { href: "/responsable/interventions", label: "Interventions", icon: "🔧" },
      { href: "/responsable/planification", label: "Planning automatique", icon: "🗓️" },
      { href: "/responsable/non-conformites", label: "Non-conformités", icon: "🚫" },
    ],
  },
  {
    title: "Qualité ISO 9001",
    items: [
      { href: "/responsable/score-iso", label: "Score ISO 9001", icon: "🎯" },
      { href: "/responsable/checklists", label: "Checklists", icon: "✅" },
      { href: "/responsable/audits", label: "Audits", icon: "🔍" },
      { href: "/responsable/auditeurs", label: "Auditeurs", icon: "🕵️" },
      { href: "/responsable/risques", label: "Risques & opportunités", icon: "⚠️" },
      { href: "/responsable/etalonnage", label: "Étalonnage", icon: "📏" },
      { href: "/responsable/revues-direction", label: "Revue de direction", icon: "🗂️" },
      { href: "/responsable/satisfaction", label: "Satisfaction client", icon: "😊" },
    ],
  },
  {
    title: "Ressources",
    items: [
      { href: "/responsable/techniciens", label: "Techniciens", icon: "🧑‍🔧" },
      { href: "/responsable/prestations", label: "Prestations", icon: "🧾" },
      { href: "/responsable/prestations-catalogue", label: "Catalogue prestations", icon: "📋" },
      { href: "/responsable/garanties", label: "Garanties", icon: "🛡️" },
      { href: "/responsable/documents", label: "Documents & formations", icon: "📚" },
      { href: "/responsable/stock", label: "Stock", icon: "📦" },
      { href: "/responsable/devis", label: "Devis", icon: "📄" },
      { href: "/responsable/utilisateurs", label: "Utilisateurs", icon: "👤", adminOnly: true },
      { href: "/responsable/journal", label: "Journal d'activité", icon: "🗒️", adminOnly: true },
    ],
  },
];

export default async function ResponsableLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(ROLES_BUREAU);
  const [badges, notifications] = await Promise.all([getBadgeCounts(), getNotifications()]);
  const nbCrit = notifications.filter((n) => n.gravite === "crit").length;

  return (
    <div className="flex min-h-screen">
      <aside className="w-[270px] shrink-0 bg-navy text-blue-pale flex flex-col">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-robus.png" alt="ROBUS" className="h-9 w-auto object-contain" />
          <div>
            <div className="font-display font-extrabold text-white text-sm tracking-wide">
              ROBUS
            </div>
            <div className="text-[11px] text-blue-accent/80">Liften &middot; Ascenseurs</div>
          </div>
        </div>

        <nav className="px-2.5 py-4 flex flex-col gap-3.5 overflow-y-auto">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.adminOnly || user.role === "administrateur");
            if (items.length === 0) return null;
            return (
              <div key={group.title} className="flex flex-col gap-0.5">
                <div className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-blue-accent/60">
                  {group.title}
                </div>
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium hover:bg-white/10 transition-colors"
                  >
                    <span className="w-5 text-center">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {item.href === "/responsable/appareils" && badges.retard > 0 && (
                      <span className="min-w-5 h-5 px-1.5 rounded-full bg-red text-white text-[11px] font-bold flex items-center justify-center">
                        {badges.retard}
                      </span>
                    )}
                    {item.href === "/responsable/interventions" && badges.nonAffectees > 0 && (
                      <span className="min-w-5 h-5 px-1.5 rounded-full bg-orange text-white text-[11px] font-bold flex items-center justify-center">
                        {badges.nonAffectees}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="mt-auto px-5 py-4 border-t border-white/10 text-xs text-blue-accent/80">
          Version complète — Phases 1 à 5
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-surface border-b border-line flex items-center gap-4 px-6 py-3">
          <div className="flex-1" />

          <Link
            href="/responsable/rapports"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold font-display bg-blue hover:bg-blue-light text-white transition-colors"
          >
            📄 Générer un rapport
          </Link>

          <details className="relative">
            <summary className="list-none cursor-pointer w-9 h-9 rounded-full border border-line flex items-center justify-center relative hover:bg-blue-pale">
              <span aria-hidden>🔔</span>
              {notifications.length > 0 && (
                <span
                  className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${
                    nbCrit > 0 ? "bg-red" : "bg-orange"
                  }`}
                >
                  {notifications.length}
                </span>
              )}
            </summary>
            <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-surface border border-line rounded-xl shadow-lg z-30 p-2">
              <div className="text-xs font-bold uppercase tracking-wide text-ink-soft px-2 py-1.5">
                Notifications
              </div>
              {notifications.length === 0 && (
                <div className="text-sm text-ink-soft px-2 py-3">Aucune alerte en cours.</div>
              )}
              {notifications.map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  className="flex items-start gap-2 px-2 py-2 rounded-lg text-sm hover:bg-blue-pale"
                >
                  <span
                    className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                      n.gravite === "crit" ? "bg-red" : "bg-orange"
                    }`}
                  />
                  <span>{n.titre}</span>
                </Link>
              ))}
            </div>
          </details>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/connexion" });
            }}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue to-navy text-white flex items-center justify-center text-xs font-display font-bold">
                {user.name
                  ?.split(" ")
                  .map((p) => p[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              <div className="text-sm leading-tight">
                <div className="font-semibold">{user.name}</div>
                <div className="text-xs text-ink-soft">
                  {user.role === "responsable_qualite"
                    ? "Responsable Qualité"
                    : user.role === "administrateur"
                      ? "Administrateur"
                      : "Commercial"}
                </div>
              </div>
              <button
                type="submit"
                className="text-xs font-semibold text-ink-soft hover:text-red-ink border border-line rounded-lg px-2.5 py-1.5 ml-2"
              >
                Déconnexion
              </button>
            </div>
          </form>
        </header>
        <main className="flex-1 px-6 py-6 max-w-[1280px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
