import Link from "next/link";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { db } from "@/db";
import { interventions, appareils } from "@/db/schema";
import { and, eq, count, ne, isNull } from "drizzle-orm";
import { signOut } from "@/auth";
import { getNotifications } from "@/lib/notifications";
import { NavBureau } from "@/components/nav-bureau";
import { MenuMobile } from "@/components/menu-mobile";
import { Bell, FileText } from "lucide-react";

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

export default async function ResponsableLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(ROLES_BUREAU);
  const [badges, notifications] = await Promise.all([getBadgeCounts(), getNotifications()]);
  const nbCrit = notifications.filter((n) => n.gravite === "crit").length;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden lg:flex w-[264px] shrink-0 bg-navy text-blue-pale flex-col sticky top-0 h-screen">
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

        <NavBureau role={user.role} badges={{ panne: badges.retard, nonAffectees: badges.nonAffectees }} />

        <div className="mt-auto px-5 py-4 border-t border-white/10 text-xs text-blue-accent/80">
          ROBUS · Pilotage ISO 9001
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-line flex items-center gap-2 sm:gap-4 px-3 sm:px-8 h-16">
          <MenuMobile role={user.role} badges={{ panne: badges.retard, nonAffectees: badges.nonAffectees }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-robus.png" alt="ROBUS" className="lg:hidden h-7 w-auto object-contain" />
          <div className="flex-1" />

          <Link
            href="/responsable/rapports"
            className="inline-flex items-center gap-2 rounded-lg px-2.5 sm:px-4 py-2 text-sm font-bold font-display bg-blue hover:bg-blue-light text-white transition-colors" aria-label="Générer un rapport"
          >
            <FileText className="w-4 h-4" /> <span className="hidden sm:inline">Générer un rapport</span>
          </Link>

          <details className="relative">
            <summary className="list-none cursor-pointer w-9 h-9 rounded-full border border-line flex items-center justify-center relative hover:bg-blue-pale">
              <Bell className="w-[18px] h-[18px] text-ink-soft" aria-label="Notifications" />
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
            <div className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] max-h-96 overflow-y-auto bg-surface border border-line rounded-xl shadow-lg z-30 p-2">
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
              <div className="text-sm leading-tight hidden md:block">
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
                className="text-xs font-semibold text-ink-soft hover:text-red-ink border border-line rounded-lg px-2 sm:px-2.5 py-1.5 sm:ml-2"
              >
                Déconnexion
              </button>
            </div>
          </form>
        </header>
        <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8 max-w-[1360px] w-full mx-auto min-w-0">{children}</main>
      </div>
    </div>
  );
}
