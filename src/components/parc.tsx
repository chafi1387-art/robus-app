import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PRIORITES, duree, estArret, jourCourt, type LigneParc, type Priorite } from "@/lib/parc";

// Phase 26 : éléments visuels du parc d'appareils (maquette validée le 08/10).

export const ETAT_APPAREIL: Record<string, { label: string; classe: string }> = {
  hors_service: { label: "Hors service", classe: "bg-[#7B1F17] text-white" },
  en_panne: { label: "En panne", classe: "bg-red text-white" },
  sous_surveillance: { label: "Sous surveillance", classe: "bg-orange-fill text-orange-ink" },
  en_travaux: { label: "En travaux", classe: "bg-orange-fill text-orange-ink" },
  installation: { label: "Installation", classe: "bg-blue-pale text-blue" },
  en_service: { label: "En service", classe: "bg-green-fill text-green-ink" },
};

export function PastilleEtat({ statut, majuscules = false }: { statut: string; majuscules?: boolean }) {
  const e = ETAT_APPAREIL[statut] ?? { label: statut, classe: "bg-blue-pale text-blue" };
  return (
    <span className={`inline-flex items-center text-[11px] font-extrabold rounded-full px-2.5 py-1 whitespace-nowrap ${e.classe} ${majuscules ? "uppercase tracking-wide rounded-md px-1.5 py-0.5" : ""}`}>
      {e.label}
    </span>
  );
}

/** « À l'arrêt depuis 2 j 4 h » — l'information principale demandée. */
export function ArretDepuis({ statut, depuis, grand = false }: { statut: string; depuis: Date | null; grand?: boolean }) {
  if (!estArret(statut) || !depuis) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 font-bold text-red-ink ${grand ? "text-base" : "text-[13px]"}`}>
      <span className="w-2 h-2 rounded-full bg-red animate-pulse" aria-hidden="true" />
      À l&apos;arrêt depuis {duree(depuis)}
    </span>
  );
}

const BADGE_PRIO: Record<Priorite, string> = {
  1: "bg-red text-white",
  2: "bg-red-fill text-red-ink",
  3: "bg-orange-fill text-orange-ink",
  4: "bg-green-fill text-green-ink",
};
const BARRE_PRIO: Record<Priorite, string> = { 1: "bg-red", 2: "bg-[#E8857B]", 3: "bg-orange", 4: "bg-green" };

export function BadgePriorite({ p, compte }: { p: Priorite; compte?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold rounded-full px-2.5 py-1 ${BADGE_PRIO[p]}`}>
      {PRIORITES[p].code} {PRIORITES[p].label}
      {compte !== undefined ? ` ${compte}` : ""}
    </span>
  );
}

/** Ligne de la liste « À traiter en priorité ». */
export function LignePriorite({ l }: { l: LigneParc }) {
  return (
    <div className="relative grid grid-cols-1 md:grid-cols-[130px_minmax(0,1.3fr)_minmax(0,1.5fr)_auto] gap-x-4 gap-y-1.5 items-center pl-5 pr-4 py-3.5 border-b border-line last:border-0 hover:bg-bg/60">
      <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${BARRE_PRIO[l.priorite]}`} aria-hidden="true" />
      <div className="flex md:flex-col items-center md:items-start gap-2 md:gap-1">
        <Link href={`/responsable/appareils/${l.id}`} className="font-display font-extrabold text-base text-navy hover:underline">
          {l.numero}
        </Link>
        <PastilleEtat statut={l.statut} majuscules />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">{l.client ?? "Sans client"}</div>
        <div className="text-xs text-ink-soft truncate">{[l.adresse, [l.marque, l.modele].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</div>
        <ArretDepuis statut={l.statut} depuis={l.statutDepuis} />
      </div>
      <div className="min-w-0">
        <div className={`text-[13px] font-bold ${l.priorite <= 2 && !l.raison.startsWith("Technicien sur place") ? "text-red-ink" : l.raison.startsWith("Technicien sur place") ? "text-blue" : "text-orange-ink"}`}>
          {l.raison.startsWith("Technicien sur place") ? "● " : ""}
          {l.raison}
        </div>
        {l.detail && <div className="text-xs text-ink-soft">{l.detail}</div>}
      </div>
      {l.action && (
        <Link
          href={l.action.href}
          className={`justify-self-start md:justify-self-end text-[13px] font-bold rounded-[10px] px-3 py-2 whitespace-nowrap ${
            l.action.fort ? "bg-red text-white hover:opacity-90" : l.priorite <= 2 && l.action.label.startsWith("Relancer") ? "border-[1.5px] border-red text-red-ink hover:bg-red-fill" : "border-[1.5px] border-[#B9D3EE] text-blue hover:bg-blue-pale"
          }`}
        >
          {l.action.label}
        </Link>
      )}
    </div>
  );
}

function Mini({ valeur, libelle, ton = "neutre" }: { valeur: string; libelle: string; ton?: "neutre" | "rouge" | "bleu" | "vert" }) {
  const fond = ton === "rouge" ? "bg-red-fill" : ton === "bleu" ? "bg-blue-pale" : "bg-bg";
  const texte = ton === "rouge" ? "text-red-ink" : ton === "bleu" ? "text-blue" : ton === "vert" ? "text-green-ink" : "text-navy";
  return (
    <div className={`${fond} rounded-[10px] px-2 py-2 min-w-0`}>
      <div className={`font-display font-extrabold text-[17px] leading-tight ${texte} truncate`}>{valeur}</div>
      <div className="text-[11px] text-ink-soft truncate">{libelle}</div>
    </div>
  );
}

/** Carte d'un appareil (vue « cartes »). */
export function CarteAppareil({ l }: { l: LigneParc }) {
  const arret = estArret(l.statut);
  const m = l.mission;
  const enCours = m?.statut === "en_cours";
  const ligneMission = enCours
    ? { texte: `● ${m!.technicien ?? "Technicien"} sur place${m!.dateDebut ? ` depuis ${duree(m!.dateDebut)}` : ""}`, classe: "text-blue" }
    : l.priorite <= 3 && l.raison
      ? { texte: l.raison, classe: l.priorite <= 2 ? "text-red-ink" : "text-orange-ink" }
      : m
        ? { texte: `Mission prévue le ${jourCourt(m.dateProgrammee)}${m.technicien ? ` · ${m.technicien}` : ""}`, classe: "text-ink-soft" }
        : { texte: "RAS", classe: "text-ink-soft" };
  return (
    <Link
      href={`/responsable/appareils/${l.id}`}
      className={`bg-surface rounded-2xl p-4 flex flex-col gap-3 hover:shadow-md transition-shadow ${arret ? "border-[1.5px] border-[#E7A39B]" : l.priorite === 3 ? "border border-[#F0C9A5]" : "border border-line"}`}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="font-display font-extrabold text-lg text-navy">{l.numero}</div>
          <div className="text-xs text-ink-soft truncate">
            {[[l.marque, l.modele].filter(Boolean).join(" "), l.annee, l.niveaux ? `${l.niveaux} niveaux` : null].filter(Boolean).join(" · ") || "Caractéristiques à compléter"}
          </div>
        </div>
        <PastilleEtat statut={l.statut} />
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold truncate">{l.client ?? "Sans client"}</div>
        <ArretDepuis statut={l.statut} depuis={l.statutDepuis} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Mini valeur={String(l.pannes90)} libelle={l.pannes90 > 1 ? "pannes / 90 j" : "panne / 90 j"} ton={l.pannes90 >= 3 ? "rouge" : l.pannes90 === 0 ? "vert" : "neutre"} />
        <Mini valeur={enCours ? "●" : String(l.missions.length)} libelle={enCours ? "sur place" : l.missions.length > 1 ? "missions ouvertes" : "mission ouverte"} ton={enCours ? "bleu" : "neutre"} />
        {l.prochaineVisite ? (
          <Mini valeur={jourCourt(l.prochaineVisite)} libelle="prochaine visite" />
        ) : (
          <Mini
            valeur={l.couvertureFin ? l.couvertureFin.toLocaleDateString("fr-BE", { month: "2-digit", year: "2-digit" }) : "—"}
            libelle={l.couvertureFin ? "fin contrat" : "sans contrat"}
          />
        )}
      </div>
      <div className={`text-xs font-semibold flex items-center gap-1 ${ligneMission.classe}`}>
        <span className="flex-1 truncate">{ligneMission.texte}</span>
        <ChevronRight className="w-4 h-4 text-ink-soft shrink-0" />
      </div>
    </Link>
  );
}
