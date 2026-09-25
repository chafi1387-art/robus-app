import { Card, Btn, Field, inputClass } from "@/components/ui";
import { FileField } from "@/components/file-field";
import { HabilitationsList } from "@/components/habilitations-list";
import { db } from "@/db";
import {
  appareils,
  clients,
  documentsFormations,
  formationsConsultations,
  habilitationsTechnicien,
  heuresSousTraitance,
  interventions,
  journalActivite,
  projets,
  projetTechniciens,
  technicienDocuments,
  technicienFiches,
  users,
} from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMinutes, libelleMois } from "@/lib/sous-traitance";
import { Mail, Phone, Pencil } from "lucide-react";
import { StatutInterventionPill } from "@/components/ui";
import { updateTechnicienFiche, uploadTechnicienDocument, uploadTechnicienPhoto } from "../actions";
import { getSitesForSelect } from "../../actions";

const STATUT_RH_LABEL: Record<string, string> = {
  actif: "Actif",
  en_conge: "En congé",
  arret_maladie: "Arrêt maladie",
  en_formation: "En formation",
  suspendu: "Suspendu",
  sorti_effectifs: "Sorti des effectifs",
};

const CATEGORIE_LABEL: Record<string, string> = {
  securite: "Sécurité",
  installation: "Installation",
  maintenance: "Maintenance",
  depannage: "Dépannage",
  marques: "Marques",
  procedures_robus: "Procédures Robus",
  videos: "Vidéos",
  fournisseur_iso: "Fournisseur / ISO 9001",
};

const ONGLETS = [
  { id: "apercu", label: "Aperçu" },
  { id: "missions", label: "Projets & missions" },
  { id: "habilitations", label: "Habilitations & formations" },
  { id: "documents", label: "Documents RH" },
  { id: "heures", label: "Heures sous-traitance" },
  { id: "historique", label: "Historique" },
  { id: "modifier", label: "Modifier le profil" },
] as const;

const FINIS = ["terminee", "validee", "cloturee"];

function anciennete(entree: Date | null | undefined, sortie: Date | null | undefined) {
  if (!entree) return null;
  const fin = sortie ?? new Date();
  const mois = Math.max(0, (fin.getFullYear() - entree.getFullYear()) * 12 + fin.getMonth() - entree.getMonth());
  const a = Math.floor(mois / 12);
  const m = mois % 12;
  const txt = a > 0 ? `${a} an${a > 1 ? "s" : ""}${m ? ` ${m} mois` : ""}` : `${m} mois`;
  return sortie ? `Présent ${entree.getFullYear()} → ${sortie.getFullYear()} (${txt})` : `${txt} chez ROBUS`;
}

export default async function TechnicienDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireUser(ROLES_BUREAU);
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = (ONGLETS.map((o) => o.id) as string[]).includes(tabParam ?? "") ? (tabParam as string) : "apercu";

  const [userRow] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!userRow || userRow.role !== "technicien") notFound();

  const [fiche] = await db.select().from(technicienFiches).where(eq(technicienFiches.technicienId, id)).limit(1);
  const ancien = fiche?.statutRh === "sorti_effectifs";
  const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [habilitations, documents, projetsAffectes, sitesOptions, missions, heuresMois, [stats], consultations, journal] = await Promise.all([
    db
      .select({
        id: habilitationsTechnicien.id,
        titre: documentsFormations.titre,
        categorie: documentsFormations.categorie,
        dateObtention: habilitationsTechnicien.dateObtention,
        dateExpiration: habilitationsTechnicien.dateExpiration,
      })
      .from(habilitationsTechnicien)
      .innerJoin(documentsFormations, eq(habilitationsTechnicien.documentId, documentsFormations.id))
      .where(eq(habilitationsTechnicien.technicienId, id))
      .orderBy(desc(habilitationsTechnicien.dateObtention)),
    db.select().from(technicienDocuments).where(eq(technicienDocuments.technicienId, id)).orderBy(desc(technicienDocuments.createdAt)),
    db
      .select({ id: projets.id, reference: projets.reference, titre: projets.titre, statut: projets.statut, clientNom: clients.raisonSociale, role: projetTechniciens.role })
      .from(projetTechniciens)
      .innerJoin(projets, eq(projetTechniciens.projetId, projets.id))
      .innerJoin(clients, eq(projets.clientId, clients.id))
      .where(eq(projetTechniciens.technicienId, id))
      .orderBy(desc(projets.createdAt)),
    getSitesForSelect(),
    db
      .select({
        id: interventions.id,
        statut: interventions.statut,
        type: interventions.type,
        dateProgrammee: interventions.dateProgrammee,
        appareil: appareils.numeroInterne,
        projetId: projets.id,
        projetRef: projets.reference,
        projetTitre: projets.titre,
      })
      .from(interventions)
      .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
      .leftJoin(projets, eq(interventions.projetId, projets.id))
      .where(eq(interventions.technicienId, id))
      .orderBy(desc(interventions.dateProgrammee))
      .limit(tab === "missions" ? 300 : 8),
    db
      .select({
        mois: sql<string>`to_char(${heuresSousTraitance.dateTravail}, 'YYYY-MM')`,
        client: clients.raisonSociale,
        minutes: sql<number>`sum(${heuresSousTraitance.minutes})::int`,
      })
      .from(heuresSousTraitance)
      .innerJoin(clients, eq(heuresSousTraitance.clientId, clients.id))
      .where(eq(heuresSousTraitance.technicienId, id))
      .groupBy(sql`1`, clients.raisonSociale)
      .orderBy(desc(sql`1`)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        terminees: sql<number>`count(*) filter (where ${interventions.statut} in ('terminee','validee','cloturee'))::int`,
        actives: sql<number>`count(*) filter (where ${interventions.statut} not in ('terminee','validee','cloturee'))::int`,
        retard: sql<number>`count(*) filter (where ${interventions.statut} not in ('terminee','validee','cloturee') and ${interventions.dateProgrammee} < now())::int`,
        ceMois: sql<number>`count(*) filter (where ${interventions.dateProgrammee} >= ${debutMois.toISOString()}::timestamp)::int`,
      })
      .from(interventions)
      .where(eq(interventions.technicienId, id)),
    db
      .select({ titre: documentsFormations.titre, date: formationsConsultations.dateConsultation })
      .from(formationsConsultations)
      .innerJoin(documentsFormations, eq(formationsConsultations.documentId, documentsFormations.id))
      .where(eq(formationsConsultations.technicienId, id))
      .orderBy(desc(formationsConsultations.dateConsultation))
      .limit(30),
    tab === "historique" || tab === "apercu"
      ? db
          .select({ id: journalActivite.id, entite: journalActivite.entite, action: journalActivite.action, details: journalActivite.details, createdAt: journalActivite.createdAt, auteur: users.nom })
          .from(journalActivite)
          .leftJoin(users, eq(journalActivite.utilisateurId, users.id))
          .where(sql`${journalActivite.entiteId} = ${id} or ${journalActivite.utilisateurId} = ${id}`)
          .orderBy(desc(journalActivite.createdAt))
          .limit(tab === "historique" ? 300 : 6)
      : Promise.resolve([]),
  ]);

  const siteRattache = fiche?.siteRattachementId ? sitesOptions.find((s) => s.id === fiche.siteRattachementId) : undefined;
  const habValides = habilitations.filter((h) => !h.dateExpiration || h.dateExpiration.getTime() > Date.now());
  const habBientot = habValides.filter((h) => h.dateExpiration && h.dateExpiration.getTime() < Date.now() + 30 * 86400000);
  const totalHeures = heuresMois.reduce((s, h) => s + h.minutes, 0);
  const initiales = userRow.nom.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const specialites = (fiche?.specialites ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const kpis: [string, string][] = ancien
    ? [
        ["Projets réalisés", String(projetsAffectes.length)],
        ["Missions réalisées", String(stats?.terminees ?? 0)],
        ["Missions au total", String(stats?.total ?? 0)],
        ["Heures sous-traitance", formatMinutes(totalHeures)],
        ["Habilitations", `${habilitations.length} archivée(s)`],
      ]
    : [
        ["Projets", String(projetsAffectes.filter((p) => p.statut !== "termine" && p.statut !== "valide_iso").length)],
        ["Missions ce mois", String(stats?.ceMois ?? 0)],
        ["En retard", String(stats?.retard ?? 0)],
        ["Heures sous-traitance", formatMinutes(totalHeures)],
        ["Habilitations valides", String(habValides.length)],
      ];
  const href = (o: string) => `/responsable/techniciens/${id}?tab=${o}`;
  const statut = fiche?.statutRh ?? "actif";

  return (
    <div className="flex flex-col gap-6">
      <div className="text-[13px] text-ink-soft">
        <Link href={ancien ? "/responsable/techniciens?vue=anciens" : "/responsable/techniciens"} className="hover:text-blue">Équipe technique</Link>{" "}
        <span className="text-[#9aa4b1]">/</span> <span className="text-ink font-semibold">{userRow.nom}</span>
      </div>
      <div className="rounded-2xl bg-navy text-white overflow-hidden shadow-sm">
        <div className="px-7 pt-7 flex flex-col gap-5">
          <div className="flex items-center gap-5 flex-wrap">
            {fiche?.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fiche.photoUrl} alt={userRow.nom} className={`w-[84px] h-[84px] rounded-[22px] object-cover bg-white ${ancien ? "grayscale" : ""}`} />
            ) : (
              <div className="w-[84px] h-[84px] rounded-[22px] bg-white text-navy flex items-center justify-center font-display font-extrabold text-[28px]">{initiales}</div>
            )}
            <div className="flex-1 min-w-[240px] flex flex-col gap-1.5">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-[26px] font-extrabold font-display leading-tight">{userRow.nom}</h1>
                <span className={`text-xs font-bold rounded-full px-3 py-1 ${statut === "actif" ? "bg-green-fill text-green-ink" : ancien ? "bg-white/20 text-white" : "bg-orange-fill text-orange-ink"}`}>
                  {STATUT_RH_LABEL[statut] ?? statut}
                </span>
                {userRow.actif !== 1 && <span className="text-xs font-semibold rounded-full px-3 py-1 bg-white/10 text-[#cfe3f5]">Connexion désactivée</span>}
              </div>
              <div className="text-sm text-[#cfe3f5]">
                {[fiche?.poste || "Technicien", anciennete(fiche?.dateEntreeEntreprise, ancien ? fiche?.dateSortie : null), siteRattache ? `Rattaché : ${siteRattache.raisonSociale}` : null].filter(Boolean).join(" · ")}
              </div>
              {specialites.length > 0 && (
                <div className="flex gap-2 flex-wrap mt-1">
                  {specialites.map((s) => (
                    <span key={s} className="text-xs font-semibold rounded-full px-2.5 py-1 bg-white/15">{s}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {userRow.telephone && (
                <a href={`tel:${userRow.telephone}`} className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2.5 text-[13px] font-semibold hover:bg-white/20">
                  <Phone className="w-4 h-4" /> Appeler
                </a>
              )}
              <a href={`mailto:${userRow.email}`} className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2.5 text-[13px] font-semibold hover:bg-white/20">
                <Mail className="w-4 h-4" /> Email
              </a>
              <Link href={href("modifier")} className="inline-flex items-center gap-2 rounded-xl bg-white text-navy px-4 py-2.5 text-[13px] font-bold">
                <Pencil className="w-4 h-4" /> Modifier
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
            {kpis.map(([l, v]) => (
              <div key={l} className="rounded-xl bg-white/10 px-4 py-3">
                <div className="text-[11.5px] text-[#cfe3f5]">{l}</div>
                <div className="font-display text-[22px] font-extrabold tabular">{v}</div>
              </div>
            ))}
          </div>
          <nav className="flex gap-1 overflow-x-auto">
            {ONGLETS.map((o) => (
              <Link
                key={o.id}
                href={href(o.id)}
                className={`px-4 py-3 rounded-t-xl text-[13.5px] whitespace-nowrap ${tab === o.id ? "bg-bg text-navy font-bold" : "text-[#cfe3f5] hover:text-white font-medium"}`}
              >
                {o.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {tab === "apercu" && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-5 flex flex-col gap-2.5 text-[13.5px]">
              <h2 className="font-display font-bold text-[15px]">Coordonnées</h2>
              <Ligne k="Téléphone" v={userRow.telephone} />
              <Ligne k="Email" v={userRow.email} />
              <Ligne k="Urgence" v={[fiche?.contactUrgenceNom, fiche?.contactUrgenceTelephone].filter(Boolean).join(" · ")} />
              <Ligne k="Véhicule" v={fiche?.vehicule} />
              <Ligne k="Domicile" v={fiche?.adresseDomicile} />
            </Card>
            <Card className="p-5 flex flex-col gap-2.5 text-[13.5px]">
              <h2 className="font-display font-bold text-[15px]">Contrat</h2>
              <Ligne k="Type" v={fiche?.typeContrat} />
              <Ligne k="Entrée" v={fiche?.dateEntreeEntreprise ? formatDate(fiche.dateEntreeEntreprise) : null} />
              <Ligne k="Sortie" v={fiche?.dateSortie ? formatDate(fiche.dateSortie) : null} />
              <Ligne k="Motif" v={fiche?.motifSortie} />
              <Ligne k="Naissance" v={fiche?.dateNaissance ? formatDate(fiche.dateNaissance) : null} />
            </Card>
            <Card className="p-5 flex flex-col gap-2.5 text-[13.5px]">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-bold text-[15px]">Habilitations</h2>
                <Link href={href("habilitations")} className="text-xs font-semibold text-blue">Tout voir</Link>
              </div>
              {habilitations.length === 0 && <p className="text-ink-soft">Aucune habilitation.</p>}
              {habilitations.slice(0, 5).map((h) => {
                const expiree = h.dateExpiration && h.dateExpiration.getTime() < Date.now();
                const bientot = habBientot.some((b) => b.id === h.id);
                return (
                  <div key={h.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">{h.titre}</span>
                    <span className={`shrink-0 text-[11.5px] font-bold rounded-full px-2 py-0.5 ${expiree ? "bg-red-fill text-red-ink" : bientot ? "bg-orange-fill text-orange-ink" : "bg-green-fill text-green-ink"}`}>
                      {expiree ? "Expirée" : bientot ? `Expire le ${formatDate(h.dateExpiration)}` : "Valide"}
                    </span>
                  </div>
                );
              })}
            </Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-display font-bold text-[15px]">Dernières missions</h2>
                <Link href={href("missions")} className="text-xs font-semibold text-blue">Tout voir</Link>
              </div>
              <ListeMissions missions={missions.slice(0, 6)} />
            </Card>
            <Card className="p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-display font-bold text-[15px]">Activité récente</h2>
                <Link href={href("historique")} className="text-xs font-semibold text-blue">Historique complet</Link>
              </div>
              <ListeJournal lignes={journal} />
            </Card>
          </div>
        </>
      )}

      {tab === "missions" && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
          <Card className="p-5">
            <h2 className="font-display font-bold text-[15px] mb-2">Missions ({stats?.total ?? 0})</h2>
            <ListeMissions missions={missions} />
          </Card>
          <Card className="p-5">
            <h2 className="font-display font-bold text-[15px] mb-2">Projets ({projetsAffectes.length})</h2>
            <div className="flex flex-col divide-y divide-line">
              {projetsAffectes.map((p) => (
                <Link key={p.id} href={`/responsable/projets/${p.id}`} className="py-2.5 flex items-center justify-between gap-3 hover:text-blue">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{p.titre}</div>
                    <div className="text-xs text-ink-soft truncate">{p.reference} · {p.clientNom}</div>
                  </div>
                  <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-blue-pale text-blue shrink-0">{p.role || "Technicien"}</span>
                </Link>
              ))}
              {projetsAffectes.length === 0 && <p className="text-sm text-ink-soft py-2">Aucun projet.</p>}
            </div>
          </Card>
        </div>
      )}

      {tab === "habilitations" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <Card className="p-5">
            <h2 className="font-display font-bold text-[15px] mb-3">Habilitations ({habilitations.length})</h2>
            <HabilitationsList
              habilitations={habilitations.map((h) => ({
                id: h.id,
                titre: h.titre,
                subtitle: CATEGORIE_LABEL[h.categorie] ?? h.categorie,
                dateObtention: h.dateObtention,
                dateExpiration: h.dateExpiration,
              }))}
            />
          </Card>
          <Card className="p-5">
            <h2 className="font-display font-bold text-[15px] mb-3">Formations consultées</h2>
            <div className="flex flex-col divide-y divide-line">
              {consultations.map((c, i) => (
                <div key={i} className="py-2 flex justify-between gap-3 text-sm">
                  <span className="truncate">{c.titre}</span>
                  <span className="text-ink-soft text-xs whitespace-nowrap">{formatDateTime(c.date)}</span>
                </div>
              ))}
              {consultations.length === 0 && <p className="text-sm text-ink-soft py-2">Aucune consultation.</p>}
            </div>
          </Card>
        </div>
      )}

      {tab === "documents" && (
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">
              Dossier documents ({documents.length})
            </h2>
            <div className="flex flex-col divide-y divide-line mb-3">
              {documents.map((d) => (
                <a
                  key={d.id}
                  href={d.urlFichier}
                  target="_blank"
                  rel="noreferrer"
                  className="py-2.5 flex items-center justify-between gap-3 hover:bg-blue-pale/40 -mx-2 px-2 rounded-lg"
                >
                  <div className="text-sm truncate">{d.titre}</div>
                  <div className="text-xs text-ink-soft whitespace-nowrap">
                    {formatDate(d.createdAt)}
                  </div>
                </a>
              ))}
              {documents.length === 0 && (
                <p className="text-sm text-ink-soft py-2">Aucun document pour l&apos;instant.</p>
              )}
            </div>
            <form
              action={uploadTechnicienDocument}
              className="flex flex-wrap items-end gap-2 pt-3 border-t border-line"
              encType="multipart/form-data"
            >
              <input type="hidden" name="technicienId" value={userRow.id} />
              <Field label="Titre du document">
                <input name="titre" required className={`${inputClass} max-w-xs`} />
              </Field>
              <FileField
                label="Fichier (PDF / JPEG / PNG, 8 Mo max)"
                name="fichier"
                accept="application/pdf,image/jpeg,image/png"
                maxBytes={8 * 1024 * 1024}
                required
              />
              <Btn variant="ghost" className="!px-3 !py-2 !text-xs">
                Ajouter au dossier
              </Btn>
            </form>
          </Card>
      )}

      {tab === "heures" && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-[15px]">Heures de sous-traitance</h2>
            <span className="text-sm">Total : <span className="font-display font-extrabold tabular">{formatMinutes(totalHeures)}</span></span>
          </div>
          {heuresMois.length === 0 ? (
            <p className="text-sm text-ink-soft">Aucune heure déclarée.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="py-2">Mois</th>
                  <th className="py-2">Client</th>
                  <th className="py-2 text-right">Durée</th>
                </tr>
              </thead>
              <tbody>
                {heuresMois.map((h, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2">{libelleMois(h.mois)}</td>
                    <td className="py-2">{h.client}</td>
                    <td className="py-2 text-right font-semibold tabular">{formatMinutes(h.minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "historique" && (
        <Card className="p-5">
          <h2 className="font-display font-bold text-[15px] mb-2">Historique</h2>
          <ListeJournal lignes={journal} />
        </Card>
      )}

      {tab === "modifier" && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-1">Modifier le profil</h2>
            <p className="text-xs text-ink-soft mb-3">Passer le statut à « Sorti des effectifs » archive le technicien dans « Anciens » et désactive sa connexion — son historique reste consultable.</p>
            <form action={updateTechnicienFiche} className="flex flex-col gap-3">
              <input type="hidden" name="technicienId" value={userRow.id} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Email">
                  <input
                    type="email"
                    name="email"
                    required
                    defaultValue={userRow.email}
                    className={inputClass}
                  />
                </Field>
                <Field label="Téléphone">
                  <input name="telephone" defaultValue={userRow.telephone ?? ""} className={inputClass} />
                </Field>
                <Field label="Date de naissance">
                  <input
                    type="date"
                    name="dateNaissance"
                    defaultValue={
                      fiche?.dateNaissance
                        ? new Date(fiche.dateNaissance).toISOString().slice(0, 10)
                        : ""
                    }
                    className={inputClass}
                  />
                </Field>
                <Field label="Contact d'urgence — nom">
                  <input
                    name="contactUrgenceNom"
                    defaultValue={fiche?.contactUrgenceNom ?? ""}
                    className={inputClass}
                  />
                </Field>
                <Field label="Contact d'urgence — téléphone">
                  <input
                    name="contactUrgenceTelephone"
                    defaultValue={fiche?.contactUrgenceTelephone ?? ""}
                    className={inputClass}
                  />
                </Field>
                <Field label="Site de rattachement">
                  <select
                    name="siteRattachementId"
                    className={inputClass}
                    defaultValue={fiche?.siteRattachementId ?? ""}
                  >
                    <option value="">Aucun</option>
                    {sitesOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.raisonSociale} — {s.adresse}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Date d'entrée dans l'entreprise">
                  <input
                    type="date"
                    name="dateEntreeEntreprise"
                    defaultValue={
                      fiche?.dateEntreeEntreprise
                        ? new Date(fiche.dateEntreeEntreprise).toISOString().slice(0, 10)
                        : ""
                    }
                    className={inputClass}
                  />
                </Field>
                <Field label="Type de contrat">
                  <input
                    name="typeContrat"
                    defaultValue={fiche?.typeContrat ?? ""}
                    placeholder="CDI, CDD, intérimaire..."
                    className={inputClass}
                  />
                </Field>
                <Field label="Statut RH">
                  <select
                    name="statutRh"
                    className={inputClass}
                    defaultValue={fiche?.statutRh ?? "actif"}
                  >
                    {Object.entries(STATUT_RH_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Poste">
                  <input name="poste" defaultValue={fiche?.poste ?? ""} placeholder="Technicien confirmé, chef d'équipe…" className={inputClass} />
                </Field>
                <Field label="Véhicule attribué">
                  <input name="vehicule" defaultValue={fiche?.vehicule ?? ""} placeholder="Immatriculation / modèle" className={inputClass} />
                </Field>
                <Field label="Date de sortie (si sorti des effectifs)">
                  <input
                    type="date"
                    name="dateSortie"
                    defaultValue={fiche?.dateSortie ? new Date(fiche.dateSortie).toISOString().slice(0, 10) : ""}
                    className={inputClass}
                  />
                </Field>
                <Field label="Motif de sortie">
                  <input name="motifSortie" defaultValue={fiche?.motifSortie ?? ""} placeholder="Démission, fin de contrat, retraite…" className={inputClass} />
                </Field>
              </div>
              <Field label="Spécialités / marques maîtrisées (séparées par des virgules)">
                <input name="specialites" defaultValue={fiche?.specialites ?? ""} placeholder="Schindler, Kone, hydraulique…" className={inputClass} />
              </Field>
              <Field label="Adresse du domicile">
                <textarea
                  name="adresseDomicile"
                  rows={2}
                  defaultValue={fiche?.adresseDomicile ?? ""}
                  className={inputClass}
                />
              </Field>
              <Btn>Enregistrer les modifications</Btn>
            </form>
          </Card>
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Photo</h2>
            <form
              action={uploadTechnicienPhoto}
              className="flex flex-col gap-3"
              encType="multipart/form-data"
            >
              <input type="hidden" name="technicienId" value={userRow.id} />
              <FileField
                label="Choisir une photo (JPEG / PNG / WEBP, 8 Mo max)"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                maxBytes={8 * 1024 * 1024}
                required
              />
              <Btn variant="ghost" className="self-start">
                {fiche?.photoUrl ? "Remplacer la photo" : "Ajouter la photo"}
              </Btn>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

function Ligne({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-soft shrink-0">{k}</span>
      <span className="text-right truncate">{v || "—"}</span>
    </div>
  );
}

function ListeMissions({
  missions,
}: {
  missions: { id: string; statut: string; dateProgrammee: Date | null; appareil: string; projetId: string | null; projetRef: string | null; projetTitre: string | null }[];
}) {
  if (missions.length === 0) return <p className="text-sm text-ink-soft py-2">Aucune mission.</p>;
  return (
    <div className="flex flex-col divide-y divide-line">
      {missions.map((m) => {
        const retard = m.dateProgrammee && m.dateProgrammee.getTime() < Date.now() && !FINIS.includes(m.statut);
        return (
          <div key={m.id} className="py-2.5 flex items-center gap-3 text-sm">
            <span className={`w-32 shrink-0 tabular ${retard ? "text-red-ink font-semibold" : "text-ink-soft"}`}>{formatDateTime(m.dateProgrammee)}</span>
            <span className="flex-1 min-w-0 truncate">
              {m.projetId ? (
                <Link href={`/responsable/projets/${m.projetId}?tab=missions`} className="font-semibold hover:text-blue">
                  {m.projetRef}
                </Link>
              ) : (
                <span className="text-ink-soft">Sans projet</span>
              )}{" "}
              <span className="text-ink-soft">· {m.appareil}{m.projetTitre ? ` · ${m.projetTitre}` : ""}</span>
            </span>
            <StatutInterventionPill statut={m.statut} />
          </div>
        );
      })}
    </div>
  );
}

function ListeJournal({ lignes }: { lignes: { id: string; action: string; details: string | null; createdAt: Date; auteur: string | null; entite: string }[] }) {
  if (lignes.length === 0) return <p className="text-sm text-ink-soft py-2">Aucun événement.</p>;
  return (
    <ol className="flex flex-col">
      {lignes.map((j) => (
        <li key={j.id} className="flex gap-4 py-2 border-b border-line last:border-0 text-sm">
          <span className="w-32 shrink-0 text-ink-soft tabular">{formatDateTime(j.createdAt)}</span>
          <span className="flex-1 min-w-0">
            <span className="font-semibold">{j.action.replaceAll("_", " ")}</span>
            <span className="text-ink-soft"> · {j.entite.replaceAll("_", " ")}{j.details ? ` — ${j.details}` : ""}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
