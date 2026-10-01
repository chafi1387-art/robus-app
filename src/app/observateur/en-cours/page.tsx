import Link from "next/link";
import { redirect } from "next/navigation";
import { EtapesSuivi } from "@/components/etapes-suivi";
import { RafraichissementAuto } from "@/components/rafraichissement-auto";
import { formatDateTime } from "@/lib/format";
import { ETAPES, etapeObservateur, requireObservateur } from "@/lib/observateur";
import { interventionsEnCours, prenom } from "@/lib/observateur-donnees";

const TYPE: Record<string, string> = { preventive: "Maintenance préventive", corrective: "Dépannage", systematique: "Contrôle systématique" };

export default async function EnCoursPage() {
  const ctx = await requireObservateur();
  if (!ctx.droits.has("temps_reel")) redirect("/observateur");
  const liste = await interventionsEnCours(ctx.appareilIds);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display font-extrabold text-[21px]">Interventions en cours</h1>
      </div>
      <RafraichissementAuto secondes={30} />
      {liste.map((i) => {
        const etape = etapeObservateur(i);
        return (
          <Link key={i.id} href={`/observateur/appareils/${i.appareilId}`} className="bg-surface border border-line rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display font-extrabold text-[17px] text-navy">{i.numero}</span>
              <span className="text-xs font-bold text-blue">{ETAPES[etape]}</span>
            </div>
            <div className="text-[13px] text-ink-soft">
              {TYPE[i.type] ?? i.type}
              {i.dateProgrammee && etape >= 1 ? ` · ${formatDateTime(i.dateProgrammee)}` : ""}
              {etape >= 1 && prenom(i.technicien) ? ` · Technicien : ${prenom(i.technicien)}` : ""}
            </div>
            <EtapesSuivi etape={etape} />
          </Link>
        );
      })}
      {liste.length === 0 && <p className="text-sm text-ink-soft">Aucune intervention en cours sur vos ascenseurs.</p>}
    </div>
  );
}
