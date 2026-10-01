import { signOut } from "@/auth";
import { requireObservateur } from "@/lib/observateur";
import { NavObservateur } from "@/components/nav-observateur";

// Phase 18 : espace Observateur — lecture seule, pensé pour le téléphone.
export default async function ObservateurLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireObservateur();
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <header className="sticky top-0 z-20 bg-navy text-white px-4 py-3 flex items-center gap-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-robus.png" alt="ROBUS" className="h-8 w-auto object-contain" />
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-sm leading-tight truncate">{ctx.nom}</div>
          <div className="text-[11px] text-blue-accent/80">Suivi de vos ascenseurs</div>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/connexion" });
          }}
        >
          <button type="submit" className="text-[11px] font-semibold text-white/70 hover:text-white border border-white/20 rounded-lg px-2.5 py-1.5">
            Déconnexion
          </button>
        </form>
      </header>
      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-4 pb-28">{children}</main>
      <NavObservateur tempsReel={ctx.droits.has("temps_reel")} />
    </div>
  );
}
