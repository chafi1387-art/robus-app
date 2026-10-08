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
import { EnvoiFichiers } from "@/components/envoi-fichiers";
import { TuilePhoto } from "@/components/tuile-photo";
import { ImageMini } from "@/components/image-mini";
import { PassagesPrecedents } from "@/components/carte-devis-mission";
import { devisDeMission, passagesDeMission } from "@/lib/devis";
import { db } from "@/db";
import {
  appareils,
  clients,
  documentsFormations,
  interventions,
  mouvementsStock,
  pieces,
  projets,
  missionJournal,
  rapportPhotos,
  rapports,
  devisLignes,
} from "@/db/schema";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { formatDate, formatDateTime, toDatetimeLocalValue } from "@/lib/format";
import { finModificationRapport, peutModifierRapport, tempsRestantModification } from "@/lib/rapport-rules";
import { Camera, Lock, Pencil, TriangleAlert, Wrench } from "lucide-react";
import Link from "next/link";
import { MOTIFS_REFUS, libelleRefus } from "@/lib/missions";
import { checklistsMission } from "@/lib/checklists";
import { ChecklistTechnicien } from "@/components/checklist-technicien";
import { after } from "next/server";
import { CheckCircle2 } from "lucide-react";
import {
  accepterMission,
  ajouterAuFil,
  ajouterPhotoAuFil,
  ajouterPhotosRapport,
  commencerIntervention,
  declarerNonConformite,
  demanderAide,
  enregistrerMouvementTechnicien,
  modifierRapport,
  refuserMission,
  retirerPhotoRapport,
  terminerIntervention,
} from "../../actions";
import { BoutonEnvoi } from "@/components/bouton-envoi";

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

export default async function InterventionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nc?: string; aide?: string; modifie?: string; erreur?: string; refusee?: string }>;
}) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const { id } = await params;
  const { nc, aide, modifie, refusee } = await searchParams;

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

  // Phase 17 : accusé de réception — la mission est « vue » dès que son
  // technicien l'ouvre (enregistré après l'affichage, sans le ralentir).
  if (intervention.technicienId === user.id && !intervention.vueLe) {
    after(async () => {
      await db
        .update(interventions)
        .set({ vueLe: new Date() })
        .where(and(eq(interventions.id, id), isNull(interventions.vueLe)));
    });
  }

  // Phase 25b : devis de la mission (besoin signalé, travaux à faire) et passages précédents.
  const [devisM, passagesM] = await Promise.all([devisDeMission(id), passagesDeMission(id)]);
  const devisTravaux = devisM.find((d) => (d.statut === "accepte" && d.travauxPlanifiesLe) || d.statut === "realise");
  const lignesTravaux = devisTravaux
    ? await db.select({ designation: devisLignes.designation, quantite: devisLignes.quantite }).from(devisLignes).where(eq(devisLignes.devisId, devisTravaux.id)).orderBy(asc(devisLignes.ordre))
    : [];
  const devisEnCours = devisM.find((d) => ["a_preparer", "brouillon", "envoye"].includes(d.statut));

  const peutCommencer = ["creee", "planifiee", "affectee"].includes(intervention.statut);
  const estRefusee = peutCommencer && !!intervention.refuseeLe;
  const aAccepter = peutCommencer && !intervention.accepteeLe && !estRefusee && intervention.technicienId === user.id;
  const peutTerminer = intervention.statut === "en_cours";
  const estTerminee = ["terminee", "validee", "cloturee"].includes(intervention.statut);

  // Phase 17 : toutes les lectures en une seule vague parallèle (avant : 5
  // vagues successives) — la mission s'ouvre plus vite sur le téléphone.
  const [rapport, listePieces, checklistsM, documentsAppareil, documentsProjet, piecesUtilisees, fil] = await Promise.all([
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
    // Phase 23 : checklists attribuées à la mission (copie figée du modèle).
    checklistsMission(id),
    // Documentation (Phase 6) : union dédupliquée des documents rattachés à
    // l'Appareil OU au Projet de cette intervention.
    db.select().from(documentsFormations).where(eq(documentsFormations.appareilId, appareil.id)),
    projet
      ? db.select().from(documentsFormations).where(eq(documentsFormations.projetId, projet.id))
      : Promise.resolve([]),
    db
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
      .orderBy(desc(mouvementsStock.createdAt)),
    db.select().from(missionJournal).where(eq(missionJournal.interventionId, id)).orderBy(asc(missionJournal.createdAt)),
  ]);
  const photosFil = fil.flatMap((f) => f.photos);
  const manquantesChecklist = checklistsM.reduce((n, c) => n + c.compte.manquantes, 0);
  const modifiable = estTerminee && !!rapport && peutModifierRapport(intervention, user.role);
  const resteModif = tempsRestantModification(intervention.dateFin);
  const photosRapport = rapport
    ? await db.select().from(rapportPhotos).where(eq(rapportPhotos.rapportId, rapport.id))
    : [];
  const documentsParId = new Map(
    [...documentsAppareil, ...documentsProjet].map((d) => [d.id, d])
  );
  const documents = [...documentsParId.values()];

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

      {refusee && <div className="text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">Refus envoyé — le bureau est prévenu et va décider.</div>}

      {devisTravaux && intervention.passage > 1 && !estTerminee && (
        <Card className="p-4 border-[1.5px] border-green bg-green-fill/30">
          <div className="font-display font-bold text-[15px] text-navy flex items-center gap-2">
            <Wrench className="w-4 h-4" /> Travaux du devis {devisTravaux.numero} (accepté par le client)
          </div>
          {lignesTravaux.length > 0 ? (
            <ul className="mt-2 text-sm list-disc pl-5 flex flex-col gap-0.5">
              {lignesTravaux.map((l, i) => (
                <li key={i}>
                  {l.designation}
                  {Number(l.quantite) !== 1 ? ` × ${Number(l.quantite).toLocaleString("fr-BE")}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm mt-1">Voir le devis joint au bureau.</p>
          )}
          <p className="text-xs text-ink-soft mt-2">Passage {intervention.passage} de cette mission — le rapport précédent est conservé plus bas.</p>
        </Card>
      )}
      {devisEnCours && (
        <div className="text-sm bg-orange-fill text-orange-ink rounded-lg px-3 py-2">
          🧾 Devis {devisEnCours.numero} : {devisEnCours.statut === "envoye" ? "envoyé au client, en attente de sa réponse." : "le bureau le prépare."} Si le client accepte, la mission repartira pour les travaux.
        </div>
      )}

      {aAccepter && (
        <Card className="p-4 border-[1.5px] border-blue bg-blue-pale/40">
          <div className="font-display font-bold text-[15px] text-navy">Nouvelle mission — à accepter</div>
          <p className="text-sm text-ink-soft mt-1">
            Prévue le <span className="font-semibold text-ink">{formatDateTime(intervention.dateProgrammee)}</span>. Confirmez au bureau que vous êtes disponible.
          </p>
          <form action={accepterMission} className="mt-3">
            <input type="hidden" name="interventionId" value={intervention.id} />
            <Btn className="w-full justify-center">
              <CheckCircle2 className="w-4 h-4" /> J&apos;accepte la mission
            </Btn>
          </form>
          <details className="mt-2">
            <summary className="text-center text-sm font-bold text-red-ink cursor-pointer select-none py-2">Je ne peux pas la faire</summary>
            <form action={refuserMission} className="flex flex-col gap-2 mt-1">
              <input type="hidden" name="interventionId" value={intervention.id} />
              <div className="flex flex-col gap-1.5">
                {Object.entries(MOTIFS_REFUS).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-[14.5px]">
                    <input type="radio" name="motif" value={k} required className="w-4 h-4" /> {l}
                  </label>
                ))}
              </div>
              <textarea name="commentaire" rows={2} maxLength={500} placeholder="Précision pour le bureau (obligatoire si « Autre »)…" className={inputClass} />
              <BoutonEnvoi type="submit" className="w-full rounded-xl bg-red text-white font-bold text-[15px] py-3">Envoyer mon refus au bureau</BoutonEnvoi>
            </form>
          </details>
        </Card>
      )}
      {estRefusee && (
        <Card className="p-4 border-[1.5px] border-red/60 bg-red-fill/40">
          <div className="font-display font-bold text-[15px] text-red-ink">Vous avez refusé cette mission</div>
          <p className="text-sm mt-1">
            {libelleRefus(intervention.refusMotif)}
            {intervention.refusCommentaire ? ` — ${intervention.refusCommentaire}` : ""}
          </p>
          <p className="text-xs text-ink-soft mt-1">Le bureau va décider (réaffectation ou nouvel envoi). Vous pouvez encore changer d&apos;avis :</p>
          <form action={accepterMission} className="mt-2">
            <input type="hidden" name="interventionId" value={intervention.id} />
            <Btn variant="ghost" className="w-full justify-center">Finalement, j&apos;accepte</Btn>
          </form>
        </Card>
      )}
      {peutCommencer && intervention.accepteeLe && (
        <p className="text-xs font-semibold text-green-ink flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> Mission acceptée le {formatDateTime(intervention.accepteeLe)}
        </p>
      )}

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

      {checklistsM.length > 0 && (
        <Card className="p-4">
          <div id="checklist" className="scroll-mt-20" />
          <h2 className="font-display font-bold text-sm mb-1">
            {peutTerminer ? "Checklist" : estTerminee ? "Checklist réalisée" : `Checklist à réaliser (${checklistsM.reduce((n, c) => n + c.taches.length, 0)} tâches)`}
          </h2>
          {peutCommencer && <p className="text-xs text-ink-soft mb-2">Vous la cocherez pendant l&apos;intervention : ✓ conforme, ✗ non conforme (avec un commentaire).</p>}
          <ChecklistTechnicien
            listes={checklistsM.map((c) => ({ id: c.id, nom: c.nom, taches: c.taches }))}
            modifiable={peutTerminer}
          />
        </Card>
      )}

      {peutCommencer && intervention.accepteeLe && (
        <form action={commencerIntervention}>
          <input type="hidden" name="interventionId" value={intervention.id} />
          <Btn className="w-full justify-center">Commencer l&apos;intervention</Btn>
        </form>
      )}

      {peutTerminer && (
        <Card className="p-4 border-[1.5px] border-blue/50">
          <h2 className="font-display font-bold text-sm flex items-center gap-2">
            <Camera className="w-4 h-4 text-blue" /> Photos &amp; notes en direct
          </h2>
          <p className="text-xs text-ink-soft mt-0.5 mb-3">Le bureau les voit tout de suite. Elles seront aussi jointes au rapport.</p>
          <div id="direct" className="scroll-mt-20" />
          <EnvoiFichiers
            type="photo"
            apresEnvoi={ajouterPhotoAuFil}
            contexte={intervention.id}
            texteOk="envoyée(s) au bureau"
            aide="Chaque photo part tout de suite, une par une : ✓ = bien reçue par le bureau."
          />
          <form action={ajouterAuFil} className="flex gap-2 mt-3">
            <input type="hidden" name="interventionId" value={intervention.id} />
            <input name="texte" required maxLength={1000} placeholder="Note (ex. câble usé gaine 3)…" className={inputClass} />
            <Btn variant="ghost" className="justify-center shrink-0" enCours="Envoi…">Envoyer</Btn>
          </form>
          {fil.length > 0 && (
            <ol className="mt-3 pt-3 border-t border-line flex flex-col gap-2.5">
              {fil.map((f) => (
                <li key={f.id} className="text-sm">
                  <div className="text-xs text-ink-soft">{formatDateTime(f.createdAt).split(" ")[1]}</div>
                  {f.texte && <div>{f.texte}</div>}
                  {f.photos.length > 0 && (
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      {f.photos.map((u) => (
                        <a key={u} href={u} target="_blank" rel="noreferrer">
                          <ImageMini src={u} alt="Photo envoyée" className="w-14 h-14 rounded-lg object-cover bg-blue-pale" />
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>
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
        <Card className="p-4" id="rapport">
          <h2 className="font-display font-bold text-sm mb-3">Rapport d&apos;intervention</h2>
          <form
            action={terminerIntervention}
            className="flex flex-col gap-3"
            encType="multipart/form-data"
          >
            <input type="hidden" name="interventionId" value={intervention.id} />
            {checklistsM.length > 0 && (
              <p className={`text-xs rounded-lg px-3 py-2 ${manquantesChecklist ? "bg-orange-fill text-orange-ink" : "bg-green-fill text-green-ink"}`}>
                {manquantesChecklist ? `Checklist : ${manquantesChecklist} tâche(s) obligatoire(s) à remplir avant d'envoyer.` : "Checklist complète ✓"}
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
              Vous pourrez corriger le rapport pendant 24 h après l&apos;avoir envoyé.
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
            <div className="group rounded-xl border border-line px-3 py-2.5 has-[input[name=devisNecessaire]:checked]:border-orange has-[input[name=devisNecessaire]:checked]:bg-orange-fill/40">
              <label className="flex items-center gap-2 text-sm font-bold text-navy cursor-pointer select-none">
                <input type="checkbox" name="devisNecessaire" className="w-5 h-5" />
                Un devis est nécessaire (travaux / pièces à prévoir)
              </label>
              <div className="hidden group-has-[input[name=devisNecessaire]:checked]:block">
                <textarea
                  name="besoinDevis"
                  rows={3}
                  maxLength={4000}
                  className={`${inputClass} mt-2`}
                  placeholder="Ex. remplacer le contacteur KM1 + câble de commande porte palière 3e…"
                />
                <p className="text-xs text-ink-soft mt-1">Le bureau prépare le devis et l&apos;envoie au client. S&apos;il est accepté, cette même mission vous sera redonnée (ou à un collègue) pour les travaux.</p>
              </div>
            </div>
            <EnvoiFichiers
              type="photo"
              libelle={photosFil.length > 0 ? "Photos supplémentaires (facultatif)" : "Photos de la mission — au moins 1"}
              aide={
                photosFil.length > 0
                  ? `${photosFil.length} photo(s) déjà envoyée(s) en direct seront jointes au rapport.`
                  : "Chaque photo part une par une : attendez le ✓ vert avant d'envoyer le rapport."
              }
              requis={photosFil.length === 0}
            />
            <Btn className="w-full justify-center" enCours="Envoi du rapport…">Terminer &amp; envoyer le rapport</Btn>
          </form>
        </Card>
      )}

      <PassagesPrecedents passages={passagesM} />

      {!estTerminee && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Un problème ?</h2>
          {nc === "1" && (
            <div className="mb-3 text-xs bg-green-fill text-green-ink rounded-lg px-3 py-2">
              Non-conformité déclarée — elle est transmise au responsable qualité.
            </div>
          )}
          {aide === "1" && (
            <div className="mb-3 text-xs bg-green-fill text-green-ink rounded-lg px-3 py-2">
              Demande d&apos;aide envoyée au bureau.
            </div>
          )}
          <Link
            href={`/technicien/signaler?mission=${intervention.id}`}
            className="flex items-center gap-3 rounded-xl bg-red-fill text-red-ink px-3.5 py-3 font-bold text-[14.5px]"
          >
            <TriangleAlert className="w-5 h-5" /> Signaler (accident, véhicule, météo, accès…)
          </Link>
          <details className="mt-2 border-t border-line pt-2">
            <summary className="font-semibold text-sm cursor-pointer select-none py-1.5">
              🆘 Besoin d&apos;aide technique (le bureau vous rappelle)
            </summary>
            <form action={demanderAide} className="flex flex-col gap-3 mt-2">
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
          <details className="border-t border-line pt-2 mt-2">
            <summary className="font-semibold text-sm cursor-pointer select-none py-1.5">
              🚫 Non-conformité sur l&apos;appareil
            </summary>
            <form action={declarerNonConformite} className="flex flex-col gap-3 mt-2">
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

      {estTerminee && rapport && (
        <Card className="p-4">
          {modifie === "1" && (
            <div className="mb-3 text-xs bg-green-fill text-green-ink rounded-lg px-3 py-2">Rapport corrigé — le bureau voit la nouvelle version.</div>
          )}
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="font-display font-bold text-sm">Rapport envoyé</h2>
            {modifiable && user.role !== "administrateur" && resteModif ? (
              <span className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-green-fill text-green-ink">Modifiable encore {resteModif}</span>
            ) : modifiable ? (
              <span className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-blue-pale text-blue">Modification administrateur</span>
            ) : (
              <span className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-[#eef1f5] text-ink-soft inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> Verrouillé
              </span>
            )}
          </div>
          <dl className="text-sm flex flex-col gap-1.5">
            <div>
              <dt className="text-ink-soft text-xs">Travaux réalisés</dt>
              <dd className="whitespace-pre-wrap">{rapport.travauxRealises}</dd>
            </div>
            {rapport.observations && (
              <div>
                <dt className="text-ink-soft text-xs">Observations</dt>
                <dd className="whitespace-pre-wrap">{rapport.observations}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-soft">Temps passé</dt>
              <dd>{rapport.tempsPasseMinutes != null ? `${rapport.tempsPasseMinutes} min` : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Heure réelle</dt>
              <dd>{formatDateTime(rapport.heureReelle)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Envoyé le</dt>
              <dd>{formatDateTime(rapport.dateEnvoi)}</dd>
            </div>
            {rapport.modifieLe && (
              <div className="flex justify-between">
                <dt className="text-ink-soft">Corrigé le</dt>
                <dd>{formatDateTime(rapport.modifieLe)}</dd>
              </div>
            )}
          </dl>
          {!modifiable && intervention.statut === "terminee" && (
            <p className="text-xs text-ink-soft mt-2">
              Délai de correction dépassé ({formatDateTime(finModificationRapport(intervention.dateFin))}). Pour une correction, contactez le bureau.
            </p>
          )}
          {!modifiable && intervention.statut !== "terminee" && (
            <p className="text-xs text-ink-soft mt-2">Rapport validé par le bureau — verrouillé.</p>
          )}

          <div id="rapport-photos" className="scroll-mt-20" />
          {photosRapport.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {photosRapport.map((p) => (
                <TuilePhoto
                  key={p.id}
                  url={p.url}
                  alt="Photo de la mission"
                  action={retirerPhotoRapport}
                  champs={{ interventionId: intervention.id, photoId: p.id }}
                  retirable={modifiable && photosRapport.length > 1}
                />
              ))}
            </div>
          )}

          {modifiable && (
            <details className="mt-3 pt-3 border-t border-line">
              <summary className="text-sm font-bold text-blue cursor-pointer select-none flex items-center gap-2">
                <Pencil className="w-4 h-4" /> Corriger le rapport
              </summary>
              <form action={modifierRapport} className="flex flex-col gap-3 mt-3">
                <input type="hidden" name="interventionId" value={intervention.id} />
                <Field label="Travaux réalisés">
                  <textarea name="travauxRealises" required rows={3} defaultValue={rapport.travauxRealises ?? ""} className={inputClass} />
                </Field>
                <Field label="Observations">
                  <textarea name="observations" rows={2} defaultValue={rapport.observations ?? ""} className={inputClass} />
                </Field>
                <Field label="Temps passé (minutes)">
                  <input name="tempsPasseMinutes" type="number" min={0} defaultValue={rapport.tempsPasseMinutes ?? ""} className={inputClass} />
                </Field>
                <Field label="Heure réelle de l'intervention">
                  <input
                    name="heureReelle"
                    type="datetime-local"
                    defaultValue={toDatetimeLocalValue(rapport.heureReelle ?? intervention.dateProgrammee)}
                    className={inputClass}
                  />
                </Field>
                <Btn className="justify-center">Enregistrer les corrections</Btn>
              </form>
              <form action={ajouterPhotosRapport} className="flex flex-col gap-2 mt-4 pt-3 border-t border-line">
                <input type="hidden" name="interventionId" value={intervention.id} />
                <EnvoiFichiers type="photo" libelle="Ajouter des photos" requis />
                <Btn variant="ghost" className="justify-center" enCours="Ajout…">Ajouter au rapport</Btn>
              </form>
            </details>
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
