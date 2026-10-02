import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { MapPin, Phone } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/db";
import { appareils, observateurAppareils, observateurs } from "@/db/schema";
import { ROLE_HOME } from "@/lib/auth-helpers";
import { PARAM_TELEPHONE, adressesAppareils, getParametre } from "@/lib/observateur";
import { connexionQr, signalerPanneQr } from "./actions";

// Phase 18 : page ouverte en scannant l'étiquette QR de la cabine.
// Non connecté : n° + adresse de l'appareil, connexion (email + mot de passe)
// puis arrivée directe sur la fiche de CET appareil ; bouton d'urgence et
// signalement de panne sans compte. Aucune autre information n'est affichée.

export const metadata = { title: "ROBUS — Ascenseur" };

const ERREURS: Record<string, string> = {
  identifiants: "Email ou mot de passe incorrect.",
  expire: "Votre accès a expiré ou a été retiré. Contactez ROBUS.",
};

export default async function QrPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ erreur?: string; erreurPanne?: string; panne?: string; numero?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const valide = /^[A-Za-z0-9_-]{8,32}$/.test(code);
  const [a] = valide ? await db.select({ id: appareils.id, numero: appareils.numeroInterne }).from(appareils).where(eq(appareils.qrCode, code)).limit(1) : [];
  const telephone = await getParametre(PARAM_TELEPHONE);
  const session = await auth();
  const role = session?.user?.role;
  let refuse = false;

  if (a && session?.user?.id && role) {
    if (role === "observateur") {
      const [lien] = await db
        .select({ id: observateurAppareils.id })
        .from(observateurAppareils)
        .innerJoin(observateurs, eq(observateurAppareils.observateurId, observateurs.id))
        .where(and(eq(observateurs.userId, session.user.id), eq(observateurAppareils.appareilId, a.id)))
        .limit(1);
      if (lien) redirect(`/observateur/appareils/${a.id}`);
      refuse = true;
    } else if (role === "technicien") {
      // Phase 22 : le technicien arrive sur la fiche complète de l'appareil
      // (sa mission en cours y est accessible en un clic).
      redirect(`/technicien/appareils/${a.id}`);
    } else {
      redirect(`/responsable/appareils/${a.id}`);
    }
  }
  const adresse = a ? (await adressesAppareils([a.id])).get(a.id) : null;
  const champ = "w-full rounded-xl border border-line px-3 py-3 text-[16px] bg-surface";
  const tel = telephone?.replace(/[^+0-9]/g, "");

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <header className="bg-navy text-white px-5 py-4 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-robus.png" alt="ROBUS" className="h-8 w-auto object-contain" />
        <div className="font-display font-bold text-sm">Suivi de l&apos;ascenseur</div>
      </header>
      <main className="flex-1 w-full max-w-md mx-auto px-4 py-5 flex flex-col gap-4">
        {!a ? (
          <div className="bg-surface border border-line rounded-2xl p-5">
            <h1 className="font-display font-extrabold text-lg">Étiquette non reconnue</h1>
            <p className="text-sm text-ink-soft mt-1">Ce QR code ne correspond à aucun appareil. Contactez ROBUS.</p>
          </div>
        ) : (
          <>
            <div className="bg-surface border border-line rounded-2xl p-5">
              <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Ascenseur</div>
              <h1 className="font-display font-extrabold text-2xl text-navy">N° {a.numero}</h1>
              {adresse && <p className="text-sm text-ink-soft flex items-center gap-1 mt-0.5"><MapPin className="w-3.5 h-3.5" /> {adresse}</p>}
            </div>

            {sp.panne === "1" && (
              <div className="text-sm bg-green-fill text-green-ink rounded-xl px-4 py-3">
                Merci, la panne a été transmise à ROBUS{sp.numero ? ` (demande ${sp.numero})` : ""}. Nous vous rappellerons si besoin.
              </div>
            )}

            {tel && (
              <a href={`tel:${tel}`} className="bg-red-ink text-white rounded-2xl px-5 py-4 flex items-center gap-3 shadow-sm">
                <Phone className="w-6 h-6" />
                <span>
                  <span className="block text-xs font-bold uppercase tracking-wide opacity-90">Urgence — personne bloquée ?</span>
                  <span className="block font-display font-extrabold text-lg">Appeler ROBUS · {telephone}</span>
                </span>
              </a>
            )}

            {refuse ? (
              <div className="bg-surface border border-line rounded-2xl p-5 text-sm">
                <p className="font-semibold">Vous n&apos;avez pas accès à cet appareil.</p>
                <p className="text-ink-soft mt-1">Contactez ROBUS pour l&apos;ajouter à votre accès.</p>
                <Link href={ROLE_HOME[role ?? ""] ?? "/"} className="inline-block mt-3 font-bold text-blue">Mes ascenseurs →</Link>
              </div>
            ) : (
              <div className="bg-surface border border-line rounded-2xl p-5">
                <h2 className="font-display font-bold text-base">Suivre cet ascenseur</h2>
                <p className="text-sm text-ink-soft mb-3">Connectez-vous avec l&apos;email et le mot de passe de votre accès ROBUS.</p>
                {sp.erreur && ERREURS[sp.erreur] && <div className="mb-3 text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">{ERREURS[sp.erreur]}</div>}
                <form action={connexionQr} className="flex flex-col gap-3">
                  <input type="hidden" name="code" value={code} />
                  <input name="email" type="email" required autoComplete="email" placeholder="Email" className={champ} />
                  <input name="password" type="password" required autoComplete="current-password" placeholder="Mot de passe" className={champ} />
                  <button type="submit" className="bg-blue text-white font-display font-bold rounded-xl py-3">Se connecter</button>
                </form>
                <Link href="/mot-de-passe-oublie" className="block text-center text-sm font-semibold text-blue mt-3">Mot de passe oublié ?</Link>
              </div>
            )}

            <details id="panne" className="bg-surface border border-line rounded-2xl p-5" open={!!sp.erreurPanne || undefined}>
              <summary className="font-display font-bold text-base cursor-pointer select-none">Signaler une panne sans compte</summary>
              {sp.erreurPanne && <div className="mt-3 text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">{sp.erreurPanne}</div>}
              <form action={signalerPanneQr} className="flex flex-col gap-3 mt-3">
                <input type="hidden" name="code" value={code} />
                <input type="text" name="site_web" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
                <input name="nom" required minLength={2} placeholder="Votre nom" className={champ} />
                <input name="telephone" required inputMode="tel" placeholder="Votre téléphone" className={champ} />
                <input name="email" type="email" placeholder="Votre email (facultatif, pour suivre la demande)" className={champ} />
                <label className="flex items-center gap-2.5 rounded-xl bg-red-fill text-red-ink px-3 py-3 font-bold">
                  <input type="checkbox" name="personneBloquee" className="w-5 h-5" /> Une personne est bloquée
                </label>
                <textarea name="description" required minLength={5} maxLength={1000} rows={3} placeholder="Que se passe-t-il ?" className={champ} />
                <button type="submit" className="bg-navy text-white font-display font-bold rounded-xl py-3">Envoyer à ROBUS</button>
              </form>
            </details>
          </>
        )}
      </main>
    </div>
  );
}
