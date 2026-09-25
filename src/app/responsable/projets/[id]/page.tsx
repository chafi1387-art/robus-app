import { Card, Btn, Field, Pill, inputClass, StatutInterventionPill, TypeInterventionPill } from "@/components/ui";
import { FileField } from "@/components/file-field";
import { db } from "@/db";
import {
  appareils,
  clients,
  documentsFormations,
  journalActivite,
  garanties,
  garantieFormules,
  interventions,
  ordresMissionEnvois,
  prestations,
  prestationsCatalogue,
  projetAppareils,
  projets,
  projetTechniciens,
  rapportPhotos,
  rapports,
  sites,
  users,
} from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatDateTime } from "@/lib/format";
import { getTechniciens } from "../../actions";
import {
  activerExtensionGarantie,
  ajouterAppareilProjet,
  ajouterTechnicienProjet,
  avancerStatutProjet,
  changerStatutProjetAdmin,
  choisirGarantieProjet,
  createPrestation,
  envoyerOrdreMissionAvecMessage,
  getGarantieFormulesActives,
  getPiecesForSelect,
  getPrestationsCatalogueActives,
  modifierRoleTechnicienProjet,
  retirerTechnicienProjet,
  supprimerDocument,
  updateProjetInfos,
} from "../actions";
import { createDocument } from "../../documents/actions";
import { createIntervention } from "../../actions";
import { CalendarDays, FileDown, HardHat, Plus, ArrowUpDown, ShieldCheck } from "lucide-react";
import { FICHIER_MAX_BYTES, FICHIER_TYPES } from "@/lib/document-file-rules";

function truncate(texte: string | null | undefined, n: number) {
  if (!texte) return "—";
  return texte.length > n ? `${texte.slice(0, n).trimEnd()}…` : texte;
}

const ETAPES_ISO = ["cree", "planifie", "en_cours", "termine", "valide_iso"] as const;
const ETAPE_LABEL: Record<string, string> = {
  cree: "Créé",
  planifie: "Planifié",
  en_cours: "En cours",
  termine: "Terminé",
  valide_iso: "Validé ISO",
};

const PRESTATION_TYPE_LABEL: Record<string, string> = {
  installation: "Installation",
  reparation: "Réparation",
  garantie: "Garantie",
  maintenance_preventive: "Maintenance préventive",
  maintenance_corrective: "Maintenance corrective",
  maintenance_systematique: "Maintenance systématique",
  vente_piece: "Vente de pièce",
};

const CATEGORIE_PRESTATION_LABEL: Record<string, string> = {
  installation: "Installation",
  reparation: "Réparation",
  maintenance: "Maintenance",
  vente_piece: "Vente de pièce",
  autre: "Autre",
};

const CATEGORIE_DOC_LABEL: Record<string, string> = {
  securite: "Sécurité",
  installation: "Installation",
  maintenance: "Maintenance",
  depannage: "Dépannage",
  marques: "Marques",
  procedures_robus: "Procédures Robus",
  videos: "Vidéos",
  fournisseur_iso: "Fournisseur / ISO 9001",
};

// Même énumération que src/app/responsable/documents/page.tsx — dupliquée
// ici volontairement (constante simple, pas de source partagée) pour le
// formulaire d'ajout inline et le filtre de la carte Documentation.
const CATEGORIES_DOC = [
  "securite",
  "installation",
  "maintenance",
  "depannage",
  "marques",
  "procedures_robus",
  "videos",
  "fournisseur_iso",
] as const;
type CategorieDoc = (typeof CATEGORIES_DOC)[number];

const ONGLETS = [
  { id: "apercu", label: "Vue d'ensemble" },
  { id: "missions", label: "Missions" },
  { id: "appareils", label: "Appareils" },
  { id: "equipe", label: "Équipe" },
  { id: "garantie", label: "Garantie & prestations" },
  { id: "documents", label: "Documents" },
  { id: "historique", label: "Historique" },
] as const;

const TYPE_PROJET_LABEL: Record<string, string> = {
  installation: "Installation",
  maintenance: "Maintenance",
  modernisation: "Modernisation",
  reparation: "Réparation",
};
const STATUTS_MISSION_FINIS = new Set(["terminee", "validee", "cloturee"]);

const EXTENSIONS_IMAGE = ["jpg", "jpeg", "png", "gif", "webp", "svg"];

// Badge visuel de la carte Documentation : vraie vignette pour une image,
// emoji simple pour PDF/vidéo — pas besoin de plus.
function getDocVisual(d: { typeContenu: string; urlFichier: string | null }) {
  const ext = d.urlFichier?.split(".").pop()?.toLowerCase();
  if (ext && EXTENSIONS_IMAGE.includes(ext)) {
    return { kind: "image" as const, url: d.urlFichier as string };
  }
  if (d.typeContenu === "video") return { kind: "emoji" as const, emoji: "🎬" };
  return { kind: "emoji" as const, emoji: "📄" };
}

function buildDocQuery(categorie: string | undefined, tri: "asc" | "desc") {
  const params = new URLSearchParams();
  params.set("tab", "documents");
  if (categorie) params.set("docCategorie", categorie);
  if (tri !== "desc") params.set("docTri", tri);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function ProjetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ docCategorie?: string; docTri?: string; tab?: string; cree?: string }>;
}) {
  const user = await requireUser(ROLES_BUREAU);
  const { id } = await params;
  const { docCategorie, docTri, tab: tabParam, cree } = await searchParams;
  const tab = (ONGLETS.map((o) => o.id) as string[]).includes(tabParam ?? "") ? (tabParam as string) : "apercu";
  const docCategorieValide = (CATEGORIES_DOC as readonly string[]).includes(docCategorie ?? "")
    ? (docCategorie as CategorieDoc)
    : undefined;
  const docTriValide: "asc" | "desc" = docTri === "asc" ? "asc" : "desc";

  const [row] = await db
    .select({ projet: projets, client: clients })
    .from(projets)
    .innerJoin(clients, eq(projets.clientId, clients.id))
    .where(eq(projets.id, id))
    .limit(1);
  if (!row) notFound();
  const { projet, client } = row;

  const [
    appareilsAttaches,
    techniciensAffectes,
    prestationsListe,
    garantieRow,
    interventionsListe,
    techniciensOptions,
    formulesOptions,
    // Phase 6 : l'Appareil est indépendant du Site/Client — n'importe quel
    // appareil pas encore attaché à ce Projet peut lui être proposé.
    tousLesAppareils,
    catalogueOptions,
    piecesOptions,
    documentsProjet,
    historiqueEnvois,
  ] = await Promise.all([
    db
      .select({
        id: appareils.id,
        numeroInterne: appareils.numeroInterne,
        adresse: sites.adresse,
      })
      .from(projetAppareils)
      .innerJoin(appareils, eq(projetAppareils.appareilId, appareils.id))
      .leftJoin(sites, eq(appareils.siteId, sites.id))
      .where(eq(projetAppareils.projetId, id)),
    db
      .select({ id: users.id, nom: users.nom, role: projetTechniciens.role })
      .from(projetTechniciens)
      .innerJoin(users, eq(projetTechniciens.technicienId, users.id))
      .where(eq(projetTechniciens.projetId, id)),
    db
      .select({
        prestation: prestations,
        catalogueNom: prestationsCatalogue.nom,
        catalogueCategorie: prestationsCatalogue.categorie,
      })
      .from(prestations)
      .leftJoin(prestationsCatalogue, eq(prestations.catalogueId, prestationsCatalogue.id))
      .where(eq(prestations.projetId, id)),
    db
      .select({ garantie: garanties, formule: garantieFormules })
      .from(garanties)
      .leftJoin(garantieFormules, eq(garanties.formuleId, garantieFormules.id))
      .where(eq(garanties.projetId, id))
      .limit(1),
    // Phase 7 : chaque intervention est désormais accompagnée d'un aperçu de
    // son rapport (LEFT JOIN — une intervention sans rapport reste affichée).
    db
      .select({
        id: interventions.id,
        type: interventions.type,
        statut: interventions.statut,
        dateProgrammee: interventions.dateProgrammee,
        numeroInterne: appareils.numeroInterne,
        technicien: users.nom,
        rapportId: rapports.id,
        travauxRealises: rapports.travauxRealises,
        tempsPasseMinutes: rapports.tempsPasseMinutes,
      })
      .from(interventions)
      .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
      .leftJoin(users, eq(interventions.technicienId, users.id))
      .leftJoin(rapports, eq(rapports.interventionId, interventions.id))
      .where(eq(interventions.projetId, id))
      .orderBy(desc(interventions.dateProgrammee)),
    getTechniciens(),
    getGarantieFormulesActives(),
    db
      .select({ id: appareils.id, numeroInterne: appareils.numeroInterne, adresse: sites.adresse })
      .from(appareils)
      .leftJoin(sites, eq(appareils.siteId, sites.id))
      .orderBy(appareils.numeroInterne),
    getPrestationsCatalogueActives(),
    getPiecesForSelect(),
    db
      .select()
      .from(documentsFormations)
      .where(eq(documentsFormations.projetId, id))
      .orderBy(desc(documentsFormations.createdAt)),
    // Phase 7 : historique des ordres de mission envoyés (affectation
    // initiale + renvois manuels) — le plus récent en premier.
    db
      .select({
        id: ordresMissionEnvois.id,
        technicienNom: users.nom,
        message: ordresMissionEnvois.message,
        documentsJointIds: ordresMissionEnvois.documentsJointIds,
        createdAt: ordresMissionEnvois.createdAt,
      })
      .from(ordresMissionEnvois)
      .leftJoin(users, eq(ordresMissionEnvois.technicienId, users.id))
      .where(eq(ordresMissionEnvois.projetId, id))
      .orderBy(desc(ordresMissionEnvois.createdAt)),
  ]);

  // Filtre + tri en mémoire (petite liste, une seule requête déjà faite plus
  // haut) — piloté par ?docCategorie=...&docTri=asc|desc sur cette même page.
  const documentsProjetAffiches = documentsProjet
    .filter((d) => !docCategorieValide || d.categorie === docCategorieValide)
    .sort((a, b) =>
      docTriValide === "asc"
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : b.createdAt.getTime() - a.createdAt.getTime()
    );

  const appareilsAttachesIds = new Set(appareilsAttaches.map((a) => a.id));
  const appareilsDisponibles = tousLesAppareils.filter((a) => !appareilsAttachesIds.has(a.id));

  // Phase 7 : documents proposables à l'envoi (affectation ou renvoi) — ceux
  // rattachés directement au Projet OU à l'un des appareils attachés, à
  // condition d'avoir bien un fichier/lien joint (rien à joindre sinon).
  const conditionsDocuments = [eq(documentsFormations.projetId, id)];
  if (appareilsAttachesIds.size > 0) {
    conditionsDocuments.push(inArray(documentsFormations.appareilId, [...appareilsAttachesIds]));
  }
  const documentsPourEnvoi = await db
    .select({ id: documentsFormations.id, titre: documentsFormations.titre })
    .from(documentsFormations)
    .where(and(isNotNull(documentsFormations.urlFichier), or(...conditionsDocuments)))
    .orderBy(desc(documentsFormations.createdAt));

  // Phase 7 : photos des rapports, regroupées par rapportId, pour l'aperçu
  // "Interventions & rapports" ci-dessous (au plus 3 vignettes + un badge).
  const rapportIdsAvecRapport = interventionsListe
    .map((i) => i.rapportId)
    .filter((rid): rid is string => !!rid);
  const photosRows = rapportIdsAvecRapport.length
    ? await db.select().from(rapportPhotos).where(inArray(rapportPhotos.rapportId, rapportIdsAvecRapport))
    : [];
  const photosParRapport = new Map<string, typeof photosRows>();
  for (const p of photosRows) {
    const liste = photosParRapport.get(p.rapportId) ?? [];
    liste.push(p);
    photosParRapport.set(p.rapportId, liste);
  }

  const garantie = garantieRow[0];
  const indexEtapeActuelle = ETAPES_ISO.indexOf(projet.statut);
  const prochaineEtape = ETAPES_ISO[indexEtapeActuelle + 1];
  const techniciensDejaAffectesIds = new Set(techniciensAffectes.map((t) => t.id));
  const techniciensDisponibles = techniciensOptions.filter(
    (t) => !techniciensDejaAffectesIds.has(t.id)
  );

  const journalProjet =
    tab === "historique"
      ? await db
          .select({ id: journalActivite.id, action: journalActivite.action, details: journalActivite.details, createdAt: journalActivite.createdAt, auteur: users.nom })
          .from(journalActivite)
          .leftJoin(users, eq(journalActivite.utilisateurId, users.id))
          .where(eq(journalActivite.entiteId, id))
          .orderBy(desc(journalActivite.createdAt))
          .limit(200)
      : [];
  const maintenant = Date.now();
  const missionsActives = interventionsListe.filter((i) => !STATUTS_MISSION_FINIS.has(i.statut));
  const missionsEnRetard = missionsActives.filter((i) => i.dateProgrammee && i.dateProgrammee.getTime() < maintenant);
  const ongletHref = (o: string) => `/responsable/projets/${projet.id}?tab=${o}`;
  const STATUT_BADGE: Record<string, string> = {
    cree: "bg-[#eef2f6] text-ink-soft",
    planifie: "bg-blue-pale text-blue",
    en_cours: "bg-orange-fill text-orange-ink",
    termine: "bg-green-fill text-green-ink",
    valide_iso: "bg-green-fill text-green-ink",
  };

  return (
    <div className="flex flex-col gap-6">
      {cree && (
        <div className="rounded-xl bg-green-fill text-green-ink px-4 py-3 text-sm font-semibold">
          ✓ Projet créé. Ajoutez maintenant ses missions ci-dessous.
        </div>
      )}
      <div className="bg-white border border-line rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
        <div className="px-7 pt-6 pb-0 flex flex-col gap-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-[280px] flex flex-col gap-1.5">
              <div className="text-[13px] text-ink-soft">
                <Link href="/responsable/projets" className="hover:text-blue">Projets</Link> <span className="text-[#9aa4b1]">/</span> {projet.reference}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-[26px] font-extrabold font-display text-[#0b2545] leading-tight">{projet.titre}</h1>
                <span className={`text-xs font-bold rounded-full px-3 py-1 ${STATUT_BADGE[projet.statut] ?? ""}`}>{ETAPE_LABEL[projet.statut]}</span>
              </div>
              <div className="text-[13.5px] text-ink-soft">
                <Link href={`/responsable/clients/${client.id}`} className="text-blue font-semibold hover:underline">{client.raisonSociale}</Link>
                {projet.typeProjet ? ` · ${TYPE_PROJET_LABEL[projet.typeProjet] ?? projet.typeProjet}` : ""}
                {projet.dateDebutPrevue || projet.dateFinPrevue ? ` · ${formatDate(projet.dateDebutPrevue)} → ${formatDate(projet.dateFinPrevue)}` : ""}
                {garantie?.formule ? ` · ${garantie.formule.nom}` : ""}
              </div>
              {projet.description && <p className="text-sm text-ink-soft">{projet.description}</p>}
            </div>
            <a
              href={`/api/rapports/pdf?type=projet&entityId=${projet.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-[#cfd8e3] bg-white px-4 py-2.5 text-[13.5px] font-semibold hover:bg-bg"
            >
              <FileDown className="w-4 h-4" /> Dossier PDF
            </a>
            <Link
              href={`/responsable/projets/${projet.id}?tab=missions#nouvelle-mission`}
              className="inline-flex items-center gap-2 rounded-xl bg-blue hover:bg-blue-light text-white px-4 py-2.5 text-[13.5px] font-bold"
            >
              <Plus className="w-4 h-4" /> Nouvelle mission
            </Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl bg-bg px-4 py-3">
              <div className="text-xs text-ink-soft flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> Missions actives</div>
              <div className="font-display text-[22px] font-extrabold tabular">
                {missionsActives.length}
                {missionsEnRetard.length > 0 && <span className="ml-2 text-xs font-bold rounded-full px-2 py-0.5 bg-red-fill text-red-ink align-middle">{missionsEnRetard.length} en retard</span>}
              </div>
            </div>
            <div className="rounded-xl bg-bg px-4 py-3">
              <div className="text-xs text-ink-soft flex items-center gap-1.5"><ArrowUpDown className="w-3.5 h-3.5" /> Appareils</div>
              <div className="font-display text-[22px] font-extrabold tabular">{appareilsAttaches.length}</div>
            </div>
            <div className="rounded-xl bg-bg px-4 py-3">
              <div className="text-xs text-ink-soft flex items-center gap-1.5"><HardHat className="w-3.5 h-3.5" /> Équipe</div>
              <div className="font-display text-[22px] font-extrabold tabular">{techniciensAffectes.length}</div>
            </div>
            <div className="rounded-xl bg-bg px-4 py-3">
              <div className="text-xs text-ink-soft flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Visites garantie</div>
              <div className="font-display text-[22px] font-extrabold tabular">
                {garantie ? `${garantie.garantie.interventionsIncluses - garantie.garantie.interventionsRestantes} / ${garantie.garantie.interventionsIncluses}` : "—"}
              </div>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto -mb-px">
            {ONGLETS.map((o) => (
              <Link
                key={o.id}
                href={ongletHref(o.id)}
                className={`px-4 py-3 text-[14px] whitespace-nowrap border-b-[3px] transition-colors ${
                  tab === o.id ? "border-blue text-navy font-bold" : "border-transparent text-ink-soft hover:text-ink font-medium"
                }`}
              >
                {o.label}
                {o.id === "missions" && missionsActives.length > 0 && (
                  <span className="ml-1.5 text-[11px] font-bold rounded-full px-1.5 py-0.5 bg-blue-pale text-blue">{missionsActives.length}</span>
                )}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {tab === "apercu" && (
        <>
      {/* Suivi ISO */}
      <Card className="p-5">
        <h2 className="font-display font-bold text-sm mb-3">Suivi ISO 9001</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {ETAPES_ISO.map((etape, i) => (
            <div key={etape} className="flex items-center gap-2">
              <Pill tone={i <= indexEtapeActuelle ? "ok" : "neutral"}>{ETAPE_LABEL[etape]}</Pill>
              {i < ETAPES_ISO.length - 1 && <span className="text-ink-soft">→</span>}
            </div>
          ))}
        </div>
        {user.role === "administrateur" ? (
          <form action={changerStatutProjetAdmin} className="mt-3 flex items-end gap-2 flex-wrap">
            <input type="hidden" name="projetId" value={projet.id} />
            <Field label="Statut (Administrateur — modifiable librement)">
              <select name="nouveauStatut" defaultValue={projet.statut} className={`${inputClass} !py-1.5 !text-xs`}>
                {ETAPES_ISO.map((etape) => (
                  <option key={etape} value={etape}>
                    {ETAPE_LABEL[etape]}
                  </option>
                ))}
              </select>
            </Field>
            <Btn variant="ghost" className="!text-xs">
              Appliquer
            </Btn>
          </form>
        ) : (
          prochaineEtape && (
            <form action={avancerStatutProjet} className="mt-3">
              <input type="hidden" name="projetId" value={projet.id} />
              <input type="hidden" name="nouveauStatut" value={prochaineEtape} />
              <Btn variant="ghost" className="!text-xs">
                Valider l&apos;étape suivante : {ETAPE_LABEL[prochaineEtape]}
              </Btn>
            </form>
          )
        )}
      </Card>

      {/* Infos Projet — adresse, accès, contact sur place (Phase 6) */}
      <Card className="p-5">
        <h2 className="font-display font-bold text-sm mb-3">Informations du projet</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <dl className="text-sm flex flex-col gap-2">
            <InfoRow label="Adresse" value={projet.adresse} />
            <InfoRow label="Instructions d'accès" value={projet.instructionsAcces} />
            <InfoRow label="Contact sur place" value={projet.contactNom} />
            <InfoRow label="Téléphone du contact" value={projet.contactTelephone} />
          </dl>
          <details>
            <summary className="text-xs font-bold uppercase tracking-wide text-blue cursor-pointer select-none">
              Modifier les infos du projet
            </summary>
            <form action={updateProjetInfos} className="flex flex-col gap-2 mt-2">
              <input type="hidden" name="projetId" value={projet.id} />
              <Field label="Adresse">
                <textarea
                  name="adresse"
                  required
                  rows={2}
                  defaultValue={projet.adresse ?? ""}
                  className={inputClass}
                />
              </Field>
              <Field label="Instructions d'accès">
                <textarea
                  name="instructionsAcces"
                  rows={2}
                  defaultValue={projet.instructionsAcces ?? ""}
                  className={inputClass}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Contact sur place — nom">
                  <input name="contactNom" defaultValue={projet.contactNom ?? ""} className={inputClass} />
                </Field>
                <Field label="Contact sur place — téléphone">
                  <input
                    name="contactTelephone"
                    defaultValue={projet.contactTelephone ?? ""}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Btn variant="ghost" className="self-start !text-xs">
                Enregistrer
              </Btn>
            </form>
          </details>
        </div>
      </Card>
        </>
      )}

      {tab === "missions" && (
        <>
          <Card className="p-5" >
            <details id="nouvelle-mission" open={interventionsListe.length === 0 || undefined}>
              <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
                <span className="font-display font-bold text-[15px] flex items-center gap-2"><Plus className="w-4 h-4" /> Nouvelle mission</span>
                <span className="text-xs text-ink-soft">Client, adresse et contact repris du projet</span>
              </summary>
              {appareilsAttaches.length === 0 ? (
                <p className="text-sm text-ink-soft mt-3">
                  Ajoutez d&apos;abord un appareil au projet (onglet <Link className="text-blue font-semibold" href={ongletHref("appareils")}>Appareils</Link>).
                </p>
              ) : (
                <form action={createIntervention} className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  <input type="hidden" name="projetId" value={projet.id} />
                  <input type="hidden" name="retour" value={`/responsable/projets/${projet.id}?tab=missions`} />
                  <Field label="Appareil">
                    <select name="appareilId" required className={inputClass}>
                      {appareilsAttaches.map((a) => (
                        <option key={a.id} value={a.id}>{a.numeroInterne}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Type de mission">
                    <select name="type" className={inputClass} defaultValue="preventive">
                      <option value="preventive">Maintenance préventive</option>
                      <option value="corrective">Dépannage / corrective</option>
                      <option value="systematique">Systématique / contrôle</option>
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
                  <Field label="Date et heure">
                    <input type="datetime-local" name="dateProgrammee" className={inputClass} />
                  </Field>
                  <Field label="Technicien">
                    <select name="technicienId" className={inputClass} defaultValue={techniciensAffectes[0]?.id ?? ""}>
                      <option value="">À affecter plus tard</option>
                      {techniciensAffectes.length > 0 && (
                        <optgroup label="Équipe du projet">
                          {techniciensAffectes.map((t) => (
                            <option key={t.id} value={t.id}>{t.nom}{t.role ? ` — ${t.role}` : ""}</option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Autres techniciens">
                        {techniciensDisponibles.map((t) => (
                          <option key={t.id} value={t.id}>{t.nom}</option>
                        ))}
                      </optgroup>
                    </select>
                  </Field>
                  <Field label="Consignes">
                    <input name="description" className={inputClass} placeholder="Ce que le technicien doit faire…" />
                  </Field>
                  <div className="md:col-span-2 xl:col-span-3 flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs text-ink-soft">Si un technicien est choisi, son ordre de mission part par email immédiatement.</span>
                    <Btn>Créer la mission</Btn>
                  </div>
                </form>
              )}
            </details>
          </Card>

      {/* Interventions & rapports (Phase 7) */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="font-display font-bold text-sm">
            Missions &amp; rapports ({interventionsListe.length})
          </h2>
<span className="text-xs text-ink-soft">Rapports, photos et checklists remontés par les techniciens</span>
        </div>
        <div className="flex flex-col divide-y divide-line">
          {interventionsListe.map((i) => {
            const photos = i.rapportId ? photosParRapport.get(i.rapportId) ?? [] : [];
            return (
              <div key={i.id} className="py-3 flex flex-col gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <TypeInterventionPill type={i.type} />
                  <div className="flex-1 min-w-0 text-sm">
                    {i.numeroInterne} · {formatDateTime(i.dateProgrammee)} · {i.technicien ?? "Non affecté"}
                  </div>
                  <StatutInterventionPill statut={i.statut} />
                </div>
                <div className="flex items-center gap-3 flex-wrap text-xs text-ink-soft">
                  <span className="flex-1 min-w-[10rem]">{truncate(i.travauxRealises, 100)}</span>
                  {i.tempsPasseMinutes != null && <span className="whitespace-nowrap">{i.tempsPasseMinutes} min</span>}
                  <a
                    href={`/api/rapports/pdf/intervention/${i.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue font-semibold hover:underline whitespace-nowrap"
                  >
                    Voir le rapport complet
                  </a>
                </div>
                {photos.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    {photos.slice(0, 3).map((p) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={p.id}
                        src={p.url}
                        alt="Photo du rapport"
                        className="w-12 h-12 rounded-lg object-cover bg-blue-pale"
                      />
                    ))}
                    {photos.length > 3 && (
                      <span className="w-12 h-12 rounded-lg bg-blue-pale flex items-center justify-center text-xs font-bold text-blue">
                        +{photos.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {interventionsListe.length === 0 && (
            <p className="text-sm text-ink-soft py-2">
              Aucune mission pour l&apos;instant — créez la première avec « Nouvelle mission » ci-dessus.
            </p>
          )}
        </div>
      </Card>
        </>
      )}

      {tab === "appareils" && (
        <>
        {/* Appareils */}
        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">
            Appareils ({appareilsAttaches.length})
          </h2>
          <div className="flex flex-col divide-y divide-line mb-3">
            {appareilsAttaches.map((a) => (
              <Link
                key={a.id}
                href={`/responsable/appareils/${a.id}`}
                className="py-2 flex items-center justify-between gap-3 hover:bg-blue-pale/40 -mx-2 px-2 rounded-lg"
              >
                <span className="text-sm">{a.numeroInterne}</span>
                <span className="text-xs text-ink-soft truncate">{a.adresse ?? "—"}</span>
              </Link>
            ))}
            {appareilsAttaches.length === 0 && (
              <p className="text-sm text-ink-soft py-2">Aucun appareil attaché.</p>
            )}
          </div>
          {appareilsDisponibles.length > 0 && (
            <form
              action={ajouterAppareilProjet}
              className="flex items-end gap-2 pt-3 border-t border-line"
            >
              <input type="hidden" name="projetId" value={projet.id} />
              <Field label="Attacher un appareil">
                <select name="appareilId" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Choisir un appareil
                  </option>
                  {appareilsDisponibles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.numeroInterne}
                      {a.adresse ? ` — ${a.adresse}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Btn variant="ghost" className="!px-3 !py-2 !text-xs">
                Attacher
              </Btn>
            </form>
          )}
        </Card>
        </>
      )}

      {tab === "equipe" && (
        <>
        {/* Techniciens */}
        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">
            Techniciens ({techniciensAffectes.length})
          </h2>
          <div className="flex flex-col divide-y divide-line mb-3">
            {techniciensAffectes.map((t) => (
              <div key={t.id} className="py-2.5 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/responsable/techniciens/${t.id}`}
                    className="text-sm font-semibold text-blue hover:underline"
                  >
                    {t.nom}
                  </Link>
                  <div className="flex items-center gap-2">
                    <Pill tone="neutral">{t.role || "Technicien"}</Pill>
                    <form action={retirerTechnicienProjet}>
                      <input type="hidden" name="projetId" value={projet.id} />
                      <input type="hidden" name="technicienId" value={t.id} />
                      <button
                        type="submit"
                        className="text-xs font-semibold text-red-ink hover:underline"
                      >
                        Retirer
                      </button>
                    </form>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <details>
                    <summary className="text-xs font-semibold text-blue cursor-pointer select-none">
                      Modifier le rôle
                    </summary>
                    <form
                      action={modifierRoleTechnicienProjet}
                      className="flex items-center gap-2 mt-1.5"
                    >
                      <input type="hidden" name="projetId" value={projet.id} />
                      <input type="hidden" name="technicienId" value={t.id} />
                      <input
                        name="role"
                        defaultValue={t.role ?? ""}
                        placeholder="Chef de mission…"
                        className={`${inputClass} !py-1 !text-xs max-w-[10rem]`}
                      />
                      <Btn variant="ghost" className="!text-xs !px-2 !py-1">
                        Modifier
                      </Btn>
                    </form>
                  </details>
                  <details>
                    <summary className="text-xs font-semibold text-blue cursor-pointer select-none">
                      Renvoyer un message
                    </summary>
                    <form
                      action={envoyerOrdreMissionAvecMessage}
                      className="flex flex-col gap-2 mt-2"
                    >
                      <input type="hidden" name="projetId" value={projet.id} />
                      <input type="hidden" name="technicienId" value={t.id} />
                      <Field label="Message / consignes">
                        <textarea name="message" rows={2} className={inputClass} />
                      </Field>
                      {documentsPourEnvoi.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                            Documents à joindre
                          </span>
                          {documentsPourEnvoi.map((d) => (
                            <label key={d.id} className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                name="documentsIds"
                                value={d.id}
                                className="rounded border-line"
                              />
                              {d.titre}
                            </label>
                          ))}
                        </div>
                      )}
                      <Btn variant="ghost" className="self-start !text-xs">
                        Envoyer
                      </Btn>
                    </form>
                  </details>
                </div>
              </div>
            ))}
            {techniciensAffectes.length === 0 && (
              <p className="text-sm text-ink-soft py-2">Aucun technicien affecté.</p>
            )}
          </div>
          {techniciensDisponibles.length > 0 && (
            <form
              action={ajouterTechnicienProjet}
              className="flex flex-col gap-2 pt-3 border-t border-line"
            >
              <input type="hidden" name="projetId" value={projet.id} />
              <div className="flex items-end gap-2 flex-wrap">
                <Field label="Affecter un technicien">
                  <select name="technicienId" required className={inputClass} defaultValue="">
                    <option value="" disabled>
                      Choisir un technicien
                    </option>
                    {techniciensDisponibles.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nom}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Rôle (optionnel)">
                  <input name="role" placeholder="Chef de mission…" className={`${inputClass} max-w-[10rem]`} />
                </Field>
              </div>
              <Field label="Message / consignes (optionnel)">
                <textarea name="message" rows={2} className={inputClass} placeholder="Consignes particulières pour cette mission..." />
              </Field>
              {documentsPourEnvoi.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                    Documents à joindre (optionnel)
                  </span>
                  {documentsPourEnvoi.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" name="documentsIds" value={d.id} className="rounded border-line" />
                      {d.titre}
                    </label>
                  ))}
                </div>
              )}
              <Btn variant="ghost" className="self-start !px-3 !py-2 !text-xs">
                Affecter &amp; envoyer l&apos;ordre de mission
              </Btn>
            </form>
          )}

          {/* Phase 7 : historique des ordres de mission envoyés */}
          <div className="mt-4 pt-3 border-t border-line">
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">
              Historique des envois
            </h3>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {historiqueEnvois.map((h) => (
                <div key={h.id} className="text-xs bg-blue-pale/40 rounded-lg px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{h.technicienNom ?? "Technicien supprimé"}</span>
                    <span className="text-ink-soft whitespace-nowrap">{formatDateTime(h.createdAt)}</span>
                  </div>
                  {h.message && <p className="text-ink-soft mt-1">{truncate(h.message, 80)}</p>}
                  <span className="text-ink-soft">
                    {(h.documentsJointIds?.length ?? 0)} document(s) joint(s)
                  </span>
                </div>
              ))}
              {historiqueEnvois.length === 0 && (
                <p className="text-xs text-ink-soft">Aucun envoi pour l&apos;instant.</p>
              )}
            </div>
          </div>
        </Card>
        </>
      )}

      {tab === "garantie" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Prestations */}
        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">
            Prestations ({prestationsListe.length})
          </h2>
          <div className="flex flex-col divide-y divide-line mb-3">
            {prestationsListe.map(({ prestation: p, catalogueNom, catalogueCategorie }) => (
              <div key={p.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Pill tone="neutral">
                    {catalogueCategorie
                      ? CATEGORIE_PRESTATION_LABEL[catalogueCategorie] ?? catalogueCategorie
                      : p.type
                        ? PRESTATION_TYPE_LABEL[p.type] ?? p.type
                        : "—"}
                  </Pill>
                  <span className="text-sm ml-2 font-medium">{catalogueNom ?? ""}</span>
                  {p.description && (
                    <span className="text-sm ml-2 text-ink-soft">{p.description}</span>
                  )}
                </div>
                {p.prixEstime && <span className="text-xs text-ink-soft whitespace-nowrap">{p.prixEstime} €</span>}
              </div>
            ))}
            {prestationsListe.length === 0 && (
              <p className="text-sm text-ink-soft py-2">Aucune prestation pour l&apos;instant.</p>
            )}
          </div>
          {catalogueOptions.length > 0 ? (
            <form action={createPrestation} className="flex flex-col gap-2 pt-3 border-t border-line">
              <input type="hidden" name="projetId" value={projet.id} />
              <Field label="Prestation (catalogue)">
                <select name="catalogueId" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Choisir une prestation du catalogue
                  </option>
                  {catalogueOptions.map((c) => (
                    <option key={c.id} value={c.id} data-prix={c.prixIndicatif ?? ""}>
                      {CATEGORIE_PRESTATION_LABEL[c.categorie] ?? c.categorie} — {c.nom}
                      {c.prixIndicatif ? ` (${c.prixIndicatif} €)` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Prix estimé (€)">
                <input name="prixEstime" type="number" step="0.01" className={inputClass} />
              </Field>
              <Field label="Description (optionnel)">
                <input name="description" className={inputClass} placeholder="Détail complémentaire..." />
              </Field>
              <Field label="Pièce (obligatoire si « Vente de pièce »)">
                <select name="pieceId" className={inputClass} defaultValue="">
                  <option value="">—</option>
                  {piecesOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.reference} — {p.nom} ({p.quantiteStock} {p.unite} en stock)
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Quantité (obligatoire si « Vente de pièce »)">
                <input name="quantitePieces" type="number" min={1} className={inputClass} />
              </Field>
              <Btn variant="ghost" className="self-start !text-xs">
                Ajouter la prestation
              </Btn>
              {/* Pré-remplit le prix estimé avec le prix indicatif du catalogue —
                  reste modifiable manuellement ensuite (même technique que
                  /responsable/rapports pour rester en Server Component). */}
              <script
                dangerouslySetInnerHTML={{
                  __html: `
                    document.currentScript.closest('form').querySelector('[name="catalogueId"]').addEventListener('change', function (e) {
                      var opt = e.target.selectedOptions[0];
                      var prix = opt ? opt.getAttribute('data-prix') : '';
                      var prixInput = e.target.closest('form').querySelector('[name="prixEstime"]');
                      if (prix) prixInput.value = prix;
                    });
                  `,
                }}
              />
            </form>
          ) : (
            <p className="text-sm text-ink-soft pt-3 border-t border-line">
              Aucune prestation active dans le catalogue —{" "}
              <Link href="/responsable/prestations-catalogue" className="text-blue font-semibold">
                créez-en une
              </Link>
              .
            </p>
          )}
        </Card>

        {/* Garantie */}
        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Garantie</h2>
          {garantie ? (
            <div className="flex flex-col gap-2 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <InfoRow label="Formule" value={garantie.formule?.nom} />
                <InfoRow
                  label="Durée"
                  value={garantie.formule ? `${garantie.formule.dureeMois} mois` : undefined}
                />
                <InfoRow
                  label="Interventions restantes"
                  value={`${garantie.garantie.interventionsRestantes} / ${garantie.garantie.interventionsIncluses}`}
                />
                <InfoRow label="Échéance" value={formatDate(garantie.garantie.dateFin)} />
                <InfoRow
                  label="Prix"
                  value={garantie.formule ? `${garantie.formule.prix} €` : undefined}
                />
                <InfoRow
                  label="Extension"
                  value={garantie.garantie.extensionActivee ? "Activée" : "Non activée"}
                />
              </div>
              {!garantie.garantie.extensionActivee && garantie.formule?.optionExtensionDisponible === 1 && (
                <form action={activerExtensionGarantie} className="mt-2">
                  <input type="hidden" name="projetId" value={projet.id} />
                  <input type="hidden" name="garantieId" value={garantie.garantie.id} />
                  <Btn variant="ghost" className="!text-xs">
                    Activer l&apos;extension
                    {garantie.formule?.prixExtension ? ` (${garantie.formule.prixExtension} €)` : ""}
                  </Btn>
                </form>
              )}
            </div>
          ) : formulesOptions.length > 0 ? (
            <form action={choisirGarantieProjet} className="flex items-end gap-2 flex-wrap">
              <input type="hidden" name="projetId" value={projet.id} />
              <Field label="Choisir une formule">
                <select name="formuleId" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Choisir une formule
                  </option>
                  {formulesOptions.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nom} — {f.dureeMois} mois / {f.nombreInterventionsInclues} interv. / {f.prix} €
                    </option>
                  ))}
                </select>
              </Field>
              <Btn variant="ghost" className="!px-3 !py-2 !text-xs">
                Attribuer la garantie
              </Btn>
            </form>
          ) : (
            <p className="text-sm text-ink-soft">
              Aucune formule active —{" "}
              <Link href="/responsable/garanties" className="text-blue font-semibold">
                créez-en une
              </Link>
              .
            </p>
          )}
        </Card>
        </div>
      )}

      {tab === "documents" && (
        <>
      {/* Documentation (Phase 6) */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="font-display font-bold text-sm">
            Documentation ({documentsProjetAffiches.length}
            {documentsProjetAffiches.length !== documentsProjet.length ? ` / ${documentsProjet.length}` : ""})
          </h2>
          <Link
            href={`/responsable/projets/${projet.id}${buildDocQuery(docCategorieValide, docTriValide === "asc" ? "desc" : "asc")}`}
            className="text-xs font-bold text-blue hover:underline whitespace-nowrap"
          >
            Trier : {docTriValide === "asc" ? "Plus anciens d'abord" : "Plus récents d'abord"}
          </Link>
        </div>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Link
            href={`/responsable/projets/${projet.id}${buildDocQuery(undefined, docTriValide)}`}
            className={`text-xs font-bold px-3 py-1.5 rounded-full ${
              !docCategorieValide ? "bg-blue text-white" : "bg-blue-pale text-blue"
            }`}
          >
            Toutes
          </Link>
          {CATEGORIES_DOC.map((c) => (
            <Link
              key={c}
              href={`/responsable/projets/${projet.id}${buildDocQuery(c, docTriValide)}`}
              className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                docCategorieValide === c ? "bg-blue text-white" : "bg-blue-pale text-blue"
              }`}
            >
              {CATEGORIE_DOC_LABEL[c]}
            </Link>
          ))}
        </div>

        <div className="flex flex-col divide-y divide-line">
          {documentsProjetAffiches.map((d) => {
            const visuel = getDocVisual(d);
            return (
              <div key={d.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {visuel.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={visuel.url}
                      alt=""
                      className="w-9 h-9 rounded-lg object-cover bg-blue-pale shrink-0"
                    />
                  ) : (
                    <span className="w-9 h-9 rounded-lg bg-blue-pale flex items-center justify-center text-lg shrink-0">
                      {visuel.emoji}
                    </span>
                  )}
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
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-ink-soft whitespace-nowrap">{formatDate(d.createdAt)}</span>
                  <form action={supprimerDocument}>
                    <input type="hidden" name="documentId" value={d.id} />
                    <input type="hidden" name="projetId" value={projet.id} />
                    <button type="submit" className="text-xs font-semibold text-red-ink hover:underline">
                      Supprimer
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
          {documentsProjetAffiches.length === 0 && (
            <p className="text-sm text-ink-soft py-2">
              {documentsProjet.length === 0
                ? "Aucun document rattaché à ce projet pour l'instant."
                : "Aucun document dans cette catégorie."}
            </p>
          )}
        </div>

        <details className="mt-4 pt-3 border-t border-line">
          <summary className="text-xs font-bold uppercase tracking-wide text-blue cursor-pointer select-none">
            Ajouter un document
          </summary>
          <form
            action={createDocument}
            encType="multipart/form-data"
            className="flex flex-col gap-2 mt-2 max-w-md"
          >
            <input type="hidden" name="projetId" value={projet.id} />
            <input type="hidden" name="redirectTo" value={`/responsable/projets/${projet.id}`} />
            <Field label="Titre">
              <input name="titre" required className={inputClass} placeholder="Notice ascenseur X..." />
            </Field>
            <Field label="Catégorie">
              <select name="categorie" className={inputClass} defaultValue="maintenance">
                {CATEGORIES_DOC.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIE_DOC_LABEL[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type de contenu">
              <select name="typeContenu" className={inputClass} defaultValue="document">
                <option value="document">Document (PDF / notice)</option>
                <option value="video">Vidéo</option>
              </select>
            </Field>
            <p className="text-xs text-ink-soft -mt-1">
              Soit un lien externe, soit un fichier uploadé — au choix (un seul suffit).
            </p>
            <Field label="URL du fichier / de la vidéo (lien externe)">
              <input name="urlFichier" className={inputClass} placeholder="https://..." />
            </Field>
            <FileField
              label="Ou déposer un fichier (PDF / MP4 / MOV / WEBM / AVI, 200 Mo max)"
              name="fichier"
              accept={Object.keys(FICHIER_TYPES).join(",")}
              maxBytes={FICHIER_MAX_BYTES}
            />
            <Btn variant="ghost" className="self-start !text-xs">
              Ajouter
            </Btn>
          </form>
        </details>
      </Card>
        </>
      )}

      {tab === "historique" && (
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Historique du projet</h2>
            {journalProjet.length === 0 ? (
              <p className="text-sm text-ink-soft">Aucun événement enregistré pour ce projet.</p>
            ) : (
              <ol className="flex flex-col">
                {journalProjet.map((j) => (
                  <li key={j.id} className="flex gap-4 py-2.5 border-b border-line last:border-0 text-sm">
                    <span className="w-36 shrink-0 text-ink-soft tabular">{formatDateTime(j.createdAt)}</span>
                    <span className="flex-1">
                      <span className="font-semibold">{j.action.replaceAll("_", " ")}</span>
                      {j.details ? <span className="text-ink-soft"> — {j.details}</span> : null}
                    </span>
                    <span className="text-ink-soft">{j.auteur ?? "—"}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}
