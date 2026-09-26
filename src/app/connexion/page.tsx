import { signIn } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const ROLE_HOME: Record<string, string> = {
  administrateur: "/responsable",
  responsable_qualite: "/responsable",
  commercial: "/responsable",
  technicien: "/technicien",
};

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; erreur?: string; reinit?: string }>;
}) {
  const params = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const errRedirect = `/connexion?erreur=1${params.next ? `&next=${encodeURIComponent(params.next)}` : ""}`;

    if (!email || !password) redirect(errRedirect);

    // On valide nous-mêmes les identifiants d'abord : cela évite de dépendre du
    // mécanisme de redirection interne de next-auth (qui redirige toujours,
    // succès ou échec) pour distinguer les deux cas.
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || user.actif !== 1) redirect(errRedirect);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) redirect(errRedirect);

    // Identifiants valides : on établit la session sans laisser next-auth
    // rediriger lui-même, puis on redirige nous-mêmes vers la bonne destination.
    await signIn("credentials", { email, password, redirect: false });

    const destination =
      params.next && params.next.startsWith("/") ? params.next : (ROLE_HOME[user.role] ?? "/connexion");
    redirect(destination);
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-navy text-white flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-robus.png" alt="ROBUS" className="h-10 w-auto object-contain" />
          <div>
            <div className="font-display font-extrabold text-lg tracking-wide">ROBUS</div>
            <div className="text-xs text-blue-accent/80">Liften &middot; Ascenseurs</div>
          </div>
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-3xl font-extrabold leading-tight mb-4">
            Dashboard de pilotage qualité ISO 9001
          </h1>
          <p className="text-white/70 text-sm leading-relaxed">
            Clients, sites, appareils, interventions et non-conformités reliés entre eux —
            aucune donnée isolée, un score qualité lisible au quotidien.
          </p>
        </div>
        <div className="text-xs text-white/40">Version 1.0 — Phase 1 (Fondations)</div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 bg-bg">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex flex-col items-center gap-2 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-robus.png" alt="ROBUS" className="h-10 w-auto object-contain" />
            <div>
              <div className="font-display font-extrabold text-navy text-xl">ROBUS</div>
              <div className="text-xs text-ink-soft">Liften &middot; Ascenseurs</div>
            </div>
          </div>

          <div className="bg-surface border border-line rounded-2xl shadow-sm p-8">
            <h2 className="font-display text-xl font-bold mb-1">Connexion</h2>
            <p className="text-sm text-ink-soft mb-6">Accédez à votre espace ROBUS.</p>

            {params.reinit && (
              <div className="mb-4 text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">
                Mot de passe modifié. Connectez-vous avec le nouveau.
              </div>
            )}
            {params.erreur && (
              <div className="mb-4 text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">
                Email ou mot de passe incorrect.
              </div>
            )}

            <form action={login} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-ink-soft mb-1.5">
                  Email
                </label>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="w-full rounded-lg border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-accent focus:border-blue"
                  placeholder="prenom.nom@robus.be"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-ink-soft mb-1.5">
                  Mot de passe
                </label>
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="w-full rounded-lg border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-accent focus:border-blue"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                className="mt-2 bg-blue hover:bg-blue-light text-white font-display font-bold text-sm rounded-lg py-2.5 transition-colors"
              >
                Se connecter
              </button>
              <a href="/mot-de-passe-oublie" className="text-center text-sm font-semibold text-blue hover:underline">
                Mot de passe oublié ?
              </a>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
