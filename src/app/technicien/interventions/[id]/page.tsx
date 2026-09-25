import {
  Card,
  Btn,
  Field,
  Pill,
  inputClass,
  TypeInterventionPill,
  StatutInterventionPill,
  PrioritePill,
} from "@/components/ui";
import { FileField } from "@/components/file-field";
import { db } from "@/db";
import {
  appareils,
  checklistItems,
  checklistModeles,
  clients,
  documentsFormations,
  interventions,
  mouvementsStock,
  pieces,
  projets,
  rapportPhotos,
  rapports,
} from "@/db/schema";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { formatDate, formatDateTime, toDatetimeLocalValue } from "@/lib/format";
import { peutModifierHeureReelle } from "@/lib/rapport-rules";
import {
  commencerIntervention,
  declarerNonConformite,
  demanderAide,
  enregistrerMouvementTechnicien,
  modifierHeureReelleRapport,
  terminerIntervention,
} from "../../actions";

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

async function getChecklistPourAppareil(typeIntervention: string, marque: string | null, typeAppareil: string | null) {
  const modeles = await db
    .select()
    .from(checklistModeles)
    .where(
      and(
        eq(checklistModeles.actif, 1),
        or(isNull(checklistModeles.typeIntervention), eq(checklistModeles.typeIntervention, typeIntervention as "preventive" | "corrective" | "systematique"))
      )
    );
  const compatibles = modeles.filter(
    (m) =>
      (!m.marque || m.marque === marque) && (!m.typeAppareil || m.typeAppareil === typeAppareil)
  );
  if (compatibles.length === 0) return null;
  // On privilégie le modèle le plus spécifique (le plus de critères renseignés).
  compatibles.sort((a, b) => {
    const score = (m: (typeof compatibles)[number]) =>
      (m.typeIntervention ? 1 : 0) + (m.marque ? 1 : 0) + (m.typeAppareil ? 1 : 0);
    return score(b) - score(a);
  });
  const modele = compatibles[0];
  const items = await db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.modeleId, modele.id))
    .orderBy(checklistItems.ordre);
  return { modele, items };
}

export default async function InterventionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nc?: string; aide?: string }>;
}) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const { id } = await params;
  const { nc, aide } = await searchParams;

  // Phase 6 : l'Appareil n'est plus rattaché à un Site — le client, l'adresse
  // et les instructions d'accès d'une intervention se dérivent désormais du
  // Projet (LEFT JOIN : une intervention sans Projet reste affichée, avec un
  // message "Projet non renseigné" plutôt qu'un plantage).
  const [row] = await db
    .select({ intervention: interventions, appareil: appareils, projet: projets, client: clients })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .leftJoin(clients, eq(projets.clientId, clients.id))
    .where(eq(interventions.id, id))
    .limit(1);
  if (!row) notFound();
  const { intervention, appareil, projet, client } = row;

  if (user.role !== "administrateur" && intervention.technicienId !== user.id) {
    notFound();
  }

  const [rapport, listePieces] = await Promise.all([
    db.select().from(rapports).where(eq(rapports.interventionId, id)).limit(1).then((r) => r[0]),
    db
      .select({
        id: pieces.id,
        reference: pieces.reference,
        nom: pieces.nom,
        quantiteStock: pieces.quantiteStock,
        unite: pieces.unite,
      })
      .from(pieces)
      .orderBy(pieces.nom),
  ]);
  const photosRapport = rapport
    ? await db.select().from(rapportPhotos).where(eq(rapportPhotos.rapportId, rapport.id))
    : [];

  const peutCommencer = ["creee", "planifiee", "affectee"].includes(intervention.statut);
  const peutTerminer = intervention.statut === "en_cours";
  const estTerminee = ["terminee", "validee", "cloturee"].includes(intervention.statut);

  const checklist = peutTerminer
    ? await getChecklistPourAppareil(intervention.type, appareil.marque, appareil.typeAppareil)
    : null;

  // Documentation (Phase 6) : union dédupliquée des documents rattachés à
  // l'Appareil OU au Projet de cette intervention.
  const [documentsAppareil, documentsProjet] = await Promise.all([
    db.select().from(documentsFormations).where(eq(documentsFormations.appareilId, appareil.id)),
    projet
      ? db.select().from(documentsFormations).where(eq(documentsFormations.projetId, projet.id))
      : Promise.resolve([]),
  ]);
  const documentsParId = new Map(
    [...documentsAppareil, ...documentsProjet].map((d) => [d.id, d])
  );
  const documents = [...documentsParId.values()];

  const piecesUtilisees = await db
    .select({
      id: mouvementsStock.id,
      quantite: mouvementsStock.quantite,
      createdAt: mouvementsStock.createdAt,
      pieceNom: pieces.nom,
      pieceReference: pieces.reference,
    })
    .from(mouvementsStock)
    .innerJoin(pieces, eq(mouvementsStock.pieceId, pieces.id))
    .where(and(eq(mouvementsStock.interventionId, id), eq(mouvementsStock.type, "sortie")))
    .orderBy(desc(mouvementsStock.createdAt));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <TypeInterventionPill type={intervention.type} />
          <PrioritePill priorite={intervention.priorite} />
          <StatutInterventionPill statut={intervention.statut} />
        </div>
        <h1 className="text-xl font-extrabold font-display mt-2">{appareil.numeroInterne}</h1>
        {client && projet ? (
          <p className="text-sm text-ink-soft">
            {client.raisonSociale}
            {projet.adresse ? ` — ${projet.adresse}` : ""}
          </p>
        ) : (
          <p className="text-sm text-ink-soft">Projet non renseigné</p>
        )}
        {projet?.instructionsAcces && (
          <p className="text-xs text-orange-ink bg-orange-fill rounded-lg px-3 py-2 mt-2">
            {projet.instructionsAcces}
          </p>
        )}
        {projet?.contactNom && (
          <p className="text-xs text-ink-soft mt-2">
            Contact sur place : <span className="font-semibold">{projet.contactNom}</span>
            {projet.contactTelephone ? ` — ${projet.contactTelephone}` : ""}
          </p>
        )}
      </div>

      <Card className="p-4">
        <h2 className="font-display font-bold text-sm mb-2">Détails</h2>
        <dl className="text-sm flex flex-col gap-1.5">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Programmée</dt>
            <dd className="font-medium">{formatDateTime(intervention.dateProgrammee)}</dd>
          </div>
          {intervention.description && (
            <div>
              <dt className="text-ink-soft">Instructions</dt>
              <dd className="font-medium">{intervention.description}</dd>
            </div>
          )}
        </dl>
      </Card>

      {/* Fiche technique complète de l'appareil (Phase 6) */}
      <Card className="p-4">
        <h2 className="font-display font-bold text-sm mb-2">Appareil</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <DetailRow label="N° interne" value={appareil.numeroInterne} />
          <DetailRow label="N° de série" value={appareil.numeroSerie} />
          <DetailRow label="Marque" value={appareil.marque} />
          <DetailRow label="Modèle" value={appareil.modele} />
          <DetailRow label="Type d'appareil" value={appareil.typeAppareil} />
          <DetailRow
            label="Année d'installation"
            value={appareil.anneeInstallation?.toString()}
          />
          <DetailRow label="Charge" value={appareil.charge ? `${appareil.charge} kg` : undefined} />
          <DetailRow label="Vitesse" value={appareil.vitesse ? `${appareil.vitesse} m/s` : undefined} />
          <DetailRow label="Niveaux" value={appareil.niveaux?.toString()} />
          <DetailRow label="Type de portes" value={appareil.typePortes} />
        </dl>
      </Card>

      {/* Détails Projet (Phase 6) */}
      {projet && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Projet</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <DetailRow label="Référence" value={projet.reference} />
            <DetailRow label="Titre" value={projet.titre} />
            <DetailRow label="Client" value={client?.raisonSociale} />
          </dl>
        </Card>
      )}

      {/* Documentation (Phase 6) : union dédupliquée Appareil + Projet */}
      <Card className="p-4">
        <h2 className="font-display font-bold text-sm mb-2">Documentation ({documents.length})</h2>
        <div className="flex flex-col divide-y divide-line">
          {documents.map((d) => (
            <div key={d.id} className="py-2 flex items-center justify-between gap-3">
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
              </div>
            </div>
          ))}
          {documents.length === 0 && (
            <p className="text-sm text-ink-soft py-2">Aucun document rattaché à cette mission.</p>
          )}
        </div>
      </Card>

      {peutCommencer && (
        <form action={commencerIntervention}>
          <input type="hidden" name="interventionId" value={intervention.id} />
          <Btn className="w-full justify-center">Commencer l&apos;intervention</Btn>
        </form>
      )}

      {peutTerminer && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-3">Pièces utilisées</h2>
          <div className="flex flex-col divide-y divide-line mb-3">
            {piecesUtilisees.map((p) => (
              <div key={p.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span>
                  {p.quantite} × {p.pieceNom} <span className="text-ink-soft">({p.pieceReference})</span>
                </span>
                <span className="text-xs text-ink-soft">{formatDate(p.createdAt)}</span>
              </div>
            ))}
            {piecesUtilisees.length === 0 && (
              <p className="text-sm text-ink-soft py-2">Aucune pièce déclarée pour l&apos;instant.</p>
            )}
          </div>
          <form
            action={enregistrerMouvementTechnicien}
            className="flex flex-wrap items-end gap-2 pt-3 border-t border-line"
          >
            <input type="hidden" name="interventionId" value={intervention.id} />
            <Field label="Pièce utilisée">
              <select name="pieceId" required className={`${inputClass} max-w-xs`} defaultValue="">
                <option value="" disabled>
                  Choisir une pièce
                </option>
                {listePieces.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.reference} — {p.nom} ({p.quantiteStock} {p.unite} en stock)
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantité">
              <input
                name="quantite"
                type="number"
                min={1}
                defaultValue={1}
                required
                className={`${inputClass} max-w-[6rem]`}
              />
            </Field>
            <Btn variant="ghost" className="!px-3 !py-2 !text-xs">
              Déclarer l&apos;utilisation
            </Btn>
          </form>
        </Card>
      )}

      {peutTerminer && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-3">Rapport d&apos;intervention</h2>
          <form
            action={terminerIntervention}
            className="flex flex-col gap-3"
            encType="multipart/form-data"
          >
            <input type="hidden" name="interventionId" value={intervention.id} />
            {checklist && (
              <div className="flex flex-col gap-2 border border-line rounded-xl p-3">
                <input type="hidden" name="checklistModeleId" value={checklist.modele.id} />
                <h3 className="text-sm font-bold">{checklist.modele.nom}</h3>
                {checklist.items.map((item) => (
                  <div key={item.id} className="border-b border-line last:border-0 pb-2 last:pb-0">
                    <div className="text-sm font-medium mb-1.5">{item.libelle}</div>
                    <div className="flex items-center gap-4 mb-1.5">
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="radio" name={`conforme_${item.id}`} value="oui" defaultChecked />
                        Conforme
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="radio" name={`conforme_${item.id}`} value="non" />
                        Non conforme
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="radio" name={`conforme_${item.id}`} value="na" />
                        N/A
                      </label>
                    </div>
                    <input
                      type="text"
                      name={`observation_${item.id}`}
                      placeholder="Observation (optionnel)"
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
            )}
            {!checklist && (
              <p className="text-xs text-ink-soft bg-blue-pale rounded-lg px-3 py-2">
                Aucune checklist configurée pour ce type d&apos;intervention.
              </p>
            )}
            <Field label="Travaux réalisés">
              <textarea name="travauxRealises" required rows={3} className={inputClass} />
            </Field>
            <Field label="Observations">
              <textarea name="observations" rows={2} className={inputClass} />
            </Field>
            <Field label="Temps passé (minutes)">
              <input name="tempsPasseMinutes" type="number" min={0} className={inputClass} />
            </Field>
            <Field label="Heure réelle de l'intervention">
              <input
                name="heureReelle"
                type="datetime-local"
                defaultValue={toDatetimeLocalValue(intervention.dateProgrammee)}
                className={inputClass}
              />
            </Field>
            <p className="text-xs text-ink-soft -mt-2">
              Modifiable pendant 24h après l&apos;heure programmée, ensuite verrouillée.
            </p>
            <Field label="Statut final de l'appareil">
              <select name="statutFinalAppareil" className={inputClass} defaultValue="en_service">
                <option value="en_service">En service</option>
                <option value="sous_surveillance">Sous surveillance</option>
                <option value="en_panne">En panne</option>
                <option value="hors_service">Hors service</option>
                <option value="en_travaux">En travaux</option>
              </select>
            </Field>
            <FileField
              label="Photo(s) de la mission — au moins 1 obligatoire (JPEG / PNG / WEBP, 8 Mo max chacune)"
              name="photos"
              accept="image/jpeg,image/png,image/webp"
              maxBytes={8 * 1024 * 1024}
              multiple
              required
            />
            <Btn className="w-full justify-center">Terminer &amp; envoyer le rapport</Btn>
          </form>
        </Card>
      )}

      {!estTerminee && (
        <Card className="p-4">
          {nc === "1" && (
            <div className="mb-3 text-xs bg-green-fill text-green-ink rounded-lg px-3 py-2">
              Non-conformité déclarée — elle est transmise au responsable qualité.
            </div>
          )}
          <details>
            <summary className="font-display font-bold text-sm cursor-pointer select-none">
              🚫 Signaler une non-conformité
            </summary>
            <form action={declarerNonConformite} className="flex flex-col gap-3 mt-3">
              <input type="hidden" name="interventionId" value={intervention.id} />
              <Field label="Titre">
                <input name="titre" required className={inputClass} placeholder="Résumé du problème constaté" />
              </Field>
              <Field label="Description">
                <textarea name="description" rows={2} className={inputClass} />
              </Field>
              <Field label="Gravité">
                <select name="gravite" className={inputClass} defaultValue="mineure">
                  <option value="mineure">Mineure</option>
                  <option value="majeure">Majeure</option>
                  <option value="critique">Critique</option>
                </select>
              </Field>
              <Btn variant="ghost" className="w-full justify-center">
                Déclarer
              </Btn>
            </form>
          </details>
        </Card>
      )}

      {!estTerminee && (
        <Card className="p-4">
          {aide === "1" && (
            <div className="mb-3 text-xs bg-green-fill text-green-ink rounded-lg px-3 py-2">
              Demande d&apos;aide envoyée au bureau.
            </div>
          )}
          <details>
            <summary className="font-display font-bold text-sm cursor-pointer select-none">
              🆘 Besoin d&apos;aide
            </summary>
            <form action={demanderAide} className="flex flex-col gap-3 mt-3">
              <input type="hidden" name="interventionId" value={intervention.id} />
              <Field label="Message (optionnel)">
                <textarea
                  name="message"
                  rows={3}
                  className={inputClass}
                  placeholder="Décrivez la difficulté rencontrée..."
                />
              </Field>
              <Btn variant="ghost" className="w-full justify-center">
                Alerter le bureau
              </Btn>
            </form>
          </details>
        </Card>
      )}

      {estTerminee && rapport && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Rapport envoyé</h2>
          <dl className="text-sm flex flex-col gap-1.5">
            <div>
              <dt className="text-ink-soft text-xs">Travaux réalisés</dt>
              <dd>{rapport.travauxRealises}</dd>
            </div>
            {rapport.observations && (
              <div>
                <dt className="text-ink-soft text-xs">Observations</dt>
                <dd>{rapport.observations}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-soft">Heure réelle</dt>
              <dd>{formatDateTime(rapport.heureReelle)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Envoyé le</dt>
              <dd>{formatDateTime(rapport.dateEnvoi)}</dd>
            </div>
          </dl>

          {/* Phase 10 : correction de l'heure réelle — 24h après l'heure
              programmée pour le technicien, sans limite pour l'admin. */}
          {peutModifierHeureReelle(intervention.dateProgrammee, user.role) ? (
            <details className="mt-3 pt-3 border-t border-line">
              <summary className="text-xs font-bold text-blue cursor-pointer select-none">
                Corriger l&apos;heure réelle
              </summary>
              <form
                action={modifierHeureReelleRapport}
                className="flex items-end gap-2 mt-2 flex-wrap"
              >
                <input type="hidden" name="interventionId" value={intervention.id} />
                <Field label="Nouvelle heure réelle">
                  <input
                    name="heureReelle"
                    type="datetime-local"
                    required
                    defaultValue={toDatetimeLocalValue(rapport.heureReelle ?? intervention.dateProgrammee)}
                    className={inputClass}
                  />
                </Field>
                <Btn variant="ghost" className="!text-xs">
                  Enregistrer
                </Btn>
              </form>
            </details>
          ) : (
            <p className="text-xs text-ink-soft mt-3 pt-3 border-t border-line">
              Le délai de 24h pour corriger l&apos;heure réelle est dépassé.
            </p>
          )}

          {photosRapport.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {photosRapport.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={p.id}
                  src={p.url}
                  alt="Photo de la mission"
                  className="w-full aspect-square object-cover rounded-lg bg-blue-pale"
                />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}
