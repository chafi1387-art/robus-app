import Link from "next/link";
import { ChevronRight, FileSignature } from "lucide-react";
import { formatDate } from "@/lib/format";

type D = { id: string; numero: string; titre: string | null; statut: string; dateEnvoi: Date | null; peutDecider: number; numeroAppareil: string | null };

const LIBELLE: Record<string, string> = {
  envoye: "En attente de réponse",
  accepte: "Accepté",
  refuse: "Refusé",
  realise: "Travaux réalisés",
};

// Phase 25b : devis reçus (accueil et fiche ascenseur de l'observateur).
export function ListeDevisObservateur({ devis, titre = "Devis" }: { devis: D[]; titre?: string }) {
  if (!devis.length) return null;
  const aRepondre = devis.filter((d) => d.statut === "envoye" && d.peutDecider === 1).length;
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-2 ${aRepondre ? "border-orange bg-orange-fill/40" : "border-line bg-surface"}`}>
      <div className="font-display font-bold text-sm flex items-center gap-2">
        <FileSignature className="w-4 h-4 text-blue" /> {titre}
        {aRepondre > 0 && <span className="ml-auto text-xs font-bold text-orange-ink">{aRepondre} attend{aRepondre > 1 ? "ent" : ""} votre réponse</span>}
      </div>
      {devis.map((d) => (
        <Link key={d.id} href={`/observateur/devis/${d.id}`} className="flex items-center gap-2 rounded-xl bg-surface border border-line px-3 py-2.5 active:bg-blue-pale">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{d.titre ?? `Devis ${d.numero}`}</div>
            <div className="text-xs text-ink-soft">
              {d.numero}
              {d.numeroAppareil ? ` · ${d.numeroAppareil}` : ""}
              {d.dateEnvoi ? ` · ${formatDate(d.dateEnvoi)}` : ""}
            </div>
          </div>
          <span className={`text-xs font-bold ${d.statut === "envoye" ? "text-orange-ink" : d.statut === "refuse" ? "text-red-ink" : "text-green-ink"}`}>
            {d.statut === "envoye" && d.peutDecider !== 1 ? "Pour information" : (LIBELLE[d.statut] ?? d.statut)}
          </span>
          <ChevronRight className="w-4 h-4 text-ink-soft" />
        </Link>
      ))}
    </div>
  );
}
