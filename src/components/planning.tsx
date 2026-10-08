import Link from "next/link";
import { BadgeEnCours } from "@/components/kit-tableau";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { BadgePriorite } from "@/components/parc";
import { inputClass } from "@/components/ui";
import { assignerIntervention, relancerMission } from "@/app/responsable/actions";
import { libelleRefus } from "@/lib/missions";
import {
  TYPES_MISSION,
  duree,
  estEnRetard,
  etatVisuel,
  heure,
  heureProg,
  quand,
  type EtatVisuel,
  type FormationPlanning,
  type LigneATraiter,
  type MissionPlanning,
} from "@/lib/planning";

// Phase 27 : éléments visuels du planning (maquette validée le 08/10/2026).
// Une seule légende : la même couleur veut dire la même chose partout
// (puce de la semaine, carte du jour, carte mobile).

export const ETATS: Record<EtatVisuel, { label: string; puce: string; bord: string; badge: string }> = {
  en_cours: { label: "Sur place", puce: "bg-red text-white font-bold", bord: "border-[1.5px] border-red", badge: "" },
  refusee: { label: "Refusée", puce: "bg-red-fill text-red-ink font-bold border border-red", bord: "border-[1.5px] border-red", badge: "bg-red-fill text-red-ink" },
  non_vue: { label: "Pas encore vue", puce: "bg-surface border-[1.5px] border-dashed border-red text-red-ink font-bold", bord: "border-[1.5px] border-dashed border-red", badge: "text-red-ink" },
  a_accepter: { label: "Vue · à accepter", puce: "bg-surface border-[1.5px] border-dashed border-red text-red-ink font-semibold", bord: "border-[1.5px] border-dashed border-red", badge: "text-red-ink" },
  non_envoyee: { label: "Pas envoyée", puce: "bg-surface border-[1.5px] border-dashed border-red text-red-ink font-semibold", bord: "border-[1.5px] border-dashed border-red", badge: "text-red-ink" },
  acceptee: { label: "Acceptée", puce: "bg-blue-pale text-blue font-semibold border border-[#B9D3EE]", bord: "border border-[#B9D3EE]", badge: "bg-blue-pale text-blue" },
  a_affecter: { label: "À affecter", puce: "bg-surface border-[1.5px] border-dashed border-orange text-orange-ink font-bold", bord: "border-[1.5px] border-dashed border-orange", badge: "bg-orange-fill text-orange-ink" },
  terminee: { label: "Terminée", puce: "bg-green-fill text-green-ink font-semibold", bord: "border border-line", badge: "bg-green-fill text-green-ink" },
  validee: { label: "Validée", puce: "bg-green-fill text-green-ink font-semibold", bord: "border border-line", badge: "bg-green-fill text-green-ink" },
};
export const PUCE_FORMATION = "bg-[#F1E9FB] text-[#5B2A86] font-semibold";

export const LEGENDE_PLANNING = [
  { classe: "bg-red", texte: "En cours (sur place)" },
  { classe: "border-[1.5px] border-dashed border-red", texte: "Envoyée, pas vue / pas acceptée" },
  { classe: "bg-blue-pale border border-[#B9D3EE]", texte: "Acceptée" },
  { classe: "border-[1.5px] border-dashed border-orange", texte: "À affecter" },
  { classe: "bg-green-fill", texte: "Terminée / validée" },
  { classe: "bg-[#F1E9FB]", texte: "Formation" },
];

const lien = (m: { id: string }) => `/responsable/missions/${m.id}`;
const fini = (e: EtatVisuel) => e === "terminee" || e === "validee";

/** Texte d'état court (« Sur place depuis 25 min », « Envoyée il y a 45 min · pas encore vue »…). */
export function texteEtat(m: MissionPlanning, maintenant: number) {
  const e = etatVisuel(m);
  switch (e) {
    case "en_cours":
      return `Sur place depuis ${duree(m.dateDebut, maintenant) || "—"}`;
    case "refusee":
      return `Refusée : ${libelleRefus(m.refusMotif)}`;
    case "non_vue":
      return `Envoyée il y a ${duree(m.envoyeeLe, maintenant)} · pas encore vue`;
    case "a_accepter":
      return `Vue ${heure(m.vueLe)} · pas encore acceptée`;
    case "non_envoyee":
      return "Pas encore envoyée au technicien";
    case "acceptee":
      return `Acceptée ${heure(m.accepteeLe)}`;
    case "a_affecter":
      return "Sans technicien";
    default:
      return m.rapportEnvoyeLe ? `Rapport envoyé ${heure(m.rapportEnvoyeLe)}` : m.dateFin ? `Terminée ${heure(m.dateFin)}` : ETATS[e].label;
  }
}

function details(m: MissionPlanning) {
  return [
    m.photos ? `${m.photos} photo${m.photos > 1 ? "s" : ""}${m.statut === "en_cours" ? " en direct" : ""}` : null,
    m.checklist ? `checklist ${m.checklist.faites}/${m.checklist.total}${m.checklist.faites === m.checklist.total ? " ✓" : ""}` : null,
  ].filter(Boolean);
}

/** Puce d'une mission dans la grille Semaine / Mois. */
export function PuceMission({ m, maintenant, avecTechnicien = false }: { m: MissionPlanning; maintenant: number; avecTechnicien?: boolean }) {
  const e = etatVisuel(m);
  const retard = estEnRetard(m, maintenant);
  return (
    <Link
      href={lien(m)}
      title={`${m.numero} · ${m.client ?? ""} — ${texteEtat(m, maintenant)}`}
      className={`block text-[11px] leading-snug rounded-lg px-[7px] py-[5px] hover:shadow-sm hover:-translate-y-px transition ${ETATS[e].puce} ${retard ? "ring-2 ring-red/40" : ""}`}
    >
      <span className="block truncate">
        {e === "en_cours" ? "● " : fini(e) ? "✓ " : ""}
        {heureProg(m.dateProgrammee)} {m.numero}
      </span>
      <span className="block truncate opacity-90 font-normal">
        {retard ? "En retard" : e === "acceptee" || fini(e) ? TYPES_MISSION[m.type] ?? m.type : ETATS[e].label}
        {avecTechnicien && m.technicien ? ` · ${m.technicien}` : ""}
      </span>
    </Link>
  );
}

export function PuceFormation({ f }: { f: FormationPlanning }) {
  return (
    <Link href={`/responsable/habilitations/sessions/${f.id}`} className={`block text-[11px] leading-snug rounded-lg px-[7px] py-[5px] ${PUCE_FORMATION}`} title={f.titre}>
      <span className="block">Formation {heureProg(f.debut)}</span>
      <span className="block truncate font-normal">{f.titre}</span>
    </Link>
  );
}

/** Étapes d'une mission : Envoyée → Vue → Acceptée → Sur place → Rapport. */
export function EtapesEnvoi({ m }: { m: MissionPlanning }) {
  const etapes: { label: string; t: Date | null }[] = [
    { label: "Envoyée", t: m.envoyeeLe },
    { label: "Vue", t: m.vueLe },
    { label: "Acceptée", t: m.accepteeLe },
    { label: "Sur place", t: m.dateDebut },
    { label: "Rapport", t: m.rapportEnvoyeLe ?? m.dateFin },
  ];
  const courant = etapes.findIndex((x) => !x.t) - 1;
  return (
    <ol className="grid grid-cols-5 gap-1.5 text-[11px] text-ink-soft" aria-label="Étapes de la mission">
      {etapes.map((x, i) => {
        const fait = !!x.t;
        const actif = fait && i === courant && m.statut === "en_cours" && i === 3;
        return (
          <li key={x.label} className={`flex flex-col gap-1 min-w-0 ${actif ? "font-bold text-red-ink" : ""}`}>
            <span className={`h-[5px] rounded-full ${actif ? "bg-red" : fait ? "bg-green" : "bg-line"}`} />
            <span className="truncate">
              {x.label}
              {x.t ? ` ${heure(x.t)}` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function BadgeEtat({ m }: { m: MissionPlanning }) {
  const e = etatVisuel(m);
  if (e === "en_cours") return <BadgeEnCours />;
  if (e === "non_vue" || e === "a_accepter" || e === "non_envoyee") return null;
  return <span className={`text-[11px] font-extrabold uppercase rounded-full px-2.5 py-1 whitespace-nowrap ${ETATS[e].badge}`}>{ETATS[e].label}</span>;
}

function BadgeArret({ m, maintenant }: { m: MissionPlanning; maintenant: number }) {
  if (m.appareilStatut !== "en_panne" && m.appareilStatut !== "hors_service") return null;
  return (
    <span className={`inline-flex text-[10.5px] font-extrabold uppercase rounded-md px-1.5 py-0.5 text-white whitespace-nowrap ${m.appareilStatut === "hors_service" ? "bg-[#7B1F17]" : "bg-red"}`}>
      {m.appareilStatut === "hors_service" ? "Hors service" : "En panne"}
      {m.appareilDepuis ? ` · ${duree(m.appareilDepuis, maintenant)}` : ""}
    </span>
  );
}

type Tech = { id: string; nom: string };

/** Bouton « Affecter » + petit formulaire (date + technicien) — envoie la mission. */
export function FormAffecter({ m, techniciens, retour, ouvert = false, libelle = "Affecter" }: { m: MissionPlanning; techniciens: Tech[]; retour: string; ouvert?: boolean; libelle?: string }) {
  return (
    <details className="relative" open={ouvert}>
      <summary className="list-none cursor-pointer text-[13px] font-bold rounded-[10px] px-3 py-2 bg-orange text-white hover:opacity-90 whitespace-nowrap text-center">{libelle}</summary>
      <form action={assignerIntervention} className="absolute z-30 left-0 md:left-auto md:right-0 top-full mt-2 w-[min(18rem,calc(100vw-2.5rem))] bg-surface border border-line rounded-xl shadow-lg p-3 flex flex-col gap-2">
        <input type="hidden" name="interventionId" value={m.id} />
        <input type="hidden" name="retour" value={retour} />
        <label className="text-xs font-semibold text-ink-soft">
          Date et heure
          <input type="datetime-local" name="dateProgrammee" required={!m.dateProgrammee} defaultValue={m.dateProgrammee ? m.dateProgrammee.toISOString().slice(0, 16) : ""} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-xs font-semibold text-ink-soft">
          Technicien
          <select name="technicienId" required defaultValue={m.technicienId ?? ""} className={`${inputClass} mt-1`}>
            <option value="" disabled>
              Choisir…
            </option>
            {techniciens.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nom}
              </option>
            ))}
          </select>
        </label>
        <BoutonEnvoi type="submit" enCours="Envoi…" className="mt-1 rounded-lg bg-blue text-white font-display font-bold text-sm py-2 hover:bg-blue-light">
          Affecter et envoyer
        </BoutonEnvoi>
      </form>
    </details>
  );
}

/** Bouton « Relancer » : renvoie la mission (application + téléphone + email). */
export function FormRelancer({ m, retour, plein = false }: { m: MissionPlanning; retour: string; plein?: boolean }) {
  if (!m.projetId || !m.technicienId) {
    return (
      <Link href={lien(m)} className="text-[13px] font-bold rounded-[10px] px-3 py-2 border-[1.5px] border-red text-red-ink hover:bg-red-fill whitespace-nowrap text-center">
        Voir
      </Link>
    );
  }
  return (
    <form action={relancerMission} className={plein ? "w-full" : ""}>
      <input type="hidden" name="interventionId" value={m.id} />
      <input type="hidden" name="retour" value={retour} />
      <BoutonEnvoi
        type="submit"
        enCours="Envoi…"
        className={`text-[13px] font-bold rounded-[10px] px-3 py-2 border-[1.5px] border-red text-red-ink hover:bg-red-fill whitespace-nowrap ${plein ? "w-full py-2.5 text-sm" : ""}`}
      >
        Relancer
      </BoutonEnvoi>
    </form>
  );
}

function Action({ l, techniciens, retour, ouvert }: { l: LigneATraiter; techniciens: Tech[]; retour: string; ouvert: boolean }) {
  if (l.action === "affecter") return <FormAffecter m={l.m} techniciens={techniciens} retour={retour} ouvert={ouvert} />;
  if (l.action === "relancer") return <FormRelancer m={l.m} retour={retour} />;
  const label = l.action === "decider" ? "Décider" : l.action === "replanifier" ? "Replanifier" : "Voir";
  return (
    <Link
      href={lien(l.m)}
      className={`text-[13px] font-bold rounded-[10px] px-3 py-2 whitespace-nowrap text-center ${l.action === "decider" ? "bg-red text-white hover:opacity-90" : "border-[1.5px] border-[#B9D3EE] text-blue hover:bg-blue-pale"}`}
    >
      {label}
    </Link>
  );
}

const BARRE: Record<1 | 2 | 3, string> = { 1: "bg-red", 2: "bg-[#E8857B]", 3: "bg-orange" };

/** Ligne de « À traiter » — même gabarit que le parc. */
export function LigneTraiter({ l, techniciens, retour, maintenant, ouvert = false }: { l: LigneATraiter; techniciens: Tech[]; retour: string; maintenant: number; ouvert?: boolean }) {
  const m = l.m;
  return (
    <div id={`m-${m.id}`} className="relative grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_auto] gap-x-4 gap-y-1.5 items-center pl-5 pr-4 py-3 border-b border-line last:border-0 hover:bg-bg/60 scroll-mt-24">
      <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${BARRE[l.priorite]}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-sm flex items-center gap-2 flex-wrap">
          <Link href={lien(m)} className="font-display font-extrabold text-navy hover:underline">
            {m.numero}
          </Link>
          <span className="truncate">· {m.client ?? m.projetRef ?? "Sans client"}</span>
          <BadgeArret m={m} maintenant={maintenant} />
        </div>
        <div className="text-xs text-ink-soft truncate">
          {[TYPES_MISSION[m.type] ?? m.type, quand(m.dateProgrammee, maintenant), m.technicien ?? "sans technicien"].join(" · ")}
        </div>
      </div>
      <div className="min-w-0">
        <div className={`text-[13px] font-bold ${l.priorite === 3 ? "text-orange-ink" : "text-red-ink"}`}>{l.raison}</div>
        {l.detail && <div className="text-xs text-ink-soft">{l.detail}</div>}
      </div>
      <div className="justify-self-start md:justify-self-end flex items-center gap-2">
        <span className="md:hidden">
          <BadgePriorite p={l.priorite} />
        </span>
        <Action l={l} techniciens={techniciens} retour={retour} ouvert={ouvert} />
      </div>
    </div>
  );
}

function initiales(nom: string | null) {
  return (nom ?? "?")
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** « Sur le terrain maintenant » : un technicien sur place. */
export function LigneTerrain({ m, maintenant }: { m: MissionPlanning; maintenant: number }) {
  return (
    <Link href={lien(m)} className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-line last:border-0 hover:bg-red-fill/40">
      <span className="w-10 h-10 shrink-0 rounded-full bg-red text-white font-display font-extrabold text-sm flex items-center justify-center">{initiales(m.technicien)}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold truncate">
          {m.technicien} · <span className="font-display font-extrabold text-navy">{m.numero}</span> {m.client ?? ""} <BadgeArret m={m} maintenant={maintenant} />
        </span>
        <span className="block text-xs text-ink-soft truncate">
          {[TYPES_MISSION[m.type] ?? m.type, `sur place depuis ${duree(m.dateDebut, maintenant) || "—"}`, ...details(m), m.passage > 1 ? `passage ${m.passage}` : null].filter(Boolean).join(" · ")}
        </span>
      </span>
      <BadgeEnCours />
    </Link>
  );
}

/** Carte mission standard (vue Jour, listes) — avec les étapes. */
export function CarteMission({ m, maintenant, techniciens, retour }: { m: MissionPlanning; maintenant: number; techniciens: Tech[]; retour: string }) {
  const e = etatVisuel(m);
  const retard = estEnRetard(m, maintenant);
  const attente = e === "non_vue" || e === "a_accepter" || e === "non_envoyee";
  const avecEtapes = e === "en_cours" || ((e === "acceptee" || attente) && !!m.envoyeeLe);
  return (
    <div className={`bg-surface rounded-2xl px-4 py-3.5 flex flex-col gap-2.5 ${ETATS[e].bord} ${fini(e) ? "opacity-85" : ""}`}>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 items-center">
        <div className="min-w-0">
          <div className="text-sm flex items-center gap-2 flex-wrap">
            <Link href={lien(m)} className="font-display font-extrabold text-navy hover:underline">
              {m.numero}
            </Link>
            <span className="truncate">· {m.client ?? m.projetRef ?? "Sans client"}</span>
            <BadgeArret m={m} maintenant={maintenant} />
          </div>
          <div className="text-xs text-ink-soft truncate">
            {[
              TYPES_MISSION[m.type] ?? m.type,
              m.priorite === "haute" || m.priorite === "critique" ? `priorité ${m.priorite}` : null,
              m.passage > 1 ? `passage ${m.passage}` : null,
              m.technicien ?? "sans technicien",
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className={`text-xs ${attente || e === "refusee" || retard ? "font-bold text-red-ink" : "text-ink-soft"}`}>
          {retard ? "En retard · " : ""}
          {[texteEtat(m, maintenant), ...details(m)].join(" · ")}
        </div>
        <div className="justify-self-start md:justify-self-end flex items-center gap-2">
          {e === "a_affecter" ? (
            <FormAffecter m={m} techniciens={techniciens} retour={retour} />
          ) : e === "refusee" ? (
            <Link href={lien(m)} className="text-[13px] font-bold rounded-[10px] px-3 py-2 bg-red text-white hover:opacity-90">
              Décider
            </Link>
          ) : attente ? (
            <FormRelancer m={m} retour={retour} />
          ) : (
            <BadgeEtat m={m} />
          )}
        </div>
      </div>
      {avecEtapes && <EtapesEnvoi m={m} />}
    </div>
  );
}

/** Carte compacte (téléphone). */
export function CarteMobile({ m, maintenant, retour }: { m: MissionPlanning; maintenant: number; retour: string }) {
  const e = etatVisuel(m);
  const retard = estEnRetard(m, maintenant);
  const attente = e === "non_vue" || e === "a_accepter" || e === "non_envoyee";
  return (
    <div className={`bg-surface rounded-2xl p-3.5 flex flex-col gap-1.5 ${ETATS[e].bord} ${fini(e) ? "opacity-85" : ""}`}>
      <Link href={lien(m)} className="flex flex-col gap-1.5">
        <span className="flex justify-between items-center gap-2">
          <span className={`font-display font-extrabold ${e === "en_cours" ? "text-red" : "text-ink-soft"}`}>{heureProg(m.dateProgrammee) || "—"}</span>
          {attente ? <span className="text-[11px] font-extrabold text-red-ink">{ETATS[e].label}</span> : <BadgeEtat m={m} />}
        </span>
        <span className="text-sm">
          <strong className="text-navy">{m.numero}</strong> · {m.client ?? m.projetRef ?? "Sans client"}
        </span>
        <span className="text-[13px] text-ink-soft">
          {m.technicien ?? "Sans technicien"} · {texteEtat(m, maintenant).replace(/^Sur place/, "sur place")}
        </span>
        {retard && <span className="text-xs font-bold text-red-ink">En retard · date dépassée</span>}
      </Link>
      {attente && <FormRelancer m={m} retour={retour} plein />}
    </div>
  );
}
