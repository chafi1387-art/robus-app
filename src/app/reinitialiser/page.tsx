import Link from "next/link";
import { reinitialiserMotDePasse } from "./actions";

const ERREURS: Record<string, string> = {
  lien: "Ce lien n'est plus valable (expiré ou déjà utilisé). Demandez-en un nouveau.",
  court: "Le mot de passe doit contenir au moins 8 caractères.",
  different: "Les deux mots de passe ne sont pas identiques.",
};

export default async function ReinitialiserPage({ searchParams }: { searchParams: Promise<{ jeton?: string; erreur?: string }> }) {
  const { jeton = "", erreur } = await searchParams;
  const lienInvalide = erreur === "lien" || !/^[0-9a-f]{64}$/.test(jeton);
  const champ = "w-full rounded-lg border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-accent";
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-bg">
      <div className="w-full max-w-sm bg-surface border border-line rounded-2xl shadow-sm p-8 flex flex-col gap-4">
        <h1 className="font-display text-xl font-bold">Nouveau mot de passe</h1>
        {erreur && ERREURS[erreur] && <div className="text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">{ERREURS[erreur]}</div>}
        {lienInvalide ? (
          <Link href="/mot-de-passe-oublie" className="text-sm font-semibold text-blue">Demander un nouveau lien</Link>
        ) : (
          <form action={reinitialiserMotDePasse} className="flex flex-col gap-3">
            <input type="hidden" name="jeton" value={jeton} />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Nouveau mot de passe</span>
              <input name="password" type="password" required minLength={8} autoComplete="new-password" className={champ} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Confirmer</span>
              <input name="confirmation" type="password" required minLength={8} autoComplete="new-password" className={champ} />
            </label>
            <button type="submit" className="bg-blue hover:bg-blue-light text-white font-display font-bold text-sm rounded-lg py-2.5">Enregistrer</button>
          </form>
        )}
      </div>
    </div>
  );
}
