import Link from "next/link";
import { Search } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { reglagesAcces } from "@/lib/acces-technicien";
import { appareilsRecents, rechercherAppareils } from "@/lib/fiche-appareil-technicien";
import { ScannerQr } from "@/components/scanner-qr";
import { StatutAppareilPill } from "@/components/ui";

// Phase 22 : trouver un appareil — scanner son QR code ou taper son numéro,
// sa référence, son adresse ou le nom du client.
export default async function TrouverAppareilPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser(["technicien"]);
  const { q = "" } = await searchParams;
  const reglages = await reglagesAcces();
  const [resultats, recents] = await Promise.all([q.trim().length >= 2 ? rechercherAppareils(q, user.id, reglages.portee) : Promise.resolve([]), q ? Promise.resolve([]) : appareilsRecents(user.id)]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display font-extrabold text-xl text-navy">Trouver un appareil</h1>
        <p className="text-sm text-ink-soft">Fiche technique, historique complet, garantie, prochaine visite.</p>
      </div>
      <ScannerQr />
      <form className="relative">
        <Search className="w-4 h-4 text-ink-soft absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          name="q"
          defaultValue={q}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="N° d'appareil, n° de série, adresse, client…"
          className="w-full rounded-xl border border-line bg-surface pl-9 pr-24 py-3.5 text-[16px]"
        />
        <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-blue text-white font-bold text-sm rounded-lg px-3.5 py-2">
          Chercher
        </button>
      </form>

      {q.trim().length >= 2 && (
        <div className="flex flex-col gap-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft">{resultats.length} résultat(s)</h2>
          {resultats.map((a) => (
            <Link key={a.id} href={`/technicien/appareils/${a.id}`} className="bg-surface border border-line rounded-2xl p-3.5 flex flex-col gap-1 active:bg-blue-pale">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display font-extrabold text-[16px] text-navy">{a.numero}</span>
                <StatutAppareilPill statut={a.statut} />
              </div>
              <div className="text-[13px] text-ink-soft">{[a.marque, a.modele].filter(Boolean).join(" ") || "Marque non renseignée"}</div>
              <div className="text-[13px] truncate">{[a.client, a.adresse].filter(Boolean).join(" — ")}</div>
            </Link>
          ))}
          {resultats.length === 0 && <p className="text-sm text-ink-soft">Aucun appareil trouvé. Vérifiez le numéro ou essayez l&apos;adresse.</p>}
        </div>
      )}
      {q.trim().length === 1 && <p className="text-sm text-ink-soft">Tapez au moins 2 caractères.</p>}

      {!q && recents.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft">Mes appareils récents</h2>
          {recents.map((a) => (
            <Link key={a.id} href={`/technicien/appareils/${a.id}`} className="bg-surface border border-line rounded-2xl px-3.5 py-3 flex items-center justify-between gap-3 active:bg-blue-pale">
              <span className="min-w-0">
                <span className="block font-display font-bold text-[15px] text-navy">{a.numero}</span>
                <span className="block text-[12.5px] text-ink-soft truncate">{[a.marque, a.adresse].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="text-blue font-bold">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
