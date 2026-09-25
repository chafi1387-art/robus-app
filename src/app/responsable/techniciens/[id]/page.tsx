import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { FileField } from "@/components/file-field";
import { HabilitationsList } from "@/components/habilitations-list";
import { db } from "@/db";
import {
  documentsFormations,
  habilitationsTechnicien,
  projets,
  projetTechniciens,
  sites,
  clients,
  technicienDocuments,
  technicienFiches,
  users,
} from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import {
  updateTechnicienFiche,
  uploadTechnicienDocument,
  uploadTechnicienPhoto,
} from "../actions";
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

export default async function TechnicienDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser(ROLES_BUREAU);
  const { id } = await params;

  const [userRow] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!userRow || userRow.role !== "technicien") notFound();

  const [fiche] = await db
    .select()
    .from(technicienFiches)
    .where(eq(technicienFiches.technicienId, id))
    .limit(1);

  const [habilitations, documents, projetsAffectes, sitesOptions] = await Promise.all([
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
    db
      .select()
      .from(technicienDocuments)
      .where(eq(technicienDocuments.technicienId, id))
      .orderBy(desc(technicienDocuments.createdAt)),
    db
      .select({
        id: projets.id,
        reference: projets.reference,
        titre: projets.titre,
        statut: projets.statut,
        clientNom: clients.raisonSociale,
        role: projetTechniciens.role,
      })
      .from(projetTechniciens)
      .innerJoin(projets, eq(projetTechniciens.projetId, projets.id))
      .innerJoin(clients, eq(projets.clientId, clients.id))
      .where(eq(projetTechniciens.technicienId, id))
      .orderBy(desc(projets.createdAt)),
    getSitesForSelect(),
  ]);

  const siteRattache = fiche?.siteRattachementId
    ? sitesOptions.find((s) => s.id === fiche.siteRattachementId)
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        {fiche?.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fiche.photoUrl}
            alt={userRow.nom}
            className="w-16 h-16 rounded-full object-cover bg-blue-pale"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue to-navy text-white flex items-center justify-center font-display font-extrabold text-lg">
            {userRow.nom
              .split(" ")
              .map((p) => p[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-extrabold font-display">{userRow.nom}</h1>
          <p className="text-sm text-ink-soft">
            {userRow.email}
            {siteRattache ? ` · Rattaché : ${siteRattache.raisonSociale} — ${siteRattache.adresse}` : ""}
          </p>
        </div>
        <Pill tone={userRow.actif === 1 ? "ok" : "crit"}>
          {userRow.actif === 1 ? "Actif" : "Désactivé"}
        </Pill>
        {fiche?.statutRh && (
          <Pill tone={fiche.statutRh === "actif" ? "ok" : "neutral"}>
            {STATUT_RH_LABEL[fiche.statutRh] ?? fiche.statutRh}
          </Pill>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Modifier la fiche</h2>
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
              </div>
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
        </div>

        <div className="flex flex-col gap-4">
          <section>
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">
              Habilitations
            </h2>
            <HabilitationsList
              habilitations={habilitations.map((h) => ({
                id: h.id,
                titre: h.titre,
                subtitle: CATEGORIE_LABEL[h.categorie] ?? h.categorie,
                dateObtention: h.dateObtention,
                dateExpiration: h.dateExpiration,
              }))}
            />
          </section>

          <section>
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">
              Projets affectés
            </h2>
            <div className="flex flex-col divide-y divide-line bg-surface border border-line rounded-2xl">
              {projetsAffectes.map((p) => (
                <Link
                  key={p.id}
                  href={`/responsable/projets/${p.id}`}
                  className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-blue-pale/40"
                >
                  <div className="min-w-0">
                    <div className="text-sm truncate">{p.titre}</div>
                    <div className="text-xs text-ink-soft truncate">
                      {p.reference} · {p.clientNom}
                    </div>
                  </div>
                  <Pill tone="neutral">{p.role || "Technicien"}</Pill>
                </Link>
              ))}
              {projetsAffectes.length === 0 && (
                <p className="text-sm text-ink-soft px-4 py-3">Aucun projet pour l&apos;instant.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
