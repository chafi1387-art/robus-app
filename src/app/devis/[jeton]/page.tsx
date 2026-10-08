import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { devisDestinataires } from "@/db/schema";
import { expire, hashJeton, lireDevis, marquerDevisVu } from "@/lib/devis";
import { DevisVue } from "@/components/devis-vue";
import { DecisionDevis } from "@/components/decision-devis";
import { repondreDevisParLien } from "./actions";

// Phase 25b : devis ouvert depuis le lien personnel reçu par email (sans compte).
export const metadata = { title: "Devis — ROBUS", robots: { index: false, follow: false } };

export default async function DevisPublicPage({
  params,
  searchParams,
}: {
  params: Promise<{ jeton: string }>;
  searchParams: Promise<{ erreur?: string; reponse?: string }>;
}) {
  const { jeton } = await params;
  const sp = await searchParams;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(jeton)) notFound();
  const [dest] = await db
    .select()
    .from(devisDestinataires)
    .where(and(eq(devisDestinataires.jetonHash, hashJeton(jeton)), eq(devisDestinataires.canal, "email")))
    .limit(1);
  if (!dest) notFound();
  const dv = await lireDevis(dest.devisId);
  if (!dv || dv.d.statut === "annule") notFound();
  await marquerDevisVu(dest.id);
  const prix = dest.prixVisible === 1;

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-navy text-white px-4 py-3 flex items-center gap-3 print:bg-white print:text-navy">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-robus.png" alt="ROBUS" className="h-8 w-auto object-contain" />
        <div className="font-display font-bold text-sm">ROBUS · Liften &amp; Ascenseurs</div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-5 flex flex-col gap-4">
        <div className="bg-surface border border-line rounded-2xl p-5">
          <DevisVue dv={dv} prixVisible={prix} lienDocument={`/devis/${jeton}/document`} />
        </div>
        <DecisionDevis
          dv={dv}
          peutDecider={dest.peutDecider === 1}
          nomParDefaut={dest.nom ?? ""}
          expire={expire(dv.d)}
          action={repondreDevisParLien}
          champs={{ jeton }}
          erreur={sp.erreur}
          reponse={sp.reponse}
        />
        <p className="text-center text-xs text-ink-soft print:hidden">
          Une question ? Répondez simplement à l&apos;email de ROBUS. Ce lien vous est personnel.
        </p>
      </main>
    </div>
  );
}
