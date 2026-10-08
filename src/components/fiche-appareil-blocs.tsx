import Link from "next/link";
import { duree, heure, jourCourt, type MissionOuverte } from "@/lib/parc";

// Phase 26 : blocs de la fiche appareil (tableau de bord).

/** Étapes d'une mission ouverte : créée → envoyée → vue → acceptée → sur place → remis en service. */
export function EtapesMission({ m, origine }: { m: MissionOuverte; origine?: { libelle: string; quand: Date } | null }) {
  const etapes: { libelle: string; fait: boolean; alerte?: boolean }[] = [
    { libelle: origine ? `${origine.libelle} ${heure(origine.quand)}` : "Créée", fait: true },
    { libelle: m.envoyeeLe ? `Envoyée ${heure(m.envoyeeLe)}` : m.technicienId ? "À envoyer" : "À affecter", fait: !!m.envoyeeLe, alerte: !m.technicienId || !m.envoyeeLe },
    { libelle: m.vueLe ? `Vue ${heure(m.vueLe)}` : m.envoyeeLe ? "Pas encore vue" : "Vue", fait: !!m.vueLe, alerte: !!m.envoyeeLe && !m.vueLe },
    { libelle: m.accepteeLe ? `Acceptée ${heure(m.accepteeLe)}` : m.refuseeLe ? "Refusée" : "Acceptée", fait: !!m.accepteeLe, alerte: !!m.refuseeLe || (!!m.vueLe && !m.accepteeLe) },
    { libelle: m.dateDebut && m.statut === "en_cours" ? `Sur place ${heure(m.dateDebut)}` : "Sur place", fait: m.statut === "en_cours" },
    { libelle: "Remis en service", fait: false },
  ];
  const premiereAlerte = etapes.findIndex((e) => !e.fait);
  return (
    <ol className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-[11px] text-ink-soft">
      {etapes.map((e, i) => {
        const alerte = i === premiereAlerte && e.alerte;
        return (
          <li key={i} className={`flex flex-col gap-1 ${alerte ? "font-bold text-red-ink" : e.fait ? "text-ink" : ""}`}>
            <span className={`h-[5px] rounded-full ${e.fait ? "bg-green" : alerte ? "bg-red" : "bg-line"}`} />
            {e.libelle}
          </li>
        );
      })}
    </ol>
  );
}

export function GraphiqueMois({ mois }: { mois: { label: string; pannes: number; preventives: number }[] }) {
  const max = Math.max(1, ...mois.map((m) => m.pannes + m.preventives));
  const total = mois.reduce((t, m) => t + m.pannes + m.preventives, 0);
  return (
    <div className="flex flex-col gap-2">
      <div
        className="grid grid-cols-12 gap-1.5 sm:gap-2 items-end h-[120px]"
        role="img"
        aria-label={`Pannes et préventives sur 12 mois : ${mois.map((m) => `${m.label} ${m.pannes} panne(s), ${m.preventives} préventive(s)`).join(" ; ")}`}
      >
        {mois.map((m, i) => (
          <div key={i} className="flex flex-col justify-end gap-0.5 h-full" title={`${m.label} : ${m.pannes} panne(s), ${m.preventives} préventive(s)`}>
            {m.pannes > 0 && <span className="bg-red rounded-[4px]" style={{ height: `${(m.pannes / max) * 100}%`, minHeight: 6 }} />}
            {m.preventives > 0 && <span className="bg-blue rounded-[4px]" style={{ height: `${(m.preventives / max) * 100}%`, minHeight: 6 }} />}
            {m.pannes + m.preventives === 0 && <span className="bg-line rounded-[4px] h-[3px]" />}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-12 gap-1.5 sm:gap-2 text-[11px] text-ink-soft text-center">
        {mois.map((m, i) => (
          <span key={i} className="truncate">
            {m.label}
          </span>
        ))}
      </div>
      <div className="flex gap-4 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px] bg-red" />
          Panne
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px] bg-blue" />
          Préventive / contrôle réalisé
        </span>
        {total === 0 && <span>Aucune intervention sur 12 mois.</span>}
      </div>
    </div>
  );
}

export function LigneHistorique({
  id,
  quand,
  type,
  texte,
  technicien,
  statut,
  valide,
}: {
  id: string;
  quand: Date | null;
  type: string;
  texte: string;
  technicien: string | null;
  statut: string;
  valide: boolean;
}) {
  const point = type === "corrective" ? "bg-red" : type === "systematique" ? "bg-navy" : "bg-blue";
  const libelle = type === "corrective" ? "Dépannage" : type === "systematique" ? "Contrôle" : "Préventive";
  const fini = ["terminee", "validee", "cloturee"].includes(statut);
  return (
    <Link href={`/responsable/missions/${id}`} className="grid grid-cols-[74px_12px_minmax(0,1fr)_auto] gap-3 items-start py-2.5 border-t border-line text-[13px] hover:bg-bg/60 -mx-2 px-2 rounded-lg">
      <span className="text-ink-soft">{quand ? quand.toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"}</span>
      <span className={`w-2.5 h-2.5 rounded-full mt-1 ${point}`} />
      <span className="min-w-0">
        <strong>{libelle}</strong> — {texte}
        {technicien ? <span className="text-ink-soft"> · {technicien}</span> : null}
      </span>
      <span className={`text-xs font-semibold whitespace-nowrap ${valide ? "text-green-ink" : fini ? "text-blue" : statut === "en_cours" ? "text-red-ink" : "text-orange-ink"}`}>
        {valide ? "Validé" : fini ? "Terminé" : statut === "en_cours" ? "● En cours" : "À venir"}
      </span>
    </Link>
  );
}

export function dureeArret(depuis: Date | null) {
  return depuis ? duree(depuis) : null;
}
export { jourCourt };
