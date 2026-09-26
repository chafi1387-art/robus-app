import Link from "next/link";
import { demanderReinitialisation } from "./actions";

export default async function MotDePasseOubliePage({ searchParams }: { searchParams: Promise<{ envoye?: string }> }) {
  const { envoye } = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-bg">
      <div className="w-full max-w-sm bg-surface border border-line rounded-2xl shadow-sm p-8 flex flex-col gap-4">
        <h1 className="font-display text-xl font-bold">Mot de passe oublié</h1>
        {envoye ? (
          <>
            <p className="text-sm text-ink-soft leading-relaxed">
              Si un compte actif correspond à cet email, un lien pour choisir un nouveau mot de passe vient d&apos;être envoyé.
              Il est valable 30 minutes. <strong>Pensez à vérifier les courriers indésirables (spam).</strong>
            </p>
            <Link href="/connexion" className="text-sm font-semibold text-blue">← Retour à la connexion</Link>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-soft">Indiquez l&apos;email de votre compte ROBUS : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
            <form action={demanderReinitialisation} className="flex flex-col gap-3">
              <input name="email" type="email" required autoComplete="email" placeholder="prenom.nom@…" className="w-full rounded-lg border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-accent" />
              <button type="submit" className="bg-blue hover:bg-blue-light text-white font-display font-bold text-sm rounded-lg py-2.5">Envoyer le lien</button>
            </form>
            <Link href="/connexion" className="text-sm font-semibold text-blue">← Retour à la connexion</Link>
          </>
        )}
      </div>
    </div>
  );
}
