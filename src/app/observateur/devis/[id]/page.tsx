import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { devisDestinataires } from "@/db/schema";
import { requireObservateur } from "@/lib/observateur";
import { expire, lireDevis, marquerDevisVu } from "@/lib/devis";
import { DevisVue } from "@/components/devis-vue";
import { DecisionDevis } from "@/components/decision-devis";
import { repondreDevisObservateur } from "../../actions";

// Phase 25b : devis reçu dans l'espace observateur.
export default async function DevisObservateurPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erreur?: string; reponse?: string }>;
}) {
  const ctx = await requireObservateur();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [dest] = await db
    .select()
    .from(devisDestinataires)
    .where(and(eq(devisDestinataires.devisId, id), eq(devisDestinataires.userId, ctx.userId), eq(devisDestinataires.canal, "observateur"), isNotNull(devisDestinataires.envoyeLe)))
    .limit(1);
  if (!dest) redirect("/observateur");
  const dv = await lireDevis(id);
  if (!dv || dv.d.statut === "annule") redirect("/observateur");
  await marquerDevisVu(dest.id);
  return (
    <div className="flex flex-col gap-4">
      <Link href={dv.d.appareilId ? `/observateur/appareils/${dv.d.appareilId}` : "/observateur"} className="text-xs text-blue font-semibold">
        &larr; {dv.numeroAppareil ? `Ascenseur ${dv.numeroAppareil}` : "Mes ascenseurs"}
      </Link>
      <div className="bg-surface border border-line rounded-2xl p-4">
        <DevisVue dv={dv} prixVisible={dest.prixVisible === 1} />
      </div>
      <DecisionDevis
        dv={dv}
        peutDecider={dest.peutDecider === 1}
        nomParDefaut={ctx.nom}
        expire={expire(dv.d)}
        action={repondreDevisObservateur}
        champs={{ devisId: id }}
        erreur={sp.erreur}
        reponse={sp.reponse}
      />
    </div>
  );
}
