import { NavTechnicien } from "@/components/nav-technicien";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { signOut } from "@/auth";

export default async function TechnicienLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(ROLES_TECHNICIEN);

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <header className="sticky top-0 z-20 bg-navy text-white px-4 py-3 flex items-center gap-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
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

      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-4 pb-28">{children}</main>

      <NavTechnicien />
    </div>
  );
}
