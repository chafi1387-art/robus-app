import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { CalendarClock, FileText, History, KeyRound, Package, Plus, QrCode, ShieldCheck, TriangleAlert } from "lucide-react";
import { FrisePassages } from "@/components/frise-passages";
import { passagesDAppareils } from "@/lib/garantie-passages";
import { contratsDeLAppareil, ETAT_CONTRAT, etatContrat } from "@/lib/contrats";
import { ajouterDocumentClient, archiverDocumentClient } from "../../observateurs/actions";
import { TYPES_DOCUMENT_CLIENT } from "@/lib/documents-client";
import {
  appareils,
  clients,
  devis,
  documentsClient,
  documentsClientConsultations,
  documentsFormations,
  interventions,
  missionChecklists,
  missionChecklistTaches,
  mouvementsStock,
  observateurAppareils,
  observateurs,
  pieces,
  projetAppareils,
  projets,
  rapports,
  sites,
  users,
} from "@/db/schema";
import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { FileField } from "@/components/file-field";
import { db } from "@/db";
import { createIntervention, getTechniciens, updateAppareil, uploadAppareilPhoto, changerEtatAppareilBureau } from "../../actions";
import { getProjetsPourAppareil } from "../../projets/actions";
import { formatDate } from "@/lib/format";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { RafraichissementAuto } from "@/components/rafraichissement-auto";
import { ArretDepuis, BadgePriorite, PastilleEtat } from "@/components/parc";
import { EtapesMission, GraphiqueMois, LigneHistorique } from "@/components/fiche-appareil-blocs";
import { ImageMini } from "@/components/image-mini";
import { chargerParc, duree, dureeMs, estArret, heure, jourCourt, statistiquesAppareil } from "@/lib/parc";
import { STATUTS_DEVIS } from "@/lib/devis";

// Phase 26 : fiche appareil = tableau de bord (maquette validée le 08/10/2026).
// Onglets : Tableau de bord · Contrats & passages · Documents · Nouvelle mission · Modifier.

const CATEGORIE_DOC_LABEL: Record<string, string> = {
  securite: "Sécurité",
  installation: "Installation",
  maintenance: "Maintenance",
  depannage: "Dépannage",
  marques: "Marques",
  procedures_robus: "Procédures Robus",
  videos: "Vidéos",
  fournisseur_iso: "Fournisseur / ISO 9001",
  formation: "Formations internes",
};

const STATUTS = ["en_service", "sous_surveillance", "en_panne", "hors_service", "en_travaux", "installation"] as const;
const STATUT_LABEL: Record<(typeof STATUTS)[number], string> = {
  en_service: "En service",
  sous_surveillance: "Sous surveillance",
  en_panne: "En panne",
  hors_service: "Hors service",
  en_travaux: "En travaux",
  installation: "Installation (projet sur plan)",
};
const BANDEAU: Record<string, string> = {
  hors_service: "bg-[#7B1F17] text-white",
  en_panne: "bg-red text-white",
  sous_surveillance: "bg-orange text-white",
  en_travaux: "bg-orange text-white",
  installation: "bg-blue text-white",
  en_service: "bg-green text-white",
};
const ONGLETS = [
  ["tableau", "Tableau de bord"],
  ["contrats", "Contrats & passages"],
  ["documents", "Documents"],
  ["mission", "Nouvelle mission"],
  ["modifier", "Modifier la fiche"],
] as const;

function ilYA12Mois() {
  return new Date(Date.now() - 365 * 86400000);
}

export default async function AppareilDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tab = ONGLETS.some(([k]) => k === sp.tab) ? (sp.tab as (typeof ONGLETS)[number][0]) : "tableau";

  const [row] = await db
    .select({ appareil: appareils, site: sites, client: clients })
    .from(appareils)
    .leftJoin(sites, eq(appareils.siteId, sites.id))
    .leftJoin(clients, eq(sites.clientId, clients.id))
    .where(eq(appareils.id, id))
    .limit(1);
  if (!row) notFound();
  const { appareil } = row;
  const debut12 = ilYA12Mois();

  const [[ligne], stats, contratsAppareil, passagesAppareil, historique, piecesRows, devisOuverts, pointsNok, projetRecent, obs] = await Promise.all([
    chargerParc([id]),
    statistiquesAppareil(id),
    contratsDeLAppareil(id),
    passagesDAppareils([id]),
    db
      .select({
        id: interventions.id,
        type: interventions.type,
        statut: interventions.statut,
        description: interventions.description,
        dateProgrammee: interventions.dateProgrammee,
        dateFin: interventions.dateFin,
        valideeLe: interventions.valideeLe,
        technicien: users.nom,
        travaux: rapports.travauxRealises,
      })
      .from(interventions)
      .leftJoin(users, eq(interventions.technicienId, users.id))
      .leftJoin(rapports, eq(rapports.interventionId, interventions.id))
      .where(eq(interventions.appareilId, id))
      .orderBy(desc(sql`coalesce(${interventions.dateFin}, ${interventions.dateProgrammee}, ${interventions.createdAt})`)),
    db
      .select({ nom: pieces.nom, quantite: sql<number>`sum(${mouvementsStock.quantite})::int` })
      .from(mouvementsStock)
      .innerJoin(pieces, eq(mouvementsStock.pieceId, pieces.id))
      .innerJoin(interventions, eq(mouvementsStock.interventionId, interventions.id))
      .where(and(eq(interventions.appareilId, id), eq(mouvementsStock.type, "sortie"), gte(mouvementsStock.createdAt, debut12)))
      .groupBy(pieces.nom),
    db
      .select({ id: devis.id, numero: devis.numero, statut: devis.statut, dateEnvoi: devis.dateEnvoi, travauxPlanifiesLe: devis.travauxPlanifiesLe })
      .from(devis)
      .where(and(eq(devis.appareilId, id), inArray(devis.statut, ["a_preparer", "brouillon", "envoye", "accepte"]))),
    db
      .select({ libelle: missionChecklistTaches.libelle, interventionId: missionChecklists.interventionId })
      .from(missionChecklistTaches)
      .innerJoin(missionChecklists, eq(missionChecklistTaches.missionChecklistId, missionChecklists.id))
      .innerJoin(interventions, eq(missionChecklists.interventionId, interventions.id))
      .where(and(eq(interventions.appareilId, id), eq(missionChecklistTaches.resultat, "nok"), isNull(missionChecklistTaches.traiteLe))),
    db
      .select({ id: projets.id, reference: projets.reference, client: clients.raisonSociale, clientId: clients.id, adresse: projets.adresse, acces: projets.instructionsAcces, contactNom: projets.contactNom, contactTel: projets.contactTelephone })
      .from(projetAppareils)
      .innerJoin(projets, eq(projetAppareils.projetId, projets.id))
      .innerJoin(clients, eq(projets.clientId, clients.id))
      .where(eq(projetAppareils.appareilId, id))
      .orderBy(desc(projets.createdAt))
      .limit(1),
    db
      .select({ nom: users.nom, modele: observateurs.modele })
      .from(observateurAppareils)
      .innerJoin(observateurs, eq(observateurAppareils.observateurId, observateurs.id))
      .innerJoin(users, eq(observateurs.userId, users.id))
      .where(eq(observateurAppareils.appareilId, id)),
  ]);
  const projet = projetRecent[0] ?? null;
  const m = ligne?.mission ?? null;
  const arret = estArret(appareil.statut);
  const passagesContrat = passagesAppareil.filter((p) => p.prestationId || p.garantieId);
  const faits = passagesContrat.filter((p) => p.statut === "realise").length;
  const prochainsPassages = passagesAppareil.filter((p) => p.statut === "a_venir").slice(0, 3);
  const maintenantMs = debut12.getTime() + 365 * 86400000;
  const missionsAVenir = (ligne?.missions ?? []).filter((x) => x.statut !== "en_cours" && x.dateProgrammee && x.dateProgrammee.getTime() >= maintenantMs).slice(0, 3);
  const couvertureFin = ligne?.couvertureFin ?? null;
  const resteCouverture = couvertureFin ? couvertureFin.getTime() - maintenantMs : null;

  // Onglet « contrats », « documents », « mission », « modifier » : données à la demande.
  const [docsClient, nbObservateurs, documents, techniciens, projetsPourAppareil] = await Promise.all([
    tab === "documents"
      ? db
          .select({
            d: documentsClient,
            auteur: users.nom,
            vus: sql<string | null>`(select string_agg(u.nom || ' le ' || to_char(c.premiere_le, 'DD/MM/YYYY HH24:MI'), ', ') from ${documentsClientConsultations} c join ${users} u on u.id = c.user_id where c.document_id = ${documentsClient.id})`,
          })
          .from(documentsClient)
          .leftJoin(users, eq(documentsClient.creeParId, users.id))
          .where(eq(documentsClient.appareilId, id))
          .orderBy(desc(documentsClient.createdAt))
      : Promise.resolve([]),
    Promise.resolve([{ n: obs.length }]),
    tab === "documents" || tab === "tableau"
      ? db.select().from(documentsFormations).where(eq(documentsFormations.appareilId, id)).orderBy(desc(documentsFormations.createdAt))
      : Promise.resolve([]),
    tab === "mission" ? getTechniciens() : Promise.resolve([]),
    tab === "mission" ? getProjetsPourAppareil(id) : Promise.resolve([]),
  ]);
  const [nbObs] = nbObservateurs;

  const lienTab = (t: string) => `/responsable/appareils/${id}${t === "tableau" ? "" : `?tab=${t}`}`;
  const actionPrincipale = ligne?.action ?? null;

  return (
    <div className="flex flex-col gap-4 max-w-[1240px]">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Link href="/responsable/appareils" className="text-[13px] font-semibold text-blue">
          ← Parc d&apos;appareils
        </Link>
        <RafraichissementAuto />
      </div>

      {/* En-tête : état en grand */}
      <section className="bg-surface border border-line rounded-[20px] overflow-hidden">
        <div className={`${BANDEAU[appareil.statut] ?? "bg-navy text-white"} px-6 py-2.5 flex items-center gap-2.5 font-bold text-sm flex-wrap`}>
          <span className={`w-2.5 h-2.5 rounded-full bg-white ${arret ? "animate-pulse" : ""}`} />
          {arret ? (
            <span>
              {STATUT_LABEL[appareil.statut as (typeof STATUTS)[number]].toUpperCase()} — à l&apos;arrêt depuis {duree(appareil.statutDepuis)}
              <span className="font-medium opacity-90"> (depuis le {appareil.statutDepuis ? `${formatDate(appareil.statutDepuis)} à ${heure(appareil.statutDepuis)}` : "—"})</span>
            </span>
          ) : (
            <span>
              {STATUT_LABEL[appareil.statut as (typeof STATUTS)[number]] ?? appareil.statut}
              {appareil.statutDepuis ? <span className="font-medium opacity-90"> depuis {duree(appareil.statutDepuis)}</span> : null}
            </span>
          )}
          <span className="flex-1" />
          {ligne && ligne.priorite <= 3 && <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs">Priorité {ligne.priorite === 1 ? "P1 · Critique" : ligne.priorite === 2 ? "P2 · Urgent" : "P3 · À surveiller"}</span>}
        </div>
        <div className="px-6 py-5 flex gap-6 flex-wrap items-start">
          <div className="w-[120px] h-[120px] rounded-2xl bg-blue-pale shrink-0 overflow-hidden flex items-center justify-center text-xs text-blue text-center">
            {appareil.photoUrl ? <ImageMini src={appareil.photoUrl} alt={`Photo de l'appareil ${appareil.numeroInterne}`} className="w-full h-full object-cover" /> : <Link href={lienTab("modifier") + "#photo"} className="px-2">+ Ajouter une photo</Link>}
          </div>
          <div className="flex-1 min-w-[240px] flex flex-col gap-1.5">
            <h1 className="font-display font-extrabold text-[32px] leading-tight text-navy">{appareil.numeroInterne}</h1>
            <div className="text-[15px] font-semibold">
              {projet ? (
                <Link href={`/responsable/clients/${projet.clientId}`} className="text-ink hover:underline">
                  {projet.client}
                </Link>
              ) : (
                row.client?.raisonSociale ?? "Sans client"
              )}
              {(projet?.adresse ?? row.site?.adresse) ? <span className="font-normal text-ink-soft"> · {projet?.adresse ?? row.site?.adresse}</span> : null}
            </div>
            <div className="text-[13px] text-ink-soft">
              {[
                [appareil.marque, appareil.modele].filter(Boolean).join(" "),
                appareil.numeroSerie ? `N° série ${appareil.numeroSerie}` : null,
                appareil.anneeInstallation,
                appareil.charge ? `${Number(appareil.charge)} kg` : null,
                appareil.vitesse ? `${Number(appareil.vitesse)} m/s` : null,
                appareil.niveaux ? `${appareil.niveaux} niveaux` : null,
                appareil.typePortes ? `portes ${appareil.typePortes.toLowerCase()}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Caractéristiques à compléter"}
            </div>
            <div className="flex gap-2 flex-wrap mt-1.5">
              {couvertureFin ? (
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${resteCouverture! < 0 ? "bg-red-fill text-red-ink" : resteCouverture! < 60 * 86400000 ? "bg-orange-fill text-orange-ink" : "bg-green-fill text-green-ink"}`}>
                  {resteCouverture! < 0 ? "Contrat terminé" : "Contrat actif"} jusqu&apos;au {formatDate(couvertureFin)}
                </span>
              ) : (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-bg text-ink-soft">Sans contrat</span>
              )}
              {(ligne?.pannes90 ?? 0) > 0 && <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${(ligne?.pannes90 ?? 0) >= 3 ? "bg-red-fill text-red-ink" : "bg-bg text-ink"}`}>{ligne!.pannes90} panne(s) en 90 jours</span>}
              {obs.length > 0 && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-pale text-blue">{obs.length} observateur{obs.length > 1 ? "s" : ""}</span>}
            </div>
          </div>
          <div className="flex flex-col gap-2 w-full sm:w-auto sm:min-w-[230px]">
            {actionPrincipale && (
              <Link href={actionPrincipale.href} className={`h-11 rounded-xl flex items-center justify-center font-display font-bold text-sm px-4 ${actionPrincipale.fort ? "bg-red text-white" : "bg-blue text-white"}`}>
                {actionPrincipale.label}
              </Link>
            )}
            <Link href={lienTab("mission")} className="h-11 rounded-xl flex items-center justify-center gap-1.5 font-display font-bold text-sm border-[1.5px] border-[#B9D3EE] text-blue bg-surface hover:bg-blue-pale">
              <Plus className="w-4 h-4" /> Nouvelle mission
            </Link>
            <div className="flex gap-2">
              <details className="relative flex-1">
                <summary className="list-none cursor-pointer h-10 rounded-[10px] border border-line bg-surface text-[13px] font-semibold flex items-center justify-center hover:bg-blue-pale">Changer l&apos;état</summary>
                <form action={changerEtatAppareilBureau} className="absolute right-0 z-20 mt-1 w-56 bg-surface border border-line rounded-xl shadow-lg p-2 flex flex-col gap-1">
                  <input type="hidden" name="appareilId" value={appareil.id} />
                  {STATUTS.map((s) => (
                    <BoutonEnvoi key={s} name="statut" value={s} disabled={s === appareil.statut} className="text-left text-sm rounded-lg px-3 py-2 hover:bg-blue-pale disabled:opacity-50 flex items-center gap-2">
                      <PastilleEtat statut={s} />
                    </BoutonEnvoi>
                  ))}
                </form>
              </details>
              <Link href={`/responsable/appareils/${appareil.id}/qr`} className="flex-1 h-10 rounded-[10px] border border-line bg-surface text-[13px] font-semibold flex items-center justify-center gap-1.5 hover:bg-blue-pale">
                <QrCode className="w-4 h-4" /> QR
              </Link>
            </div>
          </div>
        </div>
        {/* Chiffres clés */}
        <div className="grid grid-cols-2 md:grid-cols-5 border-t border-line">
          <Chiffre libelle={`Disponibilité ${stats.jours >= 360 ? "12 mois" : `${stats.jours} j`}`} valeur={`${stats.disponibilite.toLocaleString("fr-BE")} %`} ton={stats.disponibilite < 95 ? "rouge" : stats.disponibilite < 99 ? "orange" : "vert"} note={stats.estime ? "date de début estimée" : undefined} />
          <Chiffre libelle="Pannes 12 mois" valeur={String(stats.pannes12)} ton={stats.pannes12 >= 4 ? "rouge" : "navy"} />
          <Chiffre libelle="Délai moyen de remise en service" valeur={dureeMs(stats.delaiMoyen)} />
          <Chiffre libelle="Passages contrat" valeur={passagesContrat.length ? `${faits} / ${passagesContrat.length}` : "—"} />
          <Chiffre libelle="Prochaine visite" valeur={ligne?.prochaineVisite ? jourCourt(ligne.prochaineVisite) : "—"} />
        </div>
      </section>

      {/* Onglets */}
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections de la fiche">
        {ONGLETS.map(([k, label]) => (
          <Link key={k} href={lienTab(k)} aria-current={tab === k ? "page" : undefined} className={`px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px ${tab === k ? "border-blue text-blue" : "border-transparent text-ink-soft hover:text-ink"}`}>
            {label}
          </Link>
        ))}
      </nav>

      {tab === "tableau" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 flex flex-col gap-4 min-w-0">
            <Card className="p-5 flex flex-col gap-3">
              <div className="flex justify-between items-center gap-2 flex-wrap">
                <h2 className="font-display font-extrabold text-base text-navy">En ce moment</h2>
                {ligne && <BadgePriorite p={ligne.priorite} />}
              </div>
              {arret && <ArretDepuis statut={appareil.statut} depuis={appareil.statutDepuis} grand />}
              {m ? (
                <Link href={`/responsable/missions/${m.id}`} className={`rounded-[14px] p-3.5 flex flex-col gap-2.5 hover:bg-bg/60 ${arret ? "border-[1.5px] border-[#E7A39B]" : "border border-line"}`}>
                  <div className="flex justify-between gap-2 flex-wrap">
                    <span className="font-bold">{m.type === "corrective" ? "Dépannage" : m.type === "systematique" ? "Contrôle systématique" : "Maintenance préventive"}</span>
                    <span className="text-xs text-ink-soft">{m.dateProgrammee ? `Prévue le ${formatDate(m.dateProgrammee)} à ${heure(m.dateProgrammee)}` : "Sans date"}</span>
                  </div>
                  <EtapesMission m={m} origine={ligne?.personneBloquee ? { libelle: "Signalée", quand: ligne.personneBloquee.createdAt } : null} />
                  <div className="text-[13px] text-ink-soft">
                    {m.technicien ?? "Aucun technicien"}
                    {m.envoyeeLe && !m.accepteeLe ? ` · envoyée il y a ${duree(m.envoyeeLe)}` : ""}
                    {m.statut === "en_cours" && m.dateDebut ? ` · sur place depuis ${duree(m.dateDebut)}` : ""}
                    {ligne && ligne.raison && ligne.priorite <= 2 ? <span className="font-semibold text-red-ink"> · {ligne.raison}</span> : null}
                  </div>
                </Link>
              ) : (
                <p className={`text-sm ${arret ? "font-semibold text-red-ink" : "text-ink-soft"}`}>{arret ? "Aucune mission en cours pour cet appareil à l'arrêt." : "Aucune mission en cours."}</p>
              )}
              {(ligne?.missions.length ?? 0) > 1 && <p className="text-xs text-ink-soft">+ {ligne!.missions.length - 1} autre(s) mission(s) ouverte(s) — voir l&apos;historique.</p>}
              {(devisOuverts.length > 0 || pointsNok.length > 0 || ligne?.personneBloquee) && (
                <div className="flex gap-2 flex-wrap text-[13px]">
                  {ligne?.personneBloquee && (
                    <Link href={`/responsable/demandes/${ligne.personneBloquee.id}`} className="bg-red text-white rounded-[10px] px-3 py-2 font-semibold">
                      Personne bloquée — {ligne.personneBloquee.numero}
                    </Link>
                  )}
                  {devisOuverts.map((d) => (
                    <Link key={d.id} href={`/responsable/devis/${d.id}`} className="bg-orange-fill text-orange-ink rounded-[10px] px-3 py-2 font-semibold">
                      Devis {d.numero} — {d.statut === "accepte" ? (d.travauxPlanifiesLe ? "travaux planifiés" : "accepté, travaux à planifier") : d.statut === "envoye" ? `en attente du client${d.dateEnvoi ? ` (envoyé il y a ${duree(d.dateEnvoi)})` : ""}` : (STATUTS_DEVIS[d.statut]?.label ?? d.statut).toLowerCase()}
                    </Link>
                  ))}
                  {pointsNok.slice(0, 3).map((p, i) => (
                    <Link key={i} href={`/responsable/missions/${p.interventionId}#checklist`} className="bg-bg rounded-[10px] px-3 py-2">
                      Checklist ✗ « {p.libelle} » non traité
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5 flex flex-col gap-3">
              <div className="flex justify-between items-center gap-2 flex-wrap">
                <h2 className="font-display font-extrabold text-base text-navy">Pannes et interventions — 12 mois</h2>
                <span className="text-xs text-ink-soft">par mois</span>
              </div>
              <GraphiqueMois mois={stats.mois} />
            </Card>

            <Card className="p-5 flex flex-col">
              <h2 className="font-display font-extrabold text-base text-navy mb-2 flex items-center gap-2">
                <History className="w-4 h-4" /> Historique ({historique.length})
              </h2>
              {historique.slice(0, 12).map((h) => (
                <LigneHistorique
                  key={h.id}
                  id={h.id}
                  quand={h.dateFin ?? h.dateProgrammee}
                  type={h.type}
                  texte={(h.travaux ?? h.description ?? "Sans description").split("\n")[0].slice(0, 160)}
                  technicien={h.technicien}
                  statut={h.statut}
                  valide={!!h.valideeLe}
                />
              ))}
              {historique.length === 0 && <p className="text-sm text-ink-soft">Aucune intervention pour l&apos;instant.</p>}
              {historique.length > 12 && <p className="text-xs text-ink-soft pt-2">+ {historique.length - 12} intervention(s) plus ancienne(s).</p>}
            </Card>
          </div>

          <div className="flex flex-col gap-4 min-w-0">
            <Card className="p-5 flex flex-col gap-2">
              <h2 className="font-display font-extrabold text-base text-navy flex items-center gap-2">
                <CalendarClock className="w-4 h-4" /> Prochaines visites
              </h2>
              {[
                ...missionsAVenir.map((x) => ({ cle: x.id, texte: x.type === "corrective" ? "Dépannage" : x.type === "systematique" ? "Contrôle systématique" : "Préventive", date: x.dateProgrammee!, href: `/responsable/missions/${x.id}` })),
                ...prochainsPassages.map((p) => ({ cle: p.id, texte: `${p.garantieId ? "Garantie" : "Contrat"} — passage ${p.numero}/${p.total}`, date: p.datePrevue, href: `/responsable/garanties/passages/${p.id}` })),
              ]
                .sort((a, b) => a.date.getTime() - b.date.getTime())
                .slice(0, 4)
                .map((v) => (
                  <Link key={v.cle} href={v.href} className="flex justify-between gap-2 text-[13px] py-2 border-b border-line last:border-0 hover:text-blue">
                    <span>{v.texte}</span>
                    <strong>{formatDate(v.date)}</strong>
                  </Link>
                ))}
              {missionsAVenir.length + prochainsPassages.length === 0 && <p className="text-sm text-ink-soft">Rien de prévu.</p>}
            </Card>

            <Card className="p-5 flex flex-col gap-2.5">
              <h2 className="font-display font-extrabold text-base text-navy flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Contrat &amp; garantie
              </h2>
              {contratsAppareil.length === 0 && !passagesAppareil.some((p) => p.garantieId) ? (
                <p className="text-sm text-ink-soft">Aucun contrat ni garantie.</p>
              ) : (
                <>
                  {contratsAppareil.slice(0, 2).map((c) => (
                    <div key={c.id} className="text-[13px]">
                      <div className="font-semibold">{c.titre}</div>
                      <div className="text-xs text-ink-soft">
                        {c.dateDebut ? formatDate(c.dateDebut) : "—"} → {c.dateFin ? formatDate(c.dateFin) : "—"}
                      </div>
                    </div>
                  ))}
                  {passagesContrat.length > 0 && (
                    <>
                      <div className="h-2 rounded-full bg-line overflow-hidden">
                        <div className="h-full bg-blue" style={{ width: `${Math.round((faits / passagesContrat.length) * 100)}%` }} />
                      </div>
                      <div className="flex justify-between text-xs text-ink-soft">
                        <span>{faits} passage(s) réalisé(s) sur {passagesContrat.length}</span>
                        {couvertureFin && <span>fin {formatDate(couvertureFin)}</span>}
                      </div>
                    </>
                  )}
                </>
              )}
              <Link href={lienTab("contrats")} className="text-[13px] font-bold text-blue">Détail des passages →</Link>
            </Card>

            <Card className="p-5 flex flex-col gap-2">
              <h2 className="font-display font-extrabold text-base text-navy flex items-center gap-2">
                <KeyRound className="w-4 h-4" /> Client &amp; accès
              </h2>
              {projet ? (
                <>
                  {projet.contactNom && (
                    <div className="text-[13px]">
                      <strong>Contact :</strong> {projet.contactNom}
                      {projet.contactTel ? (
                        <>
                          {" "}
                          · <a href={`tel:${projet.contactTel.replace(/\s/g, "")}`}>{projet.contactTel}</a>
                        </>
                      ) : null}
                    </div>
                  )}
                  {projet.acces && (
                    <div className="text-[13px]">
                      <strong>Accès :</strong> {projet.acces}
                    </div>
                  )}
                  <div className="text-[13px]">
                    <strong>Projet :</strong>{" "}
                    <Link href={`/responsable/projets/${projet.id}`} className="text-blue font-semibold">
                      {projet.reference}
                    </Link>
                  </div>
                </>
              ) : (
                <p className="text-sm text-ink-soft">Rattaché à aucun projet.</p>
              )}
              {obs.length > 0 && <div className="text-xs text-ink-soft">Observateurs : {obs.map((o) => `${o.nom}${o.modele ? ` (${o.modele})` : ""}`).join(", ")}</div>}
            </Card>

            <Card className="p-5 flex flex-col gap-2">
              <h2 className="font-display font-extrabold text-base text-navy flex items-center gap-2">
                <FileText className="w-4 h-4" /> Documents
              </h2>
              {documents.slice(0, 4).map((d) => (
                <div key={d.id} className="text-[13px] flex justify-between gap-2">
                  {d.urlFichier ? (
                    <a href={d.urlFichier} target="_blank" rel="noreferrer" className="truncate text-blue hover:underline">
                      {d.titre}
                    </a>
                  ) : (
                    <span className="truncate">{d.titre}</span>
                  )}
                  <span className="text-xs text-ink-soft whitespace-nowrap">{CATEGORIE_DOC_LABEL[d.categorie] ?? d.categorie}</span>
                </div>
              ))}
              {documents.length === 0 && <p className="text-sm text-ink-soft">Aucun document interne.</p>}
              <Link href={lienTab("documents")} className="text-[13px] font-bold text-blue">Documents client et internes →</Link>
            </Card>

            <Card className="p-5 flex flex-col gap-2">
              <h2 className="font-display font-extrabold text-base text-navy flex items-center gap-2">
                <Package className="w-4 h-4" /> Pièces remplacées (12 mois)
              </h2>
              {piecesRows.length ? <div className="text-[13px]">{piecesRows.map((p) => `${p.nom} × ${p.quantite}`).join(" · ")}</div> : <p className="text-sm text-ink-soft">Aucune pièce.</p>}
            </Card>

            {ligne && ligne.priorite === 3 && (
              <Card className="p-5 flex flex-col gap-1 border-[#F0C9A5]">
                <h2 className="font-display font-extrabold text-base text-orange-ink flex items-center gap-2">
                  <TriangleAlert className="w-4 h-4" /> À surveiller
                </h2>
                <div className="text-[13px] font-semibold">{ligne.raison}</div>
                {ligne.detail && <div className="text-xs text-ink-soft">{ligne.detail}</div>}
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "contrats" && (
        <div className="max-w-3xl">
          <Card className="p-5" id="contrats">
            <h2 className="font-display font-bold text-sm mb-3">Contrats & passages</h2>
            {contratsAppareil.length === 0 && !passagesAppareil.some((p) => p.garantieId) && (
              <p className="text-sm text-ink-soft">Aucun contrat ni garantie — ajoutez un contrat à passages depuis le projet (onglet « Prestations & garantie »).</p>
            )}
            {passagesAppareil.some((p) => p.garantieId) && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-ink-soft mb-2">Garantie</div>
                <FrisePassages passages={passagesAppareil.filter((p) => p.garantieId)} />
              </div>
            )}
            {contratsAppareil.map((c) => {
              const e = ETAT_CONTRAT[etatContrat(c)];
              return (
                <div key={c.id} className="mb-4 last:mb-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                    <div className="text-sm">
                      <span className="font-semibold">{c.titre}</span>{" "}
                      <span className="text-xs text-ink-soft">
                        · {c.dateDebut ? formatDate(c.dateDebut) : "—"} → {c.dateFin ? formatDate(c.dateFin) : "—"} ·{" "}
                        <Link href={`/responsable/projets/${c.projetId}?tab=garantie#contrats`} className="text-blue font-semibold">{c.projetRef}</Link>
                      </span>
                    </div>
                    <Pill tone={e.tone}>{e.label}</Pill>
                  </div>
                  <FrisePassages passages={passagesAppareil.filter((p) => p.prestationId === c.id)} />
                </div>
              );
            })}
          </Card>


        </div>
      )}

      {tab === "documents" && (
        <div className="flex flex-col gap-4 max-w-3xl">
          <Card className="p-5 border-[1.5px] border-blue/40">
            <div id="documents-client" className="scroll-mt-24" />
            <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
              <h2 className="font-display font-bold text-sm">Documents client ({docsClient.filter((x) => !x.d.archiveLe).length})</h2>
              <span className="text-[11px] text-ink-soft">Visibles uniquement par les observateurs de cet ascenseur ({nbObs?.n ?? 0})</span>
            </div>
            <p className="text-xs text-ink-soft mb-3">Contrat, attestation, rapport de contrôle, devis… Vos documents internes (ci-dessous) ne sont jamais montrés au client.</p>
            <div className="flex flex-col divide-y divide-line">
              {docsClient.map(({ d, auteur, vus }) => (
                <div key={d.id} className={`py-2.5 flex items-start justify-between gap-3 ${d.archiveLe ? "opacity-50" : ""}`}>
                  <div className="min-w-0 text-sm">
                    <a href={d.url} target="_blank" rel="noreferrer" className="font-semibold text-blue hover:underline">{d.titre}</a>
                    <span className="text-xs text-ink-soft"> · {TYPES_DOCUMENT_CLIENT[d.type] ?? "Document"} · {formatDate(d.createdAt)}{auteur ? ` · ${auteur}` : ""}</span>
                    {d.message && <div className="text-xs text-ink-soft">« {d.message} »</div>}
                    <div className={`text-[11px] font-semibold ${vus ? "text-green-ink" : "text-ink-soft"}`}>{vus ? `Consulté par ${vus}` : "Pas encore consulté"}</div>
                  </div>
                  <form action={archiverDocumentClient}>
                    <input type="hidden" name="documentId" value={d.id} />
                    <input type="hidden" name="appareilId" value={appareil.id} />
                    <BoutonEnvoi type="submit" className="text-xs font-bold text-ink-soft hover:text-red-ink">{d.archiveLe ? "Remettre" : "Retirer"}</BoutonEnvoi>
                  </form>
                </div>
              ))}
              {docsClient.length === 0 && <p className="text-sm text-ink-soft py-1">Aucun document partagé avec le client.</p>}
            </div>
            <details className="mt-3 pt-3 border-t border-line">
              <summary className="text-sm font-bold text-blue cursor-pointer select-none">+ Ajouter un document pour le client</summary>
              <form action={ajouterDocumentClient} className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <input type="hidden" name="appareilId" value={appareil.id} />
                <Field label="Titre">
                  <input name="titre" required maxLength={200} className={inputClass} placeholder="Ex. Contrat de maintenance 2026" />
                </Field>
                <Field label="Type">
                  <select name="type" defaultValue="autre" className={inputClass}>
                    {Object.entries(TYPES_DOCUMENT_CLIENT).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Message pour le client (facultatif)">
                    <input name="message" maxLength={1000} className={inputClass} placeholder="Ex. Voici l'attestation demandée." />
                  </Field>
                </div>
                <Field label="Fichier (PDF, image, Word, Excel — 20 Mo max)">
                  <input type="file" name="fichier" required className="text-sm" />
                </Field>
                <div className="flex items-end">
                  <Btn>Partager avec le client</Btn>
                </div>
              </form>
            </details>
          </Card>

          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">
              Documents internes ({documents.length})
            </h2>
            <div className="flex flex-col divide-y divide-line">
              {documents.map((d) => (
                <div key={d.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Pill tone="neutral">{CATEGORIE_DOC_LABEL[d.categorie] ?? d.categorie}</Pill>
                      {d.urlFichier ? (
                        <a
                          href={d.urlFichier}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-blue font-semibold hover:underline truncate"
                        >
                          {d.titre}
                        </a>
                      ) : (
                        <span className="text-sm truncate">{d.titre}</span>
                      )}
                    </div>
                    <div className="text-xs text-ink-soft mt-0.5 capitalize">{d.typeContenu}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    
                    <span className="text-xs text-ink-soft whitespace-nowrap">
                      {formatDate(d.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
              {documents.length === 0 && (
                <p className="text-sm text-ink-soft py-2">
                  Aucun document rattaché à cet appareil pour l&apos;instant.
                </p>
              )}
            </div>
          </Card>

        </div>
      )}

      {tab === "mission" && (
        <Card className="p-5 max-w-2xl" id="nouvelle-mission">
          <h2 className="font-display font-bold text-sm mb-3">Nouvelle intervention</h2>
          {projetsPourAppareil.length === 0 ? (
            <p className="text-sm text-ink-soft">
              Cet appareil n&apos;est rattaché à aucun Projet pour l&apos;instant. Un Projet est
              désormais obligatoire pour créer une intervention —{" "}
              <Link href="/responsable/projets" className="text-blue font-semibold">
                attachez d&apos;abord cet appareil à un Projet
              </Link>
              .
            </p>
          ) : (
          <form action={createIntervention} className="flex flex-col gap-4">
            <input type="hidden" name="appareilId" value={appareil.id} />

            <div className="flex flex-col gap-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-blue">Quoi / Pourquoi</div>
              <Field label="Projet">
                <select name="projetId" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Choisir un projet
                  </option>
                  {projetsPourAppareil.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.reference} — {p.titre}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Type">
                <select name="type" className={inputClass} defaultValue="preventive">
                  <option value="preventive">Préventive</option>
                  <option value="corrective">Corrective</option>
                  <option value="systematique">Systématique</option>
                </select>
              </Field>
              <Field label="Priorité">
                <select name="priorite" className={inputClass} defaultValue="normale">
                  <option value="basse">Basse</option>
                  <option value="normale">Normale</option>
                  <option value="haute">Haute</option>
                  <option value="critique">Critique</option>
                </select>
              </Field>
              <Field label="Description">
                <textarea name="description" rows={3} className={inputClass} />
              </Field>
            </div>

            <div className="flex flex-col gap-3 pt-3 border-t border-line">
              <div className="text-[11px] font-bold uppercase tracking-wide text-blue">Qui / Quand</div>
              <Field label="Technicien affecté (optionnel)">
                <select name="technicienId" className={inputClass} defaultValue="">
                  <option value="">Non affecté</option>
                  {techniciens.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nom}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date et heure *">
                <input type="datetime-local" name="dateProgrammee" required className={inputClass} />
              </Field>
            </div>

            <Btn>Créer l&apos;intervention</Btn>
          </form>
          )}
        </Card>

      )}

      {tab === "modifier" && (
        <div className="flex flex-col gap-4 max-w-3xl">
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Modifier la fiche</h2>
            <form action={updateAppareil} className="flex flex-col gap-3">
              <input type="hidden" name="appareilId" value={appareil.id} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="N° unique interne Robus">
                  <input
                    name="numeroInterne"
                    required
                    defaultValue={appareil.numeroInterne}
                    className={inputClass}
                  />
                </Field>
                <Field label="Statut">
                  <select name="statut" className={inputClass} defaultValue={appareil.statut}>
                    {STATUTS.map((s) => (
                      <option key={s} value={s}>
                        {STATUT_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Marque">
                  <input name="marque" defaultValue={appareil.marque ?? ""} className={inputClass} />
                </Field>
                <Field label="Modèle">
                  <input name="modele" defaultValue={appareil.modele ?? ""} className={inputClass} />
                </Field>
                <Field label="N° de série constructeur">
                  <input
                    name="numeroSerie"
                    defaultValue={appareil.numeroSerie ?? ""}
                    className={inputClass}
                  />
                </Field>
                <Field label="Type d'appareil">
                  <input
                    name="typeAppareil"
                    defaultValue={appareil.typeAppareil ?? ""}
                    className={inputClass}
                  />
                </Field>
                <Field label="Charge (kg)">
                  <input
                    name="charge"
                    type="number"
                    step="0.01"
                    defaultValue={appareil.charge ?? ""}
                    className={inputClass}
                  />
                </Field>
                <Field label="Vitesse (m/s)">
                  <input
                    name="vitesse"
                    type="number"
                    step="0.01"
                    defaultValue={appareil.vitesse ?? ""}
                    className={inputClass}
                  />
                </Field>
                <Field label="Niveaux">
                  <input
                    name="niveaux"
                    type="number"
                    defaultValue={appareil.niveaux ?? ""}
                    className={inputClass}
                  />
                </Field>
                <Field label="Année d'installation">
                  <input
                    name="anneeInstallation"
                    type="number"
                    defaultValue={appareil.anneeInstallation ?? ""}
                    className={inputClass}
                  />
                </Field>
                <Field label="Type de portes">
                  <input
                    name="typePortes"
                    defaultValue={appareil.typePortes ?? ""}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Btn>Enregistrer les modifications</Btn>
            </form>
          </Card>

          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3" id="photo">Photo de l&apos;appareil</h2>
            <form action={uploadAppareilPhoto} className="flex flex-col gap-3" encType="multipart/form-data">
              <input type="hidden" name="appareilId" value={appareil.id} />
              <FileField
                label="Choisir une photo (JPEG / PNG / WEBP, 8 Mo max)"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                maxBytes={8 * 1024 * 1024}
                required
              />
              <Btn variant="ghost" className="self-start">
                {appareil.photoUrl ? "Remplacer la photo" : "Ajouter la photo"}
              </Btn>
            </form>
          </Card>


        </div>
      )}
    </div>
  );
}

function Chiffre({ libelle, valeur, ton = "navy", note }: { libelle: string; valeur: string; ton?: "navy" | "rouge" | "orange" | "vert"; note?: string }) {
  const couleur = ton === "rouge" ? "text-red-ink" : ton === "orange" ? "text-orange-ink" : ton === "vert" ? "text-green-ink" : "text-navy";
  return (
    <div className="px-5 py-3.5 border-r border-b md:border-b-0 border-line last:border-r-0">
      <div className="text-xs text-ink-soft">{libelle}</div>
      <div className={`font-display font-extrabold text-2xl ${couleur}`}>{valeur}</div>
      {note && <div className="text-[10px] text-ink-soft">{note}</div>}
    </div>
  );
}
