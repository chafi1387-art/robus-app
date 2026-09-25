import Link from "next/link";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { signOut } from "@/auth";

const TABS = [
  { href: "/technicien", label: "Interventions", icon: "🔧" },
  { href: "/technicien/formations", label: "Formations", icon: "📄" },
  { href: "/technicien/profil", label: "Mon profil", icon: "👤" },
];

export default async function TechnicienLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(ROLES_TECHNICIEN);

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <header className="sticky top-0 z-20 bg-navy text-white px-4 py-3 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-robus.png" alt="ROBUS" className="h-8 w-auto object-contain" />

        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-sm leading-tight truncate">{user.name}</div>
          <div className="text-[11px] text-blue-accent/80">Espace Technicien</div>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/connexion" });
          }}
        >
          <button
            type="submit"
            className="text-[11px] font-semibold text-white/70 hover:text-white border border-white/20 rounded-lg px-2.5 py-1.5"
          >
            Déconnexion
          </button>
        </form>
      </header>

      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-4 pb-24">{children}</main>

      <nav className="fixed bottom-0 inset-x-0 bg-surface border-t border-line flex z-20">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="flex-1 flex flex-col items-center gap-1 py-2.5 text-ink-soft hover:text-blue"
          >
            <span className="text-lg leading-none">{t.icon}</span>
            <span className="text-[11px] font-semibold">{t.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
