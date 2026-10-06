import { QrCode } from "lucide-react";
import { FrisePassages } from "@/components/frise-passages";
import { passagesDAppareils } from "@/lib/garantie-passages";
import { contratsDeLAppareil, ETAT_CONTRAT, etatContrat } from "@/lib/contrats";
import { ajouterDocumentClient, archiverDocumentClient } from "../../observateurs/actions";
import { TYPES_DOCUMENT_CLIENT } from "@/lib/documents-client";
import { documentsClient, documentsClientConsultations, observateurAppareils } from "@/db/schema";
import {
  Card,
  Btn,
  Field,
  Pill,
  inputClass,
  StatutAppareilPill,
  StatutInterventionPill,
  TypeInterventionPill,
  PrioritePill,
} from "@/components/ui";
import { FileField } from "@/components/file-field";
import { db } from "@/db";
import { appareils, clients, documentsFormations, interventions, sites, users } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createIntervention,
  getTechniciens,
  updateAppareil,
  uploadAppareilPhoto,
} from "../../actions";
import { getProjetsPourAppareil } from "../../projets/actions";
import { formatDate, formatDateTime } from "@/lib/format";

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

const STATUTS = [
  "en_service",
  "sous_surveillance",
  "en_panne",
  "hors_service",
  "en_travaux",
  "installation",
] as const;
const STATUT_LABEL: Record<(typeof STATUTS)[number], string> = {
  en_service: "En service",
  sous_surveillance: "Sous surveillance",
  en_panne: "En panne",
  hors_service: "Hors service",
  en_travaux: "En travaux",
  installation: "Installation (projet sur plan)",
};

export default async function AppareilDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [row] = await db
    .select({ appareil: appareils, site: sites, client: clients })
    .from(appareils)
    .leftJoin(sites, eq(appareils.siteId, sites.id))
    .leftJoin(clients, eq(sites.clientId, clients.id))
    .where(eq(appareils.id, id))
    .limit(1);
  if (!row) notFound();
  const { appareil, site, client } = row;

  // Phase 20 : documents partagés avec le client + qui les a consultés.
  const docsClient = await db
    .select({
      d: documentsClient,
      auteur: users.nom,
      vus: sql<string | null>`(select string_agg(u.nom || ' le ' || to_char(c.premiere_le, 'DD/MM/YYYY HH24:MI'), ', ') from ${documentsClientConsultations} c join ${users} u on u.id = c.user_id where c.document_id = ${documentsClient.id})`,
    })
    .from(documentsClient)
    .leftJoin(users, eq(documentsClient.creeParId, users.id))
    .where(eq(documentsClient.appareilId, id))
    .orderBy(desc(documentsClient.createdAt));
  // Phase 24 : contrats de maintenance + passages (garantie et contrats) de cet appareil.
  const [contratsAppareil, passagesAppareil] = await Promise.all([contratsDeLAppareil(id), passagesDAppareils([id])]);
  const [nbObservateurs] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(observateurAppareils)
    .where(eq(observateurAppareils.appareilId, id));

  const [interventionRows, techniciens, projetsPourAppareil, documents] = await Promise.all([
    db
      .select({
        id: interventions.id,
        type: interventions.type,
        statut: interventions.statut,
        priorite: interventions.priorite,
        description: interventions.description,
        dateProgrammee: interventions.dateProgrammee,
        technicien: users.nom,
      })
      .from(interventions)
      .leftJoin(users, eq(interventions.technicienId, users.id))
      .where(eq(interventions.appareilId, id))
      .orderBy(desc(interventions.dateProgrammee)),
    getTechniciens(),
    getProjetsPourAppareil(id),
    db
      .select()
      .from(documentsFormations)
      .where(eq(documentsFormations.appareilId, id))
      .orderBy(desc(documentsFormations.createdAt)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* Chaîne relationnelle : Client -> Site -> Appareil, en un clic vers chaque niveau.
            Phase 6 : l'Appareil est désormais indépendant du Site — ce fil n'apparaît que
            pour les appareils encore historiquement rattachés à un Site. */}
        {client && site ? (
          <div className="text-xs text-ink-soft flex items-center gap-1.5 flex-wrap">
            <Link href={`/responsable/clients/${client.id}`} className="text-blue font-semibold">
              {client.raisonSociale}
            </Link>
            <span>/</span>
            <Link href={`/responsable/sites/${site.id}`} className="text-blue font-semibold">
              {site.adresse}
            </Link>
          </div>
        ) : (
          <div className="text-xs text-ink-soft">
            Appareil indépendant — rattaché à un Client via un Projet
          </div>
        )}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h1 className="text-2xl font-extrabold font-display">{appareil.numeroInterne}</h1>
          <StatutAppareilPill statut={appareil.statut} />
          <Link
            href={`/responsable/appareils/${appareil.id}/qr`}
            className="ml-auto inline-flex items-center gap-1.5 text-sm font-bold border border-line rounded-lg px-3 py-1.5 hover:bg-blue-pale"
          >
            <QrCode className="w-4 h-4" /> Étiquette QR
          </Link>
        </div>
        <p className="text-sm text-ink-soft">
          {[appareil.marque, appareil.modele, appareil.typeAppareil].filter(Boolean).join(" · ") ||
            "Détails techniques non renseignés"}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {appareil.photoUrl && (
            <Card className="p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={appareil.photoUrl}
                alt={`Photo de l'appareil ${appareil.numeroInterne}`}
                className="w-full max-h-96 object-contain rounded-xl bg-blue-pale"
              />
            </Card>
          )}

          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Fiche technique</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <InfoRow label="N° de série" value={appareil.numeroSerie} />
              <InfoRow label="Année d'installation" value={appareil.anneeInstallation?.toString()} />
              <InfoRow label="Charge" value={appareil.charge ? `${appareil.charge} kg` : undefined} />
              <InfoRow label="Vitesse" value={appareil.vitesse ? `${appareil.vitesse} m/s` : undefined} />
              <InfoRow label="Niveaux" value={appareil.niveaux?.toString()} />
              <InfoRow label="Type de portes" value={appareil.typePortes ?? undefined} />
            </dl>
          </Card>

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

          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">
              Historique des interventions ({interventionRows.length})
            </h2>
            <div className="flex flex-col divide-y divide-line">
              {interventionRows.map((i) => (
                <div key={i.id} className="py-3 flex items-start gap-3">
                  <TypeInterventionPill type={i.type} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{i.description || "Sans description"}</div>
                    <div className="text-xs text-ink-soft mt-0.5">
                      {formatDateTime(i.dateProgrammee)} · {i.technicien ?? "Non affecté"}
                    </div>
                  </div>
                  <PrioritePill priorite={i.priorite} />
                  <StatutInterventionPill statut={i.statut} />
                </div>
              ))}
              {interventionRows.length === 0 && (
                <p className="text-sm text-ink-soft py-2">Aucune intervention pour l&apos;instant.</p>
              )}
            </div>
          </Card>

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
            <h2 className="font-display font-bold text-sm mb-3">Photo de l&apos;appareil</h2>
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

          <Card className="p-5 border-[1.5px] border-blue/40">
            <div id="documents-client" className="scroll-mt-24" />
            <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
              <h2 className="font-display font-bold text-sm">Documents client ({docsClient.filter((x) => !x.d.archiveLe).length})</h2>
              <span className="text-[11px] text-ink-soft">Visibles uniquement par les observateurs de cet ascenseur ({nbObservateurs?.n ?? 0})</span>
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
                    <button type="submit" className="text-xs font-bold text-ink-soft hover:text-red-ink">{d.archiveLe ? "Remettre" : "Retirer"}</button>
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

        <Card className="p-5 h-fit">
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
      </div>
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
