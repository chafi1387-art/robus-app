import Link from "next/link";
import { inArray } from "drizzle-orm";
import { ChevronRight, MapPin } from "lucide-react";
import { db } from "@/db";
import { appareils } from "@/db/schema";
import { StatutAppareilPill } from "@/components/ui";
import { CarteApplication } from "@/components/app-installable";
import { EtapesSuivi } from "@/components/etapes-suivi";
import { clePubliqueVapid } from "@/lib/push";
import { devisDeLObservateur } from "@/lib/devis";
import { ListeDevisObservateur } from "@/components/liste-devis-observateur";
import { formatDate, formatDateTime } from "@/lib/format";
import { ETAPES, adressesAppareils, etapeObservateur, requireObservateur } from "@/lib/observateur";
import { interventionsEnCours, interventionsTerminees, prochainesVisites } from "@/lib/observateur-donnees";

export default async function MesAscenseursPage({ searchParams }: { searchParams: Promise<{ acces?: string }> }) {
  const ctx = await requireObservateur();
  const { acces } = await searchParams;
  const ids = ctx.appareilIds;
  const d = ctx.droits;
  const [liste, adresses, enCours, terminees, visites, mesDevis] = await Promise.all([
    ids.length
      ? db
          .select({ id: appareils.id, numero: appareils.numeroInterne, marque: appareils.marque, modele: appareils.modele, statut: appareils.statut })
          .from(appareils)
          .where(inArray(appareils.id, ids))
          .orderBy(appareils.numeroInterne)
      : Promise.resolve([]),
    adressesAppareils(ids),
    d.has("temps_reel") ? interventionsEnCours(ids) : Promise.resolve([]),
    d.has("historique") ? interventionsTerminees(ctx, ids, 200) : Promise.resolve([]),
    d.has("prochaines_visites") ? prochainesVisites(ids) : Promise.resolve([]),
    devisDeLObservateur(ctx.userId),
  ]);
  // Phase 25b : en premier les devis qui attendent une réponse, puis les 3 derniers.
  const devisAffiches = [...mesDevis.filter((x) => x.statut === "envoye"), ...mesDevis.filter((x) => x.statut !== "envoye").slice(0, 3)];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display font-extrabold text-[21px]">Mes ascenseurs</h1>
        <p className="text-sm text-ink-soft">{liste.length} appareil{liste.length > 1 ? "s" : ""} suivi{liste.length > 1 ? "s" : ""}{ctx.dateFin ? ` · accès jusqu'au ${formatDate(ctx.dateFin)}` : ""}</p>
      </div>
      {acces === "refuse" && (
        <div className="text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">Vous n&apos;avez pas accès à cet appareil — contactez ROBUS.</div>
      )}
      {d.has("notifications") && <CarteApplication cleVapid={clePubliqueVapid()} seulementSiAction compact />}
      <ListeDevisObservateur devis={devisAffiches} titre="Vos devis" />

      {liste.map((a) => {
        const encours = enCours.find((i) => i.appareilId === a.id);
        const derniere = terminees.find((i) => i.appareilId === a.id);
        const prochaine = visites.find((v) => v.appareilId === a.id);
        const etape = encours ? etapeObservateur(encours) : null;
        return (
          <Link key={a.id} href={`/observateur/appareils/${a.id}`} className="bg-surface border border-line rounded-2xl p-4 flex flex-col gap-3 active:bg-blue-pale">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-display font-extrabold text-[17px] text-navy">{a.numero}</div>
                {d.has("fiche") && (a.marque || a.modele) && <div className="text-[13px] text-ink-soft">{[a.marque, a.modele].filter(Boolean).join(" · ")}</div>}
                {adresses.get(a.id) && (
                  <div className="text-[13px] text-ink-soft flex items-center gap-1"><MapPin className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{adresses.get(a.id)}</span></div>
                )}
              </div>
              <div className="flex items-center gap-1">
                {d.has("fiche") && <StatutAppareilPill statut={a.statut} />}
                <ChevronRight className="w-5 h-5 text-ink-soft" />
              </div>
            </div>
            {encours && etape !== null && (
              <div className="rounded-xl bg-blue-pale/50 px-3 py-3">
                <div className="text-xs font-bold text-blue mb-2">
                  Intervention en cours · {ETAPES[etape]}
                  {etape === 1 && encours.dateProgrammee ? ` le ${formatDateTime(encours.dateProgrammee)}` : ""}
                </div>
                <EtapesSuivi etape={etape} />
              </div>
            )}
            {(derniere || prochaine) && (
              <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                {derniere && (
                  <div className="rounded-xl bg-bg px-3 py-2">
                    <div className="text-ink-soft">Dernière visite</div>
                    <div className="font-semibold">{formatDate(derniere.dateFin ?? derniere.dateProgrammee)}</div>
                  </div>
                )}
                {prochaine && (
                  <div className="rounded-xl bg-bg px-3 py-2">
                    <div className="text-ink-soft">Prochaine visite</div>
                    <div className="font-semibold">{formatDate(prochaine.date)}</div>
                  </div>
                )}
              </div>
            )}
          </Link>
        );
      })}
      {liste.length === 0 && <p className="text-sm text-ink-soft">Aucun appareil ne vous est attribué pour l&apos;instant.</p>}
    </div>
  );
}
