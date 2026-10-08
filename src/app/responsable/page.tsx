import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scoreIsoSaisies } from "@/db/schema";
import { CarteApplication } from "@/components/app-installable";
import { RafraichissementAuto } from "@/components/rafraichissement-auto";
import { Compteur, Legende, Section } from "@/components/kit-tableau";
import { ETATS } from "@/components/planning";
import { clePubliqueVapid } from "@/lib/push";
import { statsDemandes } from "@/lib/demandes";
import { statsSecurite } from "@/lib/signalements-stats";
import { passagesAVenirTableauDeBord } from "@/lib/garantie-passages";
import { calculerScoreGlobal, BLOCS_ISO } from "@/lib/score-iso";
import { chargerParc, estArret } from "@/lib/parc";
import { aujourdhui, chargerPlanning, duree, etatVisuel, heureProg, libelleJour, type MissionPlanning } from "@/lib/planning";
import { completude, echeances, equipe30, pannesSemaines, personneBloquee, plusAncienneDemande, remplissage } from "@/lib/tableau-de-bord";

// Phase 28 : tableau de bord de direction (maquette validée le 08/10/2026).
// Maintenant · Remplissage de la plateforme · Équipe · Parc · Qualité &
// échéances · Aujourd'hui. Pas de chiffre d'affaires (la facturation se fait
// ailleurs).

function instant() {
  return Date.now();
}

function moisDe(maintenant: number, decalage: number) {
  const d = new Date(maintenant);
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + decalage, 1));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function scoresIso(maintenant: number) {
  const [actuel, precedent] = [moisDe(maintenant, 0), moisDe(maintenant, -1)];
  const lire = async (mois: string) => {
    const rows = await db.select().from(scoreIsoSaisies).where(eq(scoreIsoSaisies.mois, mois));
    const v: Record<string, number> = {};
    for (const r of rows) v[r.bloc] = Number(r.valeur);
    return { score: calculerScoreGlobal(v), saisis: rows.length };
  };
  const [a, p] = await Promise.all([lire(actuel), lire(precedent)]);
  return { mois: actuel, ...a, precedent: p.saisis ? p.score : null, total: BLOCS_ISO.length };
}

const pluriel = (n: number, s: string, p = `${s}s`) => `${n} ${n > 1 ? p : s}`;
const minutes = (m: number | null) => (m === null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`);
const tonPct = (ok: number, total: number) => {
  const v = total ? ok / total : 1;
  return v >= 0.9 ? { barre: "bg-green", texte: "text-green-ink" } : v >= 0.6 ? { barre: "bg-orange", texte: "text-orange-ink" } : { barre: "bg-red", texte: "text-red-ink" };
};

export default async function TableauDeBord() {
  const maintenant = instant();
  const auj = aujourdhui(maintenant);
  const [planning, parc, demandes, ancienne, bloquee, saisies, fiches, equipe, semaines, ech, passages, securite, iso] = await Promise.all([
    chargerPlanning({ vue: "jour", jour: auj, maintenant }),
    chargerParc(),
    statsDemandes(),
    plusAncienneDemande(),
    personneBloquee(),
    remplissage(),
    completude(),
    equipe30(maintenant),
    pannesSemaines(),
    echeances(),
    passagesAVenirTableauDeBord(),
    statsSecurite(),
    scoresIso(maintenant),
  ]);

  // Maintenant
  const arret = parc.filter((l) => estArret(l.statut)).sort((a, b) => (a.statutDepuis?.getTime() ?? Infinity) - (b.statutDepuis?.getTime() ?? Infinity));
  const hs = arret.filter((l) => l.statut === "hors_service").length;
  const k = planning.compteurs;
  const p1 = planning.aTraiter.filter((l) => l.priorite === 1).length;
  const p2 = planning.aTraiter.filter((l) => l.priorite === 2).length;
  const motifs = (
    [
      [planning.aTraiter.filter((l) => l.action === "decider").length, "refus"],
      [planning.aTraiter.filter((l) => l.action === "relancer").length, "à relancer"],
      [planning.aTraiter.filter((l) => l.action === "affecter").length, "à affecter"],
      [planning.aTraiter.filter((l) => l.action === "replanifier").length, "en retard"],
    ] as [number, string][]
  )
    .filter(([n]) => n > 0)
    .map(([n, t]) => `${n} ${t}`)
    .join(" · ");
  const premierTerrain = planning.terrain[0];

  // Équipe
  const maxMissions = Math.max(1, ...equipe.map((t) => t.preventives + t.depannages));
  const moinsCharge = equipe.length > 1 ? [...equipe].sort((a, b) => a.aVenir - b.aVenir)[0] : null;

  // Parc
  const maxSemaine = Math.max(1, ...semaines.map((s) => Math.max(s.depannages, s.visites)));
  const totalDep = semaines.reduce((s, x) => s + x.depannages, 0);
  const totalVis = semaines.reduce((s, x) => s + x.visites, 0);
  const top = parc.filter((l) => l.pannes90 > 0).sort((a, b) => b.pannes90 - a.pannes90).slice(0, 5);
  const maxPannes = Math.max(1, ...top.map((l) => l.pannes90));

  // Échéances
  const passagesAPlanifier = passages.filter((p) => p.etat === "retard" || p.etat === "a_planifier").length;
  const tuiles: { titre: string; valeur: string; detail: string; href: string; ton: "rouge" | "orange" | "vert" | "neutre" }[] = [
    { titre: "Non-conformités ouvertes", valeur: String(ech.nc), detail: ech.ncRetard ? `${ech.ncRetard} dépasse${ech.ncRetard > 1 ? "nt" : ""} l'échéance` : "aucune en retard", href: "/responsable/non-conformites", ton: ech.ncRetard ? "rouge" : ech.nc ? "orange" : "vert" },
    { titre: "Habilitations à renouveler", valeur: String(ech.habilitations), detail: "dans moins de 60 jours", href: "/responsable/habilitations", ton: ech.habilitations ? "orange" : "vert" },
    { titre: "Contrats & garanties", valeur: String(ech.contrats + ech.garanties), detail: "se terminent dans moins de 60 jours", href: "/responsable/garanties", ton: ech.contrats + ech.garanties ? "orange" : "vert" },
    { titre: "Passages à planifier", valeur: String(passagesAPlanifier), detail: "garanties & contrats", href: "/responsable/garanties", ton: passagesAPlanifier ? "rouge" : "vert" },
    { titre: "Pièces manquantes", valeur: String(ech.pieces), detail: "missions en attente de pièce", href: "/responsable/interventions", ton: ech.pieces ? "orange" : "vert" },
    {
      titre: "Devis",
      valeur: String(ech.devis + ech.devisAFaire),
      detail: [ech.devisAFaire ? `${ech.devisAFaire} à préparer` : null, ech.devis ? `${ech.devis} sans réponse` : null].filter(Boolean).join(" · ") || "rien en attente",
      href: "/responsable/devis",
      ton: ech.devisAFaire ? "orange" : "neutre",
    },
    { titre: "Instruments à étalonner", valeur: String(ech.instruments), detail: ech.instrumentsRetard ? `${ech.instrumentsRetard} en retard` : ech.instruments ? "dans les 30 jours" : "tout est à jour", href: "/responsable/etalonnage", ton: ech.instrumentsRetard ? "rouge" : ech.instruments ? "orange" : "vert" },
    {
      titre: "Sécurité terrain",
      valeur: securite.joursSansAccident === null ? "—" : `${securite.joursSansAccident} j`,
      detail: `sans accident · ${pluriel(securite.nouveaux + securite.enCours, "signalement ouvert", "signalements ouverts")}`,
      href: "/responsable/signalements",
      ton: securite.nouveaux ? "rouge" : "vert",
    },
  ];
  const TON_TEXTE = { rouge: "text-red-ink", orange: "text-orange-ink", vert: "text-green-ink", neutre: "text-navy" };
  const pctIso = Math.max(0, Math.min(100, iso.score));
  const couleurIso = iso.score >= 80 ? "#27AE60" : iso.score >= 50 ? "#E67E22" : "#C0392B";

  const duJour = [...planning.periode].sort((a, b) => (a.dateProgrammee?.getTime() ?? 0) - (b.dateProgrammee?.getTime() ?? 0));
  const libMois = new Date(`${iso.mois}-15T12:00:00Z`).toLocaleDateString("fr-BE", { month: "long", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-6 max-w-[1240px]">
      <div className="lg:hidden">
        <CarteApplication cleVapid={clePubliqueVapid()} seulementSiAction compact />
      </div>

      {/* En-tête */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-extrabold text-[26px] sm:text-[28px] text-navy leading-tight">Tableau de bord</h1>
          <div className="text-sm text-ink-soft flex items-center gap-3 flex-wrap">
            <span>{libelleJour(auj, "titre")}</span>
            <RafraichissementAuto />
          </div>
        </div>
      </div>

      {/* Alerte bloquante */}
      {bloquee && (
        <Link href="/responsable/demandes" className="flex items-center gap-3.5 bg-red text-white rounded-[14px] px-4 sm:px-5 py-3.5 hover:opacity-95">
          <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse shrink-0" aria-hidden="true" />
          <span className="flex-1 text-[15px]">
            <strong>Personne bloquée</strong> · {bloquee.numero}
            {bloquee.client ? ` ${bloquee.client}` : ""} · signalée il y a {duree(bloquee.createdAt, maintenant)}
            {bloquee.technicien ? ` · ${bloquee.technicien} ${bloquee.surPlace ? "sur place" : "affecté"}` : " · aucun technicien affecté"}
          </span>
          <span className="hidden sm:inline font-bold text-[13px] border-[1.5px] border-white rounded-[10px] px-3 py-1.5">Suivre</span>
        </Link>
      )}

      {/* 1. Maintenant */}
      <section aria-labelledby="t-maintenant" className="flex flex-col gap-2.5">
        <h2 id="t-maintenant" className="font-display font-extrabold text-[13px] tracking-[0.08em] uppercase text-ink-soft">Maintenant</h2>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3">
          <Compteur
            titre="Appareils à l'arrêt"
            valeur={arret.length}
            sous={arret.length ? `${hs} hors service · ${arret.length - hs} en panne${arret[0]?.statutDepuis ? ` · le plus long : ${arret[0].numero} · ${duree(arret[0].statutDepuis, maintenant)}` : ""}` : "tout le parc fonctionne"}
            ton={arret.length ? "rouge-plein" : "vert"}
            href="/responsable/appareils?f=arret"
          />
          <Compteur
            titre="Sur le terrain"
            point
            valeur={k.enCours}
            sous={premierTerrain ? `${premierTerrain.technicien} · ${premierTerrain.numero} · ${duree(premierTerrain.dateDebut, maintenant)}` : "personne sur place"}
            ton={k.enCours ? "rouge" : "neutre"}
            href="/responsable/interventions?f=encours"
          />
          <Compteur
            titre="Missions à traiter"
            valeur={planning.aTraiter.length}
            sous={planning.aTraiter.length ? [p1 ? `${p1} critique${p1 > 1 ? "s" : ""}` : null, p2 ? `${p2} urgente${p2 > 1 ? "s" : ""}` : null, motifs].filter(Boolean).join(" · ") : "tout est affecté et accepté"}
            ton={p1 ? "rouge" : planning.aTraiter.length ? "orange" : "vert"}
            href="/responsable/interventions#a-traiter"
          />
          <Compteur
            titre="Demandes clients"
            valeur={demandes.nouvelles}
            sous={demandes.nouvelles ? `à prendre en charge${ancienne ? ` · plus ancienne : il y a ${duree(ancienne, maintenant)}` : ""}${demandes.enRetard ? ` · ${demandes.enRetard} délai dépassé` : ""}` : `${demandes.ouvertes} en cours de traitement`}
            ton={demandes.enRetard ? "rouge" : demandes.nouvelles ? "orange" : "neutre"}
            href="/responsable/demandes"
          />
        </div>
      </section>

      {/* 2. Remplissage */}
      <section aria-labelledby="t-remplissage" className="flex flex-col gap-2.5">
        <div className="flex justify-between items-baseline gap-3 flex-wrap">
          <h2 id="t-remplissage" className="font-display font-extrabold text-[13px] tracking-[0.08em] uppercase text-ink-soft">Remplissage de la plateforme · {libMois}</h2>
          <span className="text-xs text-ink-soft">total enregistré · ajoutés ce mois-ci · barres = 6 derniers mois</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          {saisies.map((s) => {
            const max = Math.max(1, ...s.mois);
            return (
              <Link key={s.cle} href={s.href} className="bg-surface border border-line rounded-2xl px-3.5 sm:px-4 py-3.5 flex flex-col gap-2 hover:shadow-md transition-shadow min-w-0">
                <span className="text-[13px] font-semibold">{s.titre}</span>
                <div className="flex items-end justify-between gap-2.5">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-display font-extrabold text-[26px] sm:text-[30px] leading-none text-navy">{s.total}</span>
                    <span className={`text-xs font-bold ${s.ceMois ? "text-green-ink" : "text-ink-soft"}`}>{s.ceMois ? `+${s.ceMois} ce mois-ci` : "aucun ce mois-ci"}</span>
                  </div>
                  <div className="hidden sm:flex gap-[3px] items-end h-9" aria-label={`Ajouts des 6 derniers mois : ${s.mois.join(", ")}`} role="img">
                    {s.mois.map((v, i) => (
                      <span key={i} className={`w-2 rounded-sm ${i === 5 && v ? "bg-blue" : "bg-[#B9D3EE]"}`} style={{ height: `${Math.max(6, (v / max) * 100)}%` }} />
                    ))}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        <Section titre="Fiches complètes" droite={<span className="text-xs text-ink-soft">ce qu&apos;il reste à remplir — cliquez pour voir la liste</span>}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-7 gap-y-3.5 px-4 sm:px-5 py-4">
            {fiches.map((c) => {
              const t = tonPct(c.ok, c.total);
              const pct = c.total ? Math.round((c.ok / c.total) * 100) : 100;
              return (
                <Link key={c.titre} href={c.href} className="flex flex-col gap-1.5 group">
                  <span className="flex justify-between gap-2 text-[13px]">
                    <span className="group-hover:text-blue">{c.titre}</span>
                    <strong className={`${t.texte} whitespace-nowrap`}>
                      {pct} %<span className="font-normal text-ink-soft"> · {c.ok}/{c.total}</span>
                    </strong>
                  </span>
                  <span className="block h-2.5 rounded-full bg-[#EDF1F5] overflow-hidden">
                    <span className={`block h-full rounded-full ${t.barre}`} style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-xs text-ink-soft">{c.detail}</span>
                </Link>
              );
            })}
          </div>
        </Section>
      </section>

      {/* 3. Équipe */}
      <section aria-labelledby="t-equipe" className="flex flex-col gap-2.5">
        <div className="flex justify-between items-baseline gap-3 flex-wrap">
          <h2 id="t-equipe" className="font-display font-extrabold text-[13px] tracking-[0.08em] uppercase text-ink-soft">Équipe · 30 derniers jours</h2>
          <Link href="/responsable/techniciens" className="text-[13px] font-bold">
            Équipe technique →
          </Link>
        </div>
        <div className="bg-surface border border-line rounded-2xl overflow-hidden">
          {/* Ordinateur : tableau */}
          <div className="hidden md:block overflow-x-auto">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[170px_minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] gap-3.5 px-5 py-3 border-b border-line text-xs font-bold text-ink-soft bg-bg/60">
                <span>Technicien</span>
                <span>Missions réalisées</span>
                <span>Temps moyen sur place</span>
                <span>Délai d&apos;acceptation</span>
                <span>Refus</span>
                <span>À venir (7 j)</span>
              </div>
              {equipe.map((t) => {
                const total = t.preventives + t.depannages;
                return (
                  <div key={t.id} className="grid grid-cols-[170px_minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] gap-3.5 px-5 py-3 border-b border-line items-center text-[13px]">
                    <Link href={`/responsable/techniciens/${t.id}`} className="flex items-center gap-2.5 min-w-0 hover:text-blue">
                      <Initiales nom={t.nom} />
                      <strong className="truncate">{t.nom}</strong>
                    </Link>
                    <span className="flex items-center gap-2.5" title={`${t.preventives} préventif(s) · ${t.depannages} dépannage(s)`}>
                      <span className="flex-1 flex h-3.5 rounded-full overflow-hidden bg-[#EDF1F5]">
                        <span className="bg-blue" style={{ width: `${(t.preventives / maxMissions) * 100}%` }} />
                        <span className="bg-red" style={{ width: `${(t.depannages / maxMissions) * 100}%` }} />
                      </span>
                      <strong className="w-6 text-right">{total}</strong>
                    </span>
                    <span className={t.tempsMoyenMin !== null && t.tempsMoyenMin <= 60 ? "font-bold text-green-ink" : t.tempsMoyenMin !== null && t.tempsMoyenMin > 100 ? "font-bold text-orange-ink" : ""}>{minutes(t.tempsMoyenMin)}</span>
                    <span className={t.acceptationMin !== null && t.acceptationMin <= 15 ? "font-bold text-green-ink" : t.acceptationMin !== null && t.acceptationMin > 30 ? "font-bold text-red-ink" : ""}>{minutes(t.acceptationMin)}</span>
                    <span className={t.refus ? "font-bold text-red-ink" : "text-ink-soft"}>{t.refus}</span>
                    <span className="flex items-center gap-2">
                      <strong>{t.aVenir}</strong>
                      <Charge n={t.aVenir} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Téléphone : liste */}
          <div className="md:hidden">
            {equipe.map((t) => (
              <Link key={t.id} href={`/responsable/techniciens/${t.id}`} className="flex items-center gap-2.5 px-3.5 py-3 border-b border-line">
                <Initiales nom={t.nom} />
                <span className="flex-1 min-w-0 text-[13px]">
                  <strong>{t.nom}</strong> · {pluriel(t.preventives + t.depannages, "mission")}
                  <span className="block text-[11px] text-ink-soft">
                    {minutes(t.tempsMoyenMin)} sur place · accepte en {minutes(t.acceptationMin)}
                    {t.refus ? ` · ${pluriel(t.refus, "refus", "refus")}` : ""}
                  </span>
                </span>
                <Charge n={t.aVenir} />
              </Link>
            ))}
          </div>
          {equipe.length === 0 && <p className="px-5 py-4 text-sm text-ink-soft">Aucun technicien actif.</p>}
          <div className="flex gap-x-4 gap-y-1.5 flex-wrap items-center px-4 sm:px-5 py-3 text-xs text-ink-soft">
            <span className="hidden md:inline-flex">
              <Legende items={[{ classe: "bg-blue", texte: "Préventif / systématique" }, { classe: "bg-red", texte: "Dépannage" }]} />
            </span>
            <span className="flex-1" />
            {moinsCharge && (
              <span className="font-semibold text-ink">
                Répartition : {moinsCharge.nom} a le moins de missions à venir ({moinsCharge.aVenir}) — à proposer en premier.
              </span>
            )}
          </div>
        </div>
      </section>

      {/* 4. Parc */}
      <section aria-labelledby="t-parc" className="flex flex-col gap-2.5">
        <h2 id="t-parc" className="font-display font-extrabold text-[13px] tracking-[0.08em] uppercase text-ink-soft">Parc</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-surface border border-line rounded-2xl p-4 sm:p-5 flex flex-col gap-3.5">
            <div className="flex justify-between items-baseline gap-2 flex-wrap">
              <h3 className="font-display font-extrabold text-base text-navy">Pannes et visites — 12 semaines</h3>
              <Legende items={[{ classe: "bg-red", texte: "Dépannages" }, { classe: "bg-[#7FB0D6]", texte: "Visites réalisées" }]} />
            </div>
            <div className="grid grid-cols-12 gap-1.5 sm:gap-2 items-end h-[150px] border-b border-line" role="img" aria-label={`${totalDep} dépannages et ${totalVis} visites sur 12 semaines`}>
              {semaines.map((s) => (
                <div key={s.label} className="flex gap-0.5 items-end h-full" title={`Semaine ${s.label.slice(1)} (du ${s.debut}) : ${s.depannages} dépannage(s), ${s.visites} visite(s)`}>
                  <span className="flex-1 rounded-t-[3px] bg-red" style={{ height: `${(s.depannages / maxSemaine) * 100}%` }} />
                  <span className="flex-1 rounded-t-[3px] bg-[#7FB0D6]" style={{ height: `${(s.visites / maxSemaine) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-12 gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] text-ink-soft text-center">
              {semaines.map((s) => (
                <span key={s.label}>{s.label}</span>
              ))}
            </div>
            <p className="text-[13px]">
              <strong>{pluriel(totalDep, "dépannage")}</strong> et{" "}
              <strong>
                {pluriel(totalVis, "visite")} réalisée{totalVis > 1 ? "s" : ""}
              </strong>{" "}
              sur 12 semaines.
            </p>
          </div>

          <div className="bg-surface border border-line rounded-2xl p-4 sm:p-5 flex flex-col gap-3">
            <h3 className="font-display font-extrabold text-base text-navy">Appareils les plus en panne — 90 jours</h3>
            {top.length === 0 && <p className="text-sm text-green-ink font-semibold">Aucune panne sur 90 jours ✓</p>}
            {top.map((a) => (
              <Link key={a.id} href={`/responsable/appareils/${a.id}`} className="grid grid-cols-[120px_minmax(0,1fr)_72px] sm:grid-cols-[150px_minmax(0,1fr)_76px] gap-3 items-center hover:bg-bg/60 rounded-lg">
                <span className="text-[13px] min-w-0">
                  <strong className="text-navy">{a.numero}</strong>
                  <span className="block text-[11px] text-ink-soft truncate">{a.client ?? "Sans client"}</span>
                </span>
                <span className="h-3 rounded-full bg-[#EDF1F5] overflow-hidden">
                  <span className={`block h-full rounded-full ${a.pannes90 >= 3 ? "bg-red" : "bg-[#7FB0D6]"}`} style={{ width: `${(a.pannes90 / maxPannes) * 100}%` }} />
                </span>
                <span className="text-[13px] font-bold text-right">{pluriel(a.pannes90, "panne")}</span>
              </Link>
            ))}
            <p className="text-xs text-ink-soft border-t border-line pt-2.5 mt-auto">Rouge = 3 pannes ou plus (panne répétée) — à envisager : devis de modernisation.</p>
          </div>
        </div>
      </section>

      {/* 5. Qualité & échéances */}
      <section aria-labelledby="t-qualite" className="flex flex-col gap-2.5">
        <h2 id="t-qualite" className="font-display font-extrabold text-[13px] tracking-[0.08em] uppercase text-ink-soft">Qualité ISO 9001 &amp; échéances</h2>
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-3">
          <Link href="/responsable/score-iso" className="bg-surface border border-line rounded-2xl p-4 sm:p-5 flex gap-4 items-center hover:shadow-md transition-shadow">
            <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`Score ISO ${iso.score} %`} className="shrink-0">
              <circle cx="48" cy="48" r="40" fill="none" stroke="#EDF1F5" strokeWidth="10" />
              {pctIso > 0 && <circle cx="48" cy="48" r="40" fill="none" stroke={couleurIso} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(pctIso / 100) * 251.3} 251.3`} transform="rotate(-90 48 48)" />}
              <text x="48" y="54" textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight="800" fontSize="22" fill="#003366">
                {iso.score}%
              </text>
            </svg>
            <span className="flex flex-col gap-1">
              <strong className="font-display text-base text-navy">Score ISO 9001</strong>
              <span className="text-xs text-ink-soft">
                {libMois} · {iso.saisis}/{iso.total} blocs saisis
              </span>
              {iso.precedent !== null && (
                <span className={`text-xs font-bold ${iso.score >= iso.precedent ? "text-green-ink" : "text-red-ink"}`}>
                  {iso.score >= iso.precedent ? "▲ +" : "▼ "}
                  {iso.score - iso.precedent} pts vs le mois précédent
                </span>
              )}
              {iso.saisis < iso.total && <span className="text-xs font-bold text-orange-ink">Saisie du mois à compléter</span>}
            </span>
          </Link>
          <div className="bg-surface border border-line rounded-2xl overflow-hidden grid grid-cols-2 md:grid-cols-4">
            {tuiles.map((t) => (
              <Link key={t.titre} href={t.href} className="px-3.5 sm:px-4 py-3.5 border-r border-b border-line flex flex-col gap-0.5 hover:bg-bg/60 min-w-0">
                <span className="text-xs text-ink-soft">{t.titre}</span>
                <span className={`font-display font-extrabold text-[22px] ${TON_TEXTE[t.ton]}`}>{t.valeur}</span>
                <span className="text-xs text-ink-soft">{t.detail}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Aujourd'hui */}
      <Section
        titre={`Aujourd'hui · ${pluriel(duJour.length, "mission")}`}
        droite={
          <Link href="/responsable/interventions?vue=jour" className="text-[13px] font-bold">
            Ouvrir le planning →
          </Link>
        }
      >
        {duJour.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-soft">Aucune mission prévue aujourd&apos;hui.</p>
        ) : (
          <div className="flex gap-2 px-4 sm:px-5 py-3.5 overflow-x-auto">
            {duJour.map((m) => (
              <PuceJour key={m.id} m={m} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Initiales({ nom }: { nom: string }) {
  const ini = nom
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return <span className="w-[34px] h-[34px] shrink-0 rounded-full bg-navy text-white font-display font-extrabold text-xs flex items-center justify-center">{ini}</span>;
}

function Charge({ n }: { n: number }) {
  const [texte, classe] = n >= 8 ? ["chargé", "bg-red-fill text-red-ink"] : n <= 3 ? ["disponible", "bg-green-fill text-green-ink"] : ["normal", "bg-[#EDF1F5] text-ink-soft"];
  return <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap ${classe}`}>{texte}</span>;
}

function PuceJour({ m }: { m: MissionPlanning }) {
  const e = etatVisuel(m);
  return (
    <Link href={`/responsable/missions/${m.id}`} className={`shrink-0 text-xs leading-snug rounded-[10px] px-2.5 py-2 hover:shadow-sm ${ETATS[e].puce}`}>
      <span className="block">
        {e === "en_cours" ? "● " : e === "terminee" || e === "validee" ? "✓ " : ""}
        {heureProg(m.dateProgrammee)} {m.numero}
      </span>
      <span className="block font-normal">
        {m.technicien ?? "sans technicien"} · {e === "en_cours" ? "sur place" : ETATS[e].label.toLowerCase()}
      </span>
    </Link>
  );
}
