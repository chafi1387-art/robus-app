import Link from "next/link";
import { Download, Plus, Search } from "lucide-react";
import { Card, Btn, Field, inputClass } from "@/components/ui";
import { RafraichissementAuto } from "@/components/rafraichissement-auto";
import { Compteur, type TonCompteur } from "@/components/kit-tableau";
import { ArretDepuis, BadgePriorite, CarteAppareil, LignePriorite, PastilleEtat } from "@/components/parc";
import { chargerParc, estArret, indicateursParc, jourCourt, type LigneParc } from "@/lib/parc";
import { createAppareil } from "../actions";

// Phase 26 : le parc d'appareils en tableau de bord (maquette validée le 08/10/2026).

const FILTRES: Record<string, { label: string; test: (l: LigneParc, maintenant: number) => boolean }> = {
  arret: { label: "Hors service / panne", test: (l) => estArret(l.statut) },
  surveillance: { label: "Surveillance", test: (l) => l.statut === "sous_surveillance" },
  encours: { label: "Mission en cours", test: (l) => l.missions.some((m) => m.statut === "en_cours") },
  affecter: { label: "À affecter", test: (l) => l.missions.some((m) => !m.technicienId) },
  visites: { label: "Visite ≤ 7 j", test: (l, n) => !!l.prochaineVisite && l.prochaineVisite.getTime() <= n + 7 * 86400000 },
  priorites: { label: "À traiter", test: (l) => l.priorite <= 3 },
  sanscontrat: { label: "Sans contrat", test: (l, n) => !l.couvertureFin || l.couvertureFin.getTime() < n },
  service: { label: "En service", test: (l) => l.statut === "en_service" },
};

function normaliser(t: string) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function instant() {
  return Date.now();
}

export default async function AppareilsPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; vue?: string; nouveau?: string }> }) {
  const sp = await searchParams;
  const parc = await chargerParc();
  const k = indicateursParc(parc);
  const maintenant = instant();
  const filtre = sp.f && FILTRES[sp.f] ? sp.f : null;
  const q = (sp.q ?? "").trim();
  const vue = sp.vue === "tableau" ? "tableau" : "cartes";
  const recherche = q ? normaliser(q) : "";
  const liste = parc.filter(
    (l) =>
      (!filtre || FILTRES[filtre].test(l, maintenant)) &&
      (!recherche || normaliser([l.numero, l.client, l.adresse, l.marque, l.modele].filter(Boolean).join(" ")).includes(recherche))
  );
  const priorites = parc.filter((l) => l.priorite <= 3);
  const lien = (p: Record<string, string | null>) => {
    const u = new URLSearchParams();
    const v = { f: filtre, q: q || null, vue: vue === "tableau" ? "tableau" : null, ...p };
    for (const [c, x] of Object.entries(v)) if (x) u.set(c, x);
    const s = u.toString();
    return `/responsable/appareils${s ? `?${s}` : ""}`;
  };
  const pct = (n: number) => (k.total ? Math.round((n / k.total) * 100) : 0);
  const arretTotal = k.horsService + k.enPanne;

  // Phase 27 : compteurs du kit commun (même rendu que le Planning).
  const compteurs: { cle: string; titre: string; valeur: number; sous: string; ton: TonCompteur }[] = [
    { cle: "arret", titre: "Hors service / en panne", valeur: arretTotal, sous: `${k.horsService} hors service · ${k.enPanne} en panne`, ton: arretTotal ? "rouge-plein" : "vert" },
    { cle: "surveillance", titre: "Sous surveillance", valeur: k.surveillance, sous: k.repetees ? `dont ${k.repetees} pannes répétées` : "à suivre", ton: "orange" },
    { cle: "encours", titre: "Missions en cours", valeur: k.missionsEnCours, sous: k.techniciensSurPlace ? `${k.techniciensSurPlace} technicien(s) sur place` : "personne sur place", ton: "bleu" },
    { cle: "affecter", titre: "Missions à affecter", valeur: k.aAffecter, sous: "sans technicien", ton: k.aAffecter ? "orange" : "neutre" },
    { cle: "visites", titre: "Visites ≤ 7 jours", valeur: k.visites7, sous: "préventives & passages", ton: "neutre" },
    { cle: "service", titre: "En service", valeur: k.enService, sous: `${pct(k.enService)} % du parc`, ton: "vert" },
  ];

  return (
    <div className="flex flex-col gap-5 max-w-[1240px]">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-extrabold text-[28px] text-navy leading-tight">Parc d&apos;appareils</h1>
          <div className="text-sm text-ink-soft flex items-center gap-3 flex-wrap">
            <span>
              {k.total} ascenseur{k.total > 1 ? "s" : ""} suivi{k.total > 1 ? "s" : ""}
            </span>
            <RafraichissementAuto />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <form action="/responsable/appareils" className="flex items-center gap-2 bg-surface border border-line rounded-[10px] px-3 h-[42px] w-full sm:w-[300px]">
            {filtre && <input type="hidden" name="f" value={filtre} />}
            {vue === "tableau" && <input type="hidden" name="vue" value="tableau" />}
            <Search className="w-4 h-4 text-ink-soft shrink-0" />
            <input name="q" defaultValue={q} placeholder="N°, client, adresse, marque…" aria-label="Rechercher un appareil" className="flex-1 min-w-0 bg-transparent outline-none text-sm" />
          </form>
          <Link href={lien({ nouveau: "1" }) + "#nouvel-appareil"} className="inline-flex items-center gap-1.5 h-[42px] px-4 rounded-[10px] bg-blue text-white font-display font-bold text-sm hover:bg-blue-light">
            <Plus className="w-4 h-4" /> Nouvel appareil
          </Link>
          <Link href="/api/export/appareils" className="inline-flex items-center gap-1.5 h-[42px] px-3 rounded-[10px] border border-line bg-surface text-sm font-semibold hover:bg-blue-pale" title="Exporter en CSV">
            <Download className="w-4 h-4" /> <span className="hidden sm:inline">CSV</span>
          </Link>
        </div>
      </div>

      {/* Compteurs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {compteurs.map((c) => (
          <Compteur key={c.cle} titre={c.titre} valeur={c.valeur} sous={c.sous} ton={c.ton} href={lien({ f: filtre === c.cle ? null : c.cle })} actif={filtre === c.cle} />
        ))}
      </div>

      {/* Barre d'état du parc */}
      {k.total > 0 && (
        <Card className="px-5 py-4 flex flex-col gap-2.5">
          <div className="flex justify-between text-[13px] text-ink-soft">
            <span className="font-bold text-ink">État du parc</span>
            <span>{k.total} appareils</span>
          </div>
          <div
            className="flex h-3.5 rounded-full overflow-hidden gap-0.5"
            role="img"
            aria-label={`${k.horsService} hors service, ${k.enPanne} en panne, ${k.surveillance + k.enTravaux} à surveiller, ${k.enService} en service`}
          >
            {k.horsService > 0 && <span style={{ flex: k.horsService }} className="bg-[#7B1F17]" />}
            {k.enPanne > 0 && <span style={{ flex: k.enPanne }} className="bg-red" />}
            {k.surveillance + k.enTravaux > 0 && <span style={{ flex: k.surveillance + k.enTravaux }} className="bg-orange" />}
            {k.installation > 0 && <span style={{ flex: k.installation }} className="bg-blue-accent" />}
            {k.enService > 0 && <span style={{ flex: k.enService }} className="bg-green" />}
          </div>
          <div className="flex gap-x-5 gap-y-1 flex-wrap text-xs text-ink-soft">
            <Legende couleur="bg-[#7B1F17]" texte={`Hors service ${k.horsService}`} />
            <Legende couleur="bg-red" texte={`En panne ${k.enPanne}`} />
            <Legende couleur="bg-orange" texte={`Surveillance / travaux ${k.surveillance + k.enTravaux}`} />
            {k.installation > 0 && <Legende couleur="bg-blue-accent" texte={`Installation ${k.installation}`} />}
            <Legende couleur="bg-green" texte={`En service ${k.enService}`} />
          </div>
        </Card>
      )}

      {/* À traiter en priorité */}
      {!filtre && !q && (
        <section className="bg-surface border border-line rounded-2xl overflow-hidden" id="priorites">
          <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4 border-b border-line">
            <h2 className="font-display font-extrabold text-[17px] text-navy">À traiter en priorité</h2>
            <div className="flex gap-1.5 flex-wrap">
              <BadgePriorite p={1} compte={k.p1} />
              <BadgePriorite p={2} compte={k.p2} />
              <BadgePriorite p={3} compte={k.p3} />
            </div>
          </div>
          {priorites.length === 0 ? (
            <p className="px-5 py-6 text-sm text-green-ink font-semibold">✓ Rien d&apos;urgent : tous les appareils sont en service, sans mission en retard.</p>
          ) : (
            <>
              {priorites.slice(0, 8).map((l) => (
                <LignePriorite key={l.id} l={l} />
              ))}
              {priorites.length > 8 && (
                <div className="px-5 py-3 text-[13px] text-ink-soft flex justify-between gap-2 flex-wrap">
                  <span>+ {priorites.length - 8} autre(s) appareil(s) à traiter</span>
                  <Link href={lien({ f: "priorites" })} className="font-bold text-blue">
                    Voir tout
                  </Link>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Tous les appareils */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-display font-extrabold text-[17px] text-navy">
            {filtre ? FILTRES[filtre].label : "Tous les appareils"}
            {q ? ` — « ${q} »` : ""} <span className="text-ink-soft font-semibold text-sm">({liste.length})</span>
          </h2>
          <div className="flex gap-1.5 flex-wrap items-center">
            <Link href={lien({ f: null })} className={`h-[34px] px-3 rounded-full text-[13px] font-semibold flex items-center ${!filtre ? "bg-navy text-white" : "bg-surface border border-line"}`}>
              Tous {k.total}
            </Link>
            {(["arret", "surveillance", "encours", "sanscontrat"] as const).map((f) => (
              <Link
                key={f}
                href={lien({ f: filtre === f ? null : f })}
                className={`h-[34px] px-3 rounded-full text-[13px] font-semibold flex items-center ${filtre === f ? "bg-navy text-white" : "bg-surface border border-line"} ${
                  filtre !== f && f === "arret" ? "text-red-ink" : filtre !== f && f === "surveillance" ? "text-orange-ink" : filtre !== f && f === "encours" ? "text-blue" : ""
                }`}
              >
                {FILTRES[f].label} {parc.filter((l) => FILTRES[f].test(l, maintenant)).length}
              </Link>
            ))}
            <span className="w-px h-6 bg-line mx-1" aria-hidden="true" />
            <Link href={lien({ vue: null })} aria-pressed={vue === "cartes"} className={`h-[34px] px-3 rounded-lg text-[13px] font-semibold flex items-center ${vue === "cartes" ? "bg-blue-pale text-blue" : "text-ink-soft"}`}>
              Cartes
            </Link>
            <Link href={lien({ vue: "tableau" })} aria-pressed={vue === "tableau"} className={`h-[34px] px-3 rounded-lg text-[13px] font-semibold flex items-center ${vue === "tableau" ? "bg-blue-pale text-blue" : "text-ink-soft"}`}>
              Tableau
            </Link>
          </div>
        </div>

        {liste.length === 0 ? (
          <Card className="p-6 text-sm text-ink-soft">Aucun appareil {filtre || q ? "pour ce filtre" : "pour l'instant"}.</Card>
        ) : vue === "cartes" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {liste.map((l) => (
              <CarteAppareil key={l.id} l={l} />
            ))}
          </div>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="px-4 py-3">Priorité</th>
                  <th className="px-3 py-3">Appareil</th>
                  <th className="px-3 py-3">Client</th>
                  <th className="px-3 py-3">État</th>
                  <th className="px-3 py-3">Situation</th>
                  <th className="px-3 py-3 text-right">Pannes 90 j</th>
                  <th className="px-3 py-3">Prochaine visite</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((l) => (
                  <tr key={l.id} className="border-b border-line last:border-0 align-top hover:bg-bg/60">
                    <td className="px-4 py-3">
                      <BadgePriorite p={l.priorite} />
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/responsable/appareils/${l.id}`} className="font-display font-extrabold text-navy hover:underline">
                        {l.numero}
                      </Link>
                      <div className="text-xs text-ink-soft">{[l.marque, l.modele].filter(Boolean).join(" ") || "—"}</div>
                    </td>
                    <td className="px-3 py-3">{l.client ?? "—"}</td>
                    <td className="px-3 py-3">
                      <PastilleEtat statut={l.statut} />
                      <div className="mt-1">
                        <ArretDepuis statut={l.statut} depuis={l.statutDepuis} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[13px]">
                      {l.raison || <span className="text-ink-soft">RAS</span>}
                      {l.detail && <div className="text-xs text-ink-soft">{l.detail}</div>}
                    </td>
                    <td className={`px-3 py-3 text-right font-semibold tabular-nums ${l.pannes90 >= 3 ? "text-red-ink" : ""}`}>{l.pannes90}</td>
                    <td className="px-3 py-3">{l.prochaineVisite ? jourCourt(l.prochaineVisite) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <p className="text-xs text-ink-soft">Tri : priorité, puis l&apos;arrêt le plus long en premier, puis le numéro.</p>
      </section>

      {/* Nouvel appareil */}
      <details id="nouvel-appareil" open={sp.nouveau === "1" || undefined} className="bg-surface border border-line rounded-2xl scroll-mt-24">
        <summary className="px-5 py-4 cursor-pointer select-none font-display font-bold text-[15px] text-navy flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nouvel appareil
        </summary>
        <div className="px-5 pb-5">
          <p className="text-xs text-ink-soft mb-3">L&apos;appareil se crée avec ses caractéristiques techniques, puis se rattache à un client via un projet.</p>
          <form action={createAppareil} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="N° unique interne Robus">
              <input name="numeroInterne" required className={inputClass} placeholder="A-1042" />
            </Field>
            <Field label="Marque">
              <input name="marque" className={inputClass} placeholder="OTIS, Schindler, Kone..." />
            </Field>
            <Field label="Modèle">
              <input name="modele" className={inputClass} />
            </Field>
            <Field label="N° de série constructeur">
              <input name="numeroSerie" className={inputClass} />
            </Field>
            <Field label="Type d'appareil">
              <input name="typeAppareil" className={inputClass} placeholder="Traction, hydraulique..." />
            </Field>
            <Field label="Charge (kg)">
              <input name="charge" type="number" step="0.01" className={inputClass} />
            </Field>
            <Field label="Vitesse (m/s)">
              <input name="vitesse" type="number" step="0.01" className={inputClass} />
            </Field>
            <Field label="Niveaux">
              <input name="niveaux" type="number" className={inputClass} />
            </Field>
            <Field label="Année d'installation">
              <input name="anneeInstallation" type="number" className={inputClass} />
            </Field>
            <Field label="Type de portes">
              <input name="typePortes" className={inputClass} placeholder="Automatiques, manuelles..." />
            </Field>
            <Field label="État">
              <select name="statut" className={inputClass} defaultValue="en_service">
                <option value="en_service">En service</option>
                <option value="sous_surveillance">Sous surveillance</option>
                <option value="en_panne">En panne</option>
                <option value="hors_service">Hors service</option>
                <option value="en_travaux">En travaux</option>
                <option value="installation">Installation (projet sur plan)</option>
              </select>
            </Field>
            <div className="flex items-end">
              <Btn enCours="Création…">Créer l&apos;appareil</Btn>
            </div>
          </form>
        </div>
      </details>
    </div>
  );
}

function Legende({ couleur, texte }: { couleur: string; texte: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-[3px] ${couleur}`} />
      {texte}
    </span>
  );
}
