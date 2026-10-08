import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { Card, Btn } from "@/components/ui";
import { RafraichissementAuto } from "@/components/rafraichissement-auto";
import { Compteur, Legende, PuceFiltre, Section, SelecteurVue } from "@/components/kit-tableau";
import { BadgePriorite } from "@/components/parc";
import { FiltreAuto } from "@/components/filtre-auto";
import {
  CarteMission,
  CarteMobile,
  LEGENDE_PLANNING,
  LigneTerrain,
  LigneTraiter,
  PUCE_FORMATION,
  PuceFormation,
  PuceMission,
} from "@/components/planning";
import {
  TYPES_MISSION,
  ajouterJours,
  ajouterMois,
  aujourdhui,
  bornesVue,
  chargerPlanning,
  cleJour,
  cleValide,
  etatVisuel,
  filtrerParEtat,
  heureProg,
  libelleJour,
  libelleMois,
  type FormationPlanning,
  type MissionPlanning,
  type Vue,
} from "@/lib/planning";
import { formatDate } from "@/lib/format";
import { getDemandesAideOuvertes, getTechniciens, resoudreDemandeAide } from "../actions";
import { VueProjets } from "./vue-projets";

// Phase 27 : Planning des missions (maquette validée le 08/10/2026).
// Vue Semaine par défaut (techniciens × jours), Jour (frise avec étapes),
// Mois, et Par projet (l'ancienne liste, conservée).

function instant() {
  return Date.now();
}

const VUES: { cle: Vue; label: string }[] = [
  { cle: "jour", label: "Jour" },
  { cle: "semaine", label: "Semaine" },
  { cle: "mois", label: "Mois" },
  { cle: "projet", label: "Par projet" },
];
const FILTRES_ETAT = ["encours", "pasacceptees", "affecter", "retard"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SP = { vue?: string; d?: string; t?: string; type?: string; f?: string; affecter?: string };

export default async function PlanningPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const maintenant = instant();
  const auj = aujourdhui(maintenant);
  const vue: Vue = sp.vue === "jour" || sp.vue === "mois" || sp.vue === "projet" ? sp.vue : "semaine";
  const jour = cleValide(sp.d) ? sp.d : auj;
  const technicienId = sp.t && UUID.test(sp.t) ? sp.t : null;
  const type = sp.type && TYPES_MISSION[sp.type] ? sp.type : null;
  const f = sp.f && (FILTRES_ETAT as readonly string[]).includes(sp.f) ? sp.f : null;

  const [p, techniciens, demandesAide] = await Promise.all([
    chargerPlanning({ vue, jour, technicienId, type, maintenant }),
    getTechniciens(),
    getDemandesAideOuvertes(),
  ]);
  const k = p.compteurs;

  const lien = (x: Partial<Record<keyof SP, string | null>>) => {
    const u = new URLSearchParams();
    const v: Record<string, string | null | undefined> = {
      vue: vue === "semaine" ? null : vue,
      d: jour === auj ? null : jour,
      t: technicienId,
      type,
      f,
      ...x,
    };
    for (const [c, val] of Object.entries(v)) if (val) u.set(c, val);
    const s = u.toString();
    return `/responsable/interventions${s ? `?${s}` : ""}`;
  };
  const retour = lien({});
  const pas = (n: number) => (vue === "jour" ? ajouterJours(jour, n) : vue === "mois" ? ajouterMois(jour, n) : ajouterJours(jour, 7 * n));
  const missions = filtrerParEtat(p.periode, f, maintenant);

  const titre =
    vue === "jour"
      ? libelleJour(jour, "titre")
      : vue === "mois"
        ? libelleMois(jour)
        : vue === "projet"
          ? "Toutes les missions, par projet"
          : (() => {
              const { debut, fin } = bornesVue("semaine", jour);
              const d1 = new Date(`${debut}T12:00:00Z`);
              const d2 = new Date(`${fin}T12:00:00Z`);
              const mois = (d: Date) => d.toLocaleDateString("fr-BE", { timeZone: "UTC", month: "long" });
              return `Semaine du ${d1.getUTCDate()}${mois(d1) !== mois(d2) ? ` ${mois(d1)}` : ""} au ${d2.getUTCDate()} ${mois(d2)}`;
            })();

  const nbP = (n: 1 | 2 | 3) => p.aTraiter.filter((l) => l.priorite === n).length;
  const visibles = p.aTraiter.slice(0, 8);
  const autres = p.aTraiter.slice(8);

  return (
    <div className="flex flex-col gap-5 max-w-[1240px]">
      {/* En-tête */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-extrabold text-[26px] sm:text-[28px] text-navy leading-tight">Planning des missions</h1>
          <div className="text-sm text-ink-soft flex items-center gap-3 flex-wrap">
            <span>{titre}</span>
            <RafraichissementAuto />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center w-full sm:w-auto">
          <SelecteurVue actif={vue} options={VUES.map((v) => ({ cle: v.cle, label: v.label, href: lien({ vue: v.cle === "semaine" ? null : v.cle }) }))} />
          {vue !== "projet" && (
            <div className="flex gap-1.5">
              <Link href={lien({ d: pas(-1) })} className="h-[38px] inline-flex items-center gap-1 px-2.5 rounded-[10px] border border-line bg-surface text-[13px] font-semibold hover:bg-blue-pale" aria-label="Période précédente">
                <ChevronLeft className="w-4 h-4" /> <span className="hidden sm:inline">Préc.</span>
              </Link>
              <Link href={lien({ d: null })} className="h-[38px] inline-flex items-center px-3 rounded-[10px] border border-line bg-surface text-[13px] font-semibold hover:bg-blue-pale">
                Aujourd&apos;hui
              </Link>
              <Link href={lien({ d: pas(1) })} className="h-[38px] inline-flex items-center gap-1 px-2.5 rounded-[10px] border border-line bg-surface text-[13px] font-semibold hover:bg-blue-pale" aria-label="Période suivante">
                <span className="hidden sm:inline">Suiv.</span> <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          )}
          <Link href="/responsable/projets" title="Une mission se crée dans son projet" className="h-[38px] inline-flex items-center gap-1.5 px-3.5 rounded-[10px] bg-blue text-white font-display font-bold text-[13px] hover:bg-blue-light">
            <Plus className="w-4 h-4" /> Nouvelle mission
          </Link>
          <Link href="/api/export/interventions" title="Exporter en CSV" className="h-[38px] inline-flex items-center gap-1.5 px-3 rounded-[10px] border border-line bg-surface text-[13px] font-semibold hover:bg-blue-pale">
            <Download className="w-4 h-4" /> <span className="hidden sm:inline">CSV</span>
          </Link>
        </div>
      </div>

      {/* Compteurs */}
      <div className="grid grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3">
        <Compteur titre="En cours" point valeur={k.enCours} sous={k.enCours ? `technicien${k.enCours > 1 ? "s" : ""} sur place` : "personne sur place"} ton={k.enCours ? "rouge-plein" : "neutre"} href={lien({ f: f === "encours" ? null : "encours" })} actif={f === "encours"} />
        <Compteur
          titre="Pas encore acceptées"
          valeur={k.pasAcceptees}
          sous={[k.nonVues30 ? `dont ${k.nonVues30} non vue${k.nonVues30 > 1 ? "s" : ""} > 30 min` : null, k.refusees ? `${k.refusees} refusée${k.refusees > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ") || "en attente du technicien"}
          ton={k.pasAcceptees ? "rouge" : "neutre"}
          href={lien({ f: f === "pasacceptees" ? null : "pasacceptees" })}
          actif={f === "pasacceptees"}
        />
        <Compteur titre="À affecter" valeur={k.aAffecter} sous="sans technicien" ton={k.aAffecter ? "orange" : "neutre"} href={lien({ f: f === "affecter" ? null : "affecter" })} actif={f === "affecter"} />
        <Compteur titre="En retard" valeur={k.enRetard} sous="date dépassée" ton={k.enRetard ? "rouge" : "neutre"} href={lien({ f: f === "retard" ? null : "retard" })} actif={f === "retard"} />
        <Compteur titre="Aujourd'hui" valeur={k.aujourdhui} sous={k.aujourdhuiTerminees ? `dont ${k.aujourdhuiTerminees} terminée${k.aujourdhuiTerminees > 1 ? "s" : ""}` : "missions du jour"} ton="bleu" href={lien({ vue: "jour", d: null, f: null })} />
        <Compteur
          titre={vue === "jour" ? "Ce jour" : vue === "mois" ? "Ce mois" : "Cette semaine"}
          valeur={vue === "mois" ? p.periode.filter((m) => m.dateProgrammee && cleJour(m.dateProgrammee).slice(0, 7) === jour.slice(0, 7)).length : k.periode}
          sous={`${k.techniciensPeriode} technicien${k.techniciensPeriode > 1 ? "s" : ""}`}
          ton="neutre"
        />
      </div>

      {/* Demandes d'aide (urgentes) */}
      {demandesAide.length > 0 && (
        <Card className="p-4 sm:p-5 border-red border-[1.5px]">
          <h2 className="font-display font-bold text-sm mb-2 text-red-ink">🆘 Demandes d&apos;aide en cours ({demandesAide.length})</h2>
          <div className="flex flex-col divide-y divide-line">
            {demandesAide.map((d) => (
              <div key={d.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {d.technicienNom} —{" "}
                    <Link href={`/responsable/missions/${d.interventionId}`} className="text-blue hover:underline">
                      {d.numeroInterne ?? "Appareil inconnu"}
                    </Link>
                  </div>
                  {d.message && <div className="text-xs text-ink-soft">{d.message}</div>}
                  <div className="text-xs text-ink-soft">{formatDate(d.createdAt)}</div>
                </div>
                <form action={resoudreDemandeAide}>
                  <input type="hidden" name="id" value={d.id} />
                  <Btn type="submit" variant="ghost" className="!px-3 !py-1.5 !text-xs">
                    Marquer résolu
                  </Btn>
                </form>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Sur le terrain maintenant */}
      <Section titre="Sur le terrain maintenant" droite={<span className="text-xs text-ink-soft">mis à jour en direct</span>}>
        {p.terrain.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-soft">Aucun technicien sur place en ce moment.</p>
        ) : (
          p.terrain.map((m) => <LigneTerrain key={m.id} m={m} maintenant={maintenant} />)
        )}
      </Section>

      {/* À traiter */}
      <Section
        id="a-traiter"
        titre="À traiter"
        droite={
          <div className="flex gap-1.5 flex-wrap">
            {([1, 2, 3] as const).map((n) => (nbP(n) ? <BadgePriorite key={n} p={n} compte={nbP(n)} /> : null))}
          </div>
        }
      >
        {p.aTraiter.length === 0 ? (
          <p className="px-5 py-4 text-sm text-green-ink font-semibold">Rien à traiter : toutes les missions sont affectées et acceptées ✓</p>
        ) : (
          <>
            {visibles.map((l) => (
              <LigneTraiter key={l.m.id} l={l} techniciens={techniciens} retour={retour} maintenant={maintenant} ouvert={sp.affecter === l.m.id} />
            ))}
            {autres.length > 0 && (
              <details className="group" open={autres.some((l) => l.m.id === sp.affecter)}>
                <summary className="list-none cursor-pointer px-5 py-3 text-sm font-bold text-blue hover:bg-blue-pale/50">
                  <span className="group-open:hidden">Voir les {autres.length} autres</span>
                  <span className="hidden group-open:inline">Masquer</span>
                </summary>
                {autres.map((l) => (
                  <LigneTraiter key={l.m.id} l={l} techniciens={techniciens} retour={retour} maintenant={maintenant} ouvert={sp.affecter === l.m.id} />
                ))}
              </details>
            )}
          </>
        )}
      </Section>

      {/* Filtres */}
      <div className="flex gap-1.5 flex-wrap items-center" role="group" aria-label="Filtres">
        {vue !== "projet" && (
          <>
            <PuceFiltre href={lien({ f: null })} actif={!f}>
              Toutes {p.periode.length}
            </PuceFiltre>
            <PuceFiltre href={lien({ f: "encours" })} actif={f === "encours"} ton="rouge">
              ● En cours {k.enCours}
            </PuceFiltre>
            <PuceFiltre href={lien({ f: "pasacceptees" })} actif={f === "pasacceptees"} ton="rouge">
              Pas acceptées {k.pasAcceptees}
            </PuceFiltre>
            <PuceFiltre href={lien({ f: "affecter" })} actif={f === "affecter"}>
              À affecter {k.aAffecter}
            </PuceFiltre>
          </>
        )}
        <form action="/responsable/interventions" className="flex gap-1.5 flex-wrap">
          {vue !== "semaine" && <input type="hidden" name="vue" value={vue} />}
          {jour !== auj && <input type="hidden" name="d" value={jour} />}
          {f && <input type="hidden" name="f" value={f} />}
          <FiltreAuto name="t" label="Technicien" valeur={technicienId ?? ""} options={[{ valeur: "", label: "Technicien : tous" }, ...techniciens.map((t) => ({ valeur: t.id, label: t.nom }))]} />
          <FiltreAuto name="type" label="Type" valeur={type ?? ""} options={[{ valeur: "", label: "Type : tous" }, ...Object.entries(TYPES_MISSION).map(([v, l]) => ({ valeur: v, label: l }))]} />
          <noscript>
            <button className="h-[34px] px-3 rounded-full border border-line bg-surface text-[13px]">Filtrer</button>
          </noscript>
        </form>
      </div>

      {vue === "semaine" && <VueSemaine p={p} missions={missions} maintenant={maintenant} auj={auj} lien={lien} technicienFiltre={!!technicienId} retour={retour} />}
      {vue === "jour" && <VueJour jour={jour} missions={missions} formations={p.formations} maintenant={maintenant} techniciens={techniciens} retour={retour} nomsTech={new Map(techniciens.map((t) => [t.id, t.nom]))} />}
      {vue === "mois" && <VueMois jour={jour} missions={missions} formations={p.formations} maintenant={maintenant} auj={auj} lien={lien} />}
      {vue === "projet" && <VueProjets technicienId={technicienId} type={type} techniciens={techniciens} />}

      {vue !== "projet" && <Legende items={LEGENDE_PLANNING} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

type Charge = Awaited<ReturnType<typeof chargerPlanning>>;
type Lien = (x: Partial<Record<keyof SP, string | null>>) => string;

function jours(debut: string, n: number) {
  return Array.from({ length: n }, (_, i) => ajouterJours(debut, i));
}

function parJour<T>(items: T[], date: (t: T) => Date | null) {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const d = date(it);
    if (!d) continue;
    const c = cleJour(d);
    m.set(c, [...(m.get(c) ?? []), it]);
  }
  return m;
}

function VueSemaine({ p, missions, maintenant, auj, lien, technicienFiltre, retour }: { p: Charge; missions: MissionPlanning[]; maintenant: number; auj: string; lien: Lien; technicienFiltre: boolean; retour: string }) {
  const js = jours(p.debut, 7);
  const tri = (a: MissionPlanning, b: MissionPlanning) => (a.dateProgrammee?.getTime() ?? 0) - (b.dateProgrammee?.getTime() ?? 0);
  const idsTech = new Set(p.techniciens.map((t) => t.id));
  const lignes: { cle: string; nom: string; sous: string; missions: MissionPlanning[]; formations: FormationPlanning[]; type: "tech" | "affecter" | "autres" }[] = p.techniciens.map((t) => {
    const ms = missions.filter((m) => m.technicienId === t.id);
    const fs = p.formations.filter((x) => x.technicienId === t.id);
    const refus = ms.filter((m) => etatVisuel(m) === "refusee").length;
    return {
      cle: t.id,
      nom: t.nom,
      sous: [`${ms.length} mission${ms.length > 1 ? "s" : ""}`, fs.length ? `${fs.length} formation${fs.length > 1 ? "s" : ""}` : null, refus ? `${refus} refus` : null].filter(Boolean).join(" · "),
      missions: ms,
      formations: fs,
      type: "tech",
    };
  });
  const autres = missions.filter((m) => m.technicienId && !idsTech.has(m.technicienId));
  if (autres.length) lignes.push({ cle: "autres", nom: "Autres", sous: "technicien désactivé", missions: autres, formations: [], type: "autres" });
  if (!technicienFiltre) {
    const sans = missions.filter((m) => !m.technicienId);
    lignes.push({ cle: "affecter", nom: "À affecter", sous: sans.length ? "bouton « Affecter » dans À traiter" : "rien à affecter", missions: sans, formations: [], type: "affecter" });
  }
  const mobileParJour = parJour([...missions].sort(tri), (m) => m.dateProgrammee);
  const formationsParJour = parJour(p.formations, (x) => x.debut);

  return (
    <>
      {/* Ordinateur / tablette : techniciens × jours */}
      <section className="hidden md:block bg-surface border border-line rounded-2xl overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[170px_repeat(7,minmax(0,1fr))] border-b border-line bg-bg/60 text-xs font-bold text-ink-soft">
            <span className="px-3.5 py-2.5">Technicien</span>
            {js.map((j) => (
              <Link key={j} href={lien({ vue: "jour", d: j === auj ? null : j })} className={`px-2 py-2.5 hover:text-navy ${j === auj ? "text-blue bg-blue-pale/60" : ""}`}>
                {libelleJour(j)}
                {j === auj ? " · aujourd'hui" : ""}
              </Link>
            ))}
          </div>
          {lignes.map((l) => {
            const ms = parJour([...l.missions].sort(tri), (m) => m.dateProgrammee);
            const fs = parJour(l.formations, (x) => x.debut);
            return (
              <div key={l.cle} className={`grid grid-cols-[170px_repeat(7,minmax(0,1fr))] border-b border-line last:border-0 ${l.type === "affecter" ? "bg-[#FFFBF6] min-h-[64px]" : "min-h-[88px]"}`}>
                <div className="px-3.5 py-3 flex flex-col gap-0.5 min-w-0">
                  {l.type === "tech" ? (
                    <Link href={lien({ t: l.cle })} className="text-sm font-bold hover:text-blue truncate" title={`Voir seulement ${l.nom}`}>
                      {l.nom}
                    </Link>
                  ) : (
                    <strong className={`text-sm ${l.type === "affecter" ? "text-orange-ink" : ""}`}>{l.nom}</strong>
                  )}
                  <span className="text-[11px] text-ink-soft">{l.sous}</span>
                </div>
                {js.map((j) => (
                  <div key={j} className={`p-1.5 flex flex-col gap-1 min-w-0 ${j === auj ? "bg-blue-pale/40" : ""}`}>
                    {(fs.get(j) ?? []).map((x) => (
                      <PuceFormation key={x.id} f={x} />
                    ))}
                    {(ms.get(j) ?? []).map((m) => (
                      <PuceMission key={m.id} m={m} maintenant={maintenant} />
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
          {lignes.length === 0 && <p className="px-5 py-4 text-sm text-ink-soft">Aucun technicien actif.</p>}
        </div>
      </section>

      {/* Téléphone : jour par jour */}
      <div className="md:hidden flex flex-col gap-3">
        {js.filter((j) => mobileParJour.has(j) || formationsParJour.has(j)).length === 0 && (
          <Card className="p-4 text-sm text-ink-soft">Aucune mission cette semaine.</Card>
        )}
        {js
          .filter((j) => mobileParJour.has(j) || formationsParJour.has(j))
          .map((j) => (
            <div key={j} className="flex flex-col gap-2">
              <h2 className={`font-display font-extrabold text-base mt-1 ${j === auj ? "text-blue" : "text-navy"}`}>
                {libelleJour(j, "titre")}
                {j === auj ? " · aujourd'hui" : ""}
              </h2>
              {(formationsParJour.get(j) ?? []).map((x) => (
                <div key={`${x.id}-${x.technicienId}`} className={`rounded-2xl px-3.5 py-2.5 text-sm ${PUCE_FORMATION}`}>
                  {heureProg(x.debut)} · Formation « {x.titre} » · {p.techniciens.find((t) => t.id === x.technicienId)?.nom ?? ""}
                </div>
              ))}
              {(mobileParJour.get(j) ?? []).map((m) => (
                <CarteMobile key={m.id} m={m} maintenant={maintenant} retour={retour} />
              ))}
            </div>
          ))}
      </div>
    </>
  );
}

function VueJour({
  jour,
  missions,
  formations,
  maintenant,
  techniciens,
  retour,
  nomsTech,
}: {
  jour: string;
  missions: MissionPlanning[];
  formations: FormationPlanning[];
  maintenant: number;
  techniciens: { id: string; nom: string }[];
  retour: string;
  nomsTech: Map<string, string>;
}) {
  const duJour = missions.filter((m) => m.dateProgrammee && cleJour(m.dateProgrammee) === jour);
  const fs = formations.filter((x) => cleJour(x.debut) === jour);
  const nb = (pred: (m: MissionPlanning) => boolean) => duJour.filter(pred).length;
  const enCours = nb((m) => m.statut === "en_cours");
  const finies = nb((m) => ["terminee", "validee", "cloturee"].includes(m.statut));
  type Item = { t: number; cle: string; m?: MissionPlanning; f?: FormationPlanning };
  const items: Item[] = [
    ...duJour.map((m) => ({ t: m.dateProgrammee!.getTime(), cle: m.id, m })),
    ...fs.map((x) => ({ t: x.debut.getTime(), cle: `${x.id}-${x.technicienId}`, f: x })),
  ].sort((a, b) => a.t - b.t);
  return (
    <section className="flex flex-col gap-2.5">
      <p className="text-sm text-ink-soft">
        {duJour.length} mission{duJour.length > 1 ? "s" : ""} · {enCours} en cours · {finies} terminée{finies > 1 ? "s" : ""} · {duJour.length - enCours - finies} à venir
        {fs.length ? ` · ${fs.length} en formation` : ""}
      </p>
      {items.length === 0 && <Card className="p-5 text-sm text-ink-soft">Aucune mission ce jour-là.</Card>}
      {items.map((it) => (
        <div key={it.cle} className="grid grid-cols-[52px_minmax(0,1fr)] sm:grid-cols-[70px_minmax(0,1fr)] gap-2.5 sm:gap-3.5 items-start">
          <span className={`font-display font-extrabold pt-3.5 text-sm sm:text-base ${it.m?.statut === "en_cours" ? "text-red" : "text-ink-soft"}`}>
            {heureProg(new Date(it.t))}
          </span>
          {it.m ? (
            <CarteMission m={it.m} maintenant={maintenant} techniciens={techniciens} retour={retour} />
          ) : (
            <div className={`rounded-2xl px-4 py-3.5 text-sm ${PUCE_FORMATION}`}>
              <Link href={`/responsable/habilitations/sessions/${it.f!.id}`} className="font-bold hover:underline">
                Formation « {it.f!.titre} »
              </Link>
              <span className="font-normal"> · {nomsTech.get(it.f!.technicienId) ?? "technicien"}</span>
              {it.f!.dureeHeures ? <span className="font-normal"> · {it.f!.dureeHeures} h</span> : null}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function VueMois({ jour, missions, formations, maintenant, auj, lien }: { jour: string; missions: MissionPlanning[]; formations: FormationPlanning[]; maintenant: number; auj: string; lien: Lien }) {
  const { debut, fin } = bornesVue("mois", jour);
  const n = Math.round((new Date(`${fin}T12:00:00Z`).getTime() - new Date(`${debut}T12:00:00Z`).getTime()) / 86400000) + 1;
  const js = jours(debut, n);
  const mois = jour.slice(0, 7);
  // Les missions en cours d'abord (visibles même si la case est pleine), puis par heure.
  const tri = [...missions].sort((a, b) => Number(b.statut === "en_cours") - Number(a.statut === "en_cours") || (a.dateProgrammee?.getTime() ?? 0) - (b.dateProgrammee?.getTime() ?? 0));
  const ms = parJour(tri, (m) => m.dateProgrammee);
  const fs = parJour(formations, (x) => x.debut);
  const resume = (j: string) => {
    const l = ms.get(j) ?? [];
    return {
      total: l.length,
      enCours: l.filter((m) => m.statut === "en_cours").length,
      attente: l.filter((m) => ["non_vue", "a_accepter", "non_envoyee", "refusee", "a_affecter"].includes(etatVisuel(m))).length,
      formations: (fs.get(j) ?? []).length,
    };
  };
  return (
    <>
      <section className="hidden sm:block bg-surface border border-line rounded-2xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-bg/60 text-xs font-bold text-ink-soft">
          {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
            <span key={d} className="px-2 py-2">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {js.map((j) => {
            const l = ms.get(j) ?? [];
            const f = fs.get(j) ?? [];
            const hors = j.slice(0, 7) !== mois;
            return (
              <div key={j} className={`min-h-[118px] border-b border-r border-line p-1.5 flex flex-col gap-1 min-w-0 ${hors ? "bg-bg/50 opacity-60" : ""} ${j === auj ? "bg-blue-pale/50" : ""}`}>
                <Link href={lien({ vue: "jour", d: j === auj ? null : j })} className={`text-xs font-bold self-start rounded-md px-1.5 py-0.5 hover:bg-blue-pale ${j === auj ? "bg-blue text-white hover:bg-blue" : "text-ink-soft"}`}>
                  {Number(j.slice(8))}
                </Link>
                {f.length > 0 && <span className={`text-[11px] rounded-lg px-[7px] py-[3px] truncate ${PUCE_FORMATION}`}>{f.length > 1 ? `${f.length} formations` : "Formation"}</span>}
                {l.slice(0, 3).map((m) => (
                  <PuceMission key={m.id} m={m} maintenant={maintenant} avecTechnicien />
                ))}
                {l.length > 3 && (
                  <Link href={lien({ vue: "jour", d: j })} className="text-[11px] font-bold text-blue px-1 hover:underline">
                    + {l.length - 3} autre{l.length - 3 > 1 ? "s" : ""}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <div className="sm:hidden flex flex-col bg-surface border border-line rounded-2xl overflow-hidden">
        {js
          .filter((j) => j.slice(0, 7) === mois)
          .map((j) => {
            const r = resume(j);
            if (!r.total && !r.formations && j !== auj) return null;
            return (
              <Link key={j} href={lien({ vue: "jour", d: j === auj ? null : j })} className={`flex items-center gap-3 px-4 py-3 border-b border-line last:border-0 ${j === auj ? "bg-blue-pale/50" : ""}`}>
                <span className="flex-1 text-sm font-semibold">{libelleJour(j, "titre")}</span>
                {r.enCours > 0 && <span className="text-[11px] font-extrabold text-white bg-red rounded-full px-2 py-0.5">● {r.enCours}</span>}
                {r.attente > 0 && <span className="text-[11px] font-bold text-red-ink border border-dashed border-red rounded-full px-2 py-0.5">{r.attente} à suivre</span>}
                {r.formations > 0 && <span className={`text-[11px] rounded-full px-2 py-0.5 ${PUCE_FORMATION}`}>🎓 {r.formations}</span>}
                <span className="text-sm font-bold text-navy w-6 text-right">{r.total}</span>
                <ChevronRight className="w-4 h-4 text-ink-soft" />
              </Link>
            );
          })}
      </div>
    </>
  );
}
