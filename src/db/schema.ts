import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  pgEnum,
  integer,
  numeric,
  uniqueIndex,
  date,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Schéma Phase 1 — Fondations
 * Reprend le modèle relationnel du cahier des charges :
 * Client -> Site -> Appareil -> Intervention -> Rapport
 * Règle d'intégrité : aucune donnée orpheline (clés étrangères NOT NULL, onDelete: "restrict").
 */

export const roleEnum = pgEnum("role", [
  "administrateur",
  "responsable_qualite",
  "technicien",
  "commercial",
]);

export const typeClientEnum = pgEnum("type_client", [
  "copropriete",
  "entreprise",
  "particulier",
  "syndicat",
  "sous_traitance",
]);

export const statutAppareilEnum = pgEnum("statut_appareil", [
  "en_service",
  "sous_surveillance",
  "en_panne",
  "hors_service",
  "en_travaux",
  "installation",
]);

export const typeInterventionEnum = pgEnum("type_intervention", [
  "preventive",
  "corrective",
  "systematique",
]);

export const statutInterventionEnum = pgEnum("statut_intervention", [
  "creee",
  "planifiee",
  "affectee",
  "en_cours",
  "terminee",
  "validee",
  "cloturee",
]);

export const prioriteEnum = pgEnum("priorite", ["basse", "normale", "haute", "critique"]);

// ---------- Enums Phase 2 / 3 ----------
export const statutNonConformiteEnum = pgEnum("statut_non_conformite", [
  "ouverte",
  "en_cours",
  "cloturee",
]);
export const graviteNonConformiteEnum = pgEnum("gravite_non_conformite", [
  "mineure",
  "majeure",
  "critique",
]);
export const categorieDocumentEnum = pgEnum("categorie_document", [
  "securite",
  "installation",
  "maintenance",
  "depannage",
  "marques",
  "procedures_robus",
  "videos",
  // Phase 11 : documents fournisseurs (certificats, fiches techniques...)
  // liés à une Pièce de stock, dans une optique de traçabilité ISO 9001.
  "fournisseur_iso",
]);
export const typeMouvementStockEnum = pgEnum("type_mouvement_stock", ["entree", "sortie"]);
export const typeAuditEnum = pgEnum("type_audit", ["interne", "externe"]);
export const statutAuditEnum = pgEnum("statut_audit", ["planifie", "en_cours", "termine"]);
export const statutDevisEnum = pgEnum("statut_devis", [
  "brouillon",
  "envoye",
  "accepte",
  "refuse",
]);
export const typeRisqueEnum = pgEnum("type_risque", ["risque", "opportunite"]);
export const statutRisqueEnum = pgEnum("statut_risque", [
  "identifie",
  "en_traitement",
  "maitrise",
]);
export const lieuFormationEnum = pgEnum("lieu_formation", ["terrain", "bureau", "ecole"]);

// ---------- Enums Phase 5 ----------
export const prestationTypeEnum = pgEnum("prestation_type", [
  "installation",
  "reparation",
  "garantie",
  "maintenance_preventive",
  "maintenance_corrective",
  "maintenance_systematique",
  "vente_piece",
]);

export const statutProjetEnum = pgEnum("statut_projet", [
  "cree",
  "planifie",
  "en_cours",
  "termine",
  "valide_iso",
]);

// ---------- Enums Phase 6 ----------
export const statutRhTechnicienEnum = pgEnum("statut_rh_technicien", [
  "actif",
  "en_conge",
  "arret_maladie",
  "en_formation",
  "suspendu",
  "sorti_effectifs",
]);

export const categoriePrestationEnum = pgEnum("categorie_prestation", [
  "installation",
  "reparation",
  "maintenance",
  "vente_piece",
  "autre",
]);

// ---------- Utilisateurs ----------
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nom: varchar("nom", { length: 160 }).notNull(),
    email: varchar("email", { length: 200 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull(),
    telephone: varchar("telephone", { length: 40 }),
    actif: integer("actif").notNull().default(1), // 1 = actif, 0 = désactivé
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)]
);

// ---------- Clients ----------
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  raisonSociale: varchar("raison_sociale", { length: 200 }).notNull(),
  type: typeClientEnum("type").notNull().default("copropriete"),
  commercialResponsableId: uuid("commercial_responsable_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const contactsClient = pgTable("contacts_client", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  nom: varchar("nom", { length: 160 }).notNull(),
  fonction: varchar("fonction", { length: 120 }),
  telephone: varchar("telephone", { length: 40 }),
  email: varchar("email", { length: 200 }),
});

// ---------- Sites ----------
// Règle d'intégrité 1 : impossible de créer un Site sans Client existant -> clientId NOT NULL + RESTRICT
export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "restrict" }),
  adresse: text("adresse").notNull(),
  instructionsAcces: text("instructions_acces"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Appareils ----------
// Phase 6 : l'Appareil est désormais indépendant du Site. La règle
// d'intégrité 2 ("impossible de créer un Appareil sans Site existant") est
// supprimée — un Appareil se crée seul, avec ses seules caractéristiques
// techniques, et se rattache ensuite à un Client via un Projet (voir
// `projetAppareils`). `siteId` reste présent (nullable, SET NULL) pour ne pas
// perdre le lien historique des appareils déjà rattachés à un Site.
export const appareils = pgTable(
  "appareils",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
    numeroInterne: varchar("numero_interne", { length: 40 }).notNull(),
    numeroSerie: varchar("numero_serie", { length: 80 }),
    marque: varchar("marque", { length: 80 }),
    modele: varchar("modele", { length: 80 }),
    typeAppareil: varchar("type_appareil", { length: 80 }),
    anneeInstallation: integer("annee_installation"),
    charge: numeric("charge_kg"),
    vitesse: numeric("vitesse_ms"),
    niveaux: integer("niveaux"),
    typePortes: varchar("type_portes", { length: 80 }),
    statut: statutAppareilEnum("statut").notNull().default("en_service"),
    photoUrl: text("photo_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("appareils_numero_interne_idx").on(t.numeroInterne)]
);

// ---------- Interventions ----------
// Règle d'intégrité 3 : impossible de créer une Intervention sans Appareil existant -> appareilId NOT NULL + RESTRICT
// Règle d'intégrité 4 : liée à Client + Site + Appareil (+ Technicien) -> dérivée via l'Appareil, jamais dupliquée.
export const interventions = pgTable("interventions", {
  id: uuid("id").primaryKey().defaultRandom(),
  appareilId: uuid("appareil_id")
    .notNull()
    .references(() => appareils.id, { onDelete: "restrict" }),
  technicienId: uuid("technicien_id").references(() => users.id, { onDelete: "set null" }),
  // Phase 5 : rattachement au Projet central. Nullable pour ne pas casser les
  // interventions déjà en base (créées avant l'introduction du Projet) —
  // devient obligatoire côté application pour toute nouvelle création.
  projetId: uuid("projet_id").references(() => projets.id, { onDelete: "set null" }),
  type: typeInterventionEnum("type").notNull(),
  statut: statutInterventionEnum("statut").notNull().default("creee"),
  priorite: prioriteEnum("priorite").notNull().default("normale"),
  description: text("description"),
  dateProgrammee: timestamp("date_programmee"),
  dateDebut: timestamp("date_debut"),
  dateFin: timestamp("date_fin"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Rapports (structure simple — Phase 1) ----------
export const rapports = pgTable(
  "rapports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    interventionId: uuid("intervention_id")
      .notNull()
      .references(() => interventions.id, { onDelete: "cascade" }),
    checklistModeleId: uuid("checklist_modele_id").references(() => checklistModeles.id, {
      onDelete: "set null",
    }),
    travauxRealises: text("travaux_realises"),
    observations: text("observations"),
    tempsPasseMinutes: integer("temps_passe_minutes"),
    statutFinalAppareil: statutAppareilEnum("statut_final_appareil"),
    dateEnvoi: timestamp("date_envoi"),
    // Phase 10 : heure réelle de l'intervention (peut différer de l'heure
    // programmée) — modifiable par le technicien pendant 24h après l'heure
    // programmée, puis verrouillée (sauf pour l'administrateur).
    heureReelle: timestamp("heure_reelle"),
    valideParId: uuid("valide_par_id").references(() => users.id, { onDelete: "set null" }),
    dateValidation: timestamp("date_validation"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rapports_intervention_idx").on(t.interventionId)]
);

// ==========================================================================
// PHASE 2 — Maintenance & Qualité
// ==========================================================================

// ---------- Checklists (7.2) ----------
export const checklistModeles = pgTable("checklist_modeles", {
  id: uuid("id").primaryKey().defaultRandom(),
  nom: varchar("nom", { length: 200 }).notNull(),
  typeIntervention: typeInterventionEnum("type_intervention"),
  marque: varchar("marque", { length: 80 }),
  typeAppareil: varchar("type_appareil", { length: 80 }),
  actif: integer("actif").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const checklistItems = pgTable("checklist_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  modeleId: uuid("modele_id")
    .notNull()
    .references(() => checklistModeles.id, { onDelete: "cascade" }),
  ordre: integer("ordre").notNull().default(0),
  libelle: varchar("libelle", { length: 200 }).notNull(),
});

// Réponses cochées lors d'un rapport d'intervention (conforme = 1/0/NULL non renseigné)
export const rapportChecklistReponses = pgTable("rapport_checklist_reponses", {
  id: uuid("id").primaryKey().defaultRandom(),
  rapportId: uuid("rapport_id")
    .notNull()
    .references(() => rapports.id, { onDelete: "cascade" }),
  itemId: uuid("item_id")
    .notNull()
    .references(() => checklistItems.id, { onDelete: "restrict" }),
  conforme: integer("conforme"),
  observation: text("observation"),
});

// Phase 5 : photos obligatoires jointes au rapport de fin de mission
// (une ligne par photo — plusieurs photos possibles, contrairement à la
// photo unique de l'appareil).
export const rapportPhotos = pgTable("rapport_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  rapportId: uuid("rapport_id")
    .notNull()
    .references(() => rapports.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Non-conformités (7.4 / clause 10.2) ----------
export const nonConformites = pgTable("non_conformites", {
  id: uuid("id").primaryKey().defaultRandom(),
  titre: varchar("titre", { length: 200 }).notNull(),
  description: text("description"),
  gravite: graviteNonConformiteEnum("gravite").notNull().default("mineure"),
  statut: statutNonConformiteEnum("statut").notNull().default("ouverte"),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  appareilId: uuid("appareil_id").references(() => appareils.id, { onDelete: "set null" }),
  interventionId: uuid("intervention_id").references(() => interventions.id, {
    onDelete: "set null",
  }),
  declarantId: uuid("declarant_id").references(() => users.id, { onDelete: "set null" }),
  responsableActionId: uuid("responsable_action_id").references(() => users.id, {
    onDelete: "set null",
  }),
  actionCorrective: text("action_corrective"),
  dateEcheance: timestamp("date_echeance"),
  dateCloture: timestamp("date_cloture"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Planning automatique (7.5) ----------
// Une règle par appareil : périodicité + anticipation de génération (ex. 15 jours avant)
export const reglesPlanification = pgTable("regles_planification", {
  id: uuid("id").primaryKey().defaultRandom(),
  appareilId: uuid("appareil_id")
    .notNull()
    .references(() => appareils.id, { onDelete: "restrict" }),
  type: typeInterventionEnum("type").notNull().default("preventive"),
  periodiciteMois: integer("periodicite_mois").notNull(),
  anticipationJours: integer("anticipation_jours").notNull().default(15),
  prochaineDate: timestamp("prochaine_date").notNull(),
  actif: integer("actif").notNull().default(1),
  // Phase 5 : quand une règle est générée automatiquement pour une Garantie,
  // ce lien permet à genererInterventionsPlanifiees() de décrémenter le
  // compteur de visites restantes et de couper la règle une fois à zéro.
  garantieId: uuid("garantie_id").references(() => garanties.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Documents & Formations (8.2) ----------
export const documentsFormations = pgTable("documents_formations", {
  id: uuid("id").primaryKey().defaultRandom(),
  titre: varchar("titre", { length: 200 }).notNull(),
  categorie: categorieDocumentEnum("categorie").notNull().default("maintenance"),
  typeContenu: varchar("type_contenu", { length: 40 }).notNull().default("document"), // document | video
  urlFichier: text("url_fichier"),
  marque: varchar("marque", { length: 80 }),
  typeAppareilConcerne: varchar("type_appareil_concerne", { length: 80 }),
  appareilId: uuid("appareil_id").references(() => appareils.id, { onDelete: "set null" }),
  // Phase 6 : un document/formation peut aussi être rattaché directement à
  // un Projet (ex. plan d'installation, notice remise au client) — mêmes
  // règles que appareilId (nullable, SET NULL).
  projetId: uuid("projet_id").references(() => projets.id, { onDelete: "set null" }),
  // Phase 9a : ou à un Audit précis (ex. rapport final d'un audit ISO 9001).
  auditId: uuid("audit_id").references(() => audits.id, { onDelete: "set null" }),
  // Phase 11 : ou à une Pièce de stock (ex. certificat fournisseur ISO 9001).
  pieceId: uuid("piece_id").references(() => pieces.id, { onDelete: "set null" }),
  estFormation: integer("est_formation").notNull().default(0),
  dureeValiditeMois: integer("duree_validite_mois"),
  lieuFormation: lieuFormationEnum("lieu_formation"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const habilitationsTechnicien = pgTable("habilitations_technicien", {
  id: uuid("id").primaryKey().defaultRandom(),
  technicienId: uuid("technicien_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documentsFormations.id, { onDelete: "restrict" }),
  dateObtention: timestamp("date_obtention").notNull().defaultNow(),
  dateExpiration: timestamp("date_expiration"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const formationsConsultations = pgTable("formations_consultations", {
  id: uuid("id").primaryKey().defaultRandom(),
  technicienId: uuid("technicien_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documentsFormations.id, { onDelete: "cascade" }),
  dateConsultation: timestamp("date_consultation").notNull().defaultNow(),
});

// ---------- Score ISO 9001 (section 9) ----------
// Une ligne par mois et par bloc (7 blocs à poids fixes, voir src/lib/score-iso.ts)
export const scoreIsoSaisies = pgTable(
  "score_iso_saisies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mois: varchar("mois", { length: 7 }).notNull(), // format "AAAA-MM"
    bloc: varchar("bloc", { length: 60 }).notNull(),
    valeur: numeric("valeur").notNull(),
    commentaire: text("commentaire"),
    saisiParId: uuid("saisi_par_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("score_iso_mois_bloc_idx").on(t.mois, t.bloc)]
);

// ==========================================================================
// PHASE 3 — Pilotage avancé
// ==========================================================================

// ---------- Stock (traçabilité pièces) ----------
export const pieces = pgTable(
  "pieces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: varchar("reference", { length: 80 }).notNull(),
    nom: varchar("nom", { length: 200 }).notNull(),
    marque: varchar("marque", { length: 80 }),
    // Phase 11 : profil fournisseur (fiche pièce plus complète, ISO 9001).
    referenceFournisseur: varchar("reference_fournisseur", { length: 80 }),
    fournisseur: varchar("fournisseur", { length: 120 }),
    photoUrl: text("photo_url"),
    quantiteStock: integer("quantite_stock").notNull().default(0),
    seuilAlerte: integer("seuil_alerte").notNull().default(0),
    unite: varchar("unite", { length: 20 }).notNull().default("unité"),
    // Phase 11 : une pièce qui a déjà des mouvements de stock ne peut pas
    // être supprimée (contrainte FK "restrict" sur mouvements_stock.piece_id,
    // pour ne jamais perdre la traçabilité) — on la désactive à la place,
    // même principe que prestations_catalogue.actif.
    actif: integer("actif").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pieces_reference_idx").on(t.reference)]
);

export const mouvementsStock = pgTable("mouvements_stock", {
  id: uuid("id").primaryKey().defaultRandom(),
  pieceId: uuid("piece_id")
    .notNull()
    .references(() => pieces.id, { onDelete: "restrict" }),
  type: typeMouvementStockEnum("type").notNull(),
  quantite: integer("quantite").notNull(),
  interventionId: uuid("intervention_id").references(() => interventions.id, {
    onDelete: "set null",
  }),
  // Phase 6 : un mouvement peut aussi être directement rattaché à un Projet
  // (ex. vente de pièce facturée sur un Projet sans intervention terrain).
  projetId: uuid("projet_id").references(() => projets.id, { onDelete: "set null" }),
  effectueParId: uuid("effectue_par_id").references(() => users.id, { onDelete: "set null" }),
  commentaire: text("commentaire"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Auditeurs (Phase 9a) ----------
// Fiche de contact indépendante (pas de compte de connexion) — un auditeur
// interne ou externe (organisme de certification) qu'on peut affecter à un
// Audit. Même logique de fiche indépendante que Client/Appareil/Technicien.
export const auditeurs = pgTable("auditeurs", {
  id: uuid("id").primaryKey().defaultRandom(),
  nom: varchar("nom", { length: 200 }).notNull(),
  organisme: varchar("organisme", { length: 200 }),
  numeroCertification: varchar("numero_certification", { length: 100 }),
  telephone: varchar("telephone", { length: 30 }),
  email: varchar("email", { length: 200 }),
  specialite: varchar("specialite", { length: 200 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Audits ----------
export const audits = pgTable("audits", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: typeAuditEnum("type").notNull().default("interne"),
  statut: statutAuditEnum("statut").notNull().default("planifie"),
  titre: varchar("titre", { length: 200 }).notNull(),
  datePlanifiee: timestamp("date_planifiee"),
  dateRealisation: timestamp("date_realisation"),
  // Champ historique (Phase 1) — pointait vers un compte utilisateur du
  // bureau. Conservé tel quel (jamais touché) pour ne rien casser ; le
  // formulaire utilise désormais auditeurFicheId ci-dessous.
  auditeurId: uuid("auditeur_id").references(() => users.id, { onDelete: "set null" }),
  // Phase 9a : fiche Auditeur dédiée (interne ou externe, avec organisme /
  // certification / coordonnées) — c'est ce champ que l'application utilise
  // désormais pour affecter un auditeur à un audit.
  auditeurFicheId: uuid("auditeur_fiche_id").references(() => auditeurs.id, { onDelete: "set null" }),
  constats: text("constats"),
  actionsSuivi: text("actions_suivi"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Devis (8.2 module cité) ----------
export const devis = pgTable("devis", {
  id: uuid("id").primaryKey().defaultRandom(),
  numero: varchar("numero", { length: 40 }).notNull(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "restrict" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  statut: statutDevisEnum("statut").notNull().default("brouillon"),
  montantHt: numeric("montant_ht"),
  description: text("description"),
  dateEnvoi: timestamp("date_envoi"),
  dateReponse: timestamp("date_reponse"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Registre des risques et opportunités (clause 6.1) ----------
export const risques = pgTable("risques", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: typeRisqueEnum("type").notNull().default("risque"),
  titre: varchar("titre", { length: 200 }).notNull(),
  description: text("description"),
  impact: prioriteEnum("impact").notNull().default("normale"),
  statut: statutRisqueEnum("statut").notNull().default("identifie"),
  planActions: text("plan_actions"),
  responsableId: uuid("responsable_id").references(() => users.id, { onDelete: "set null" }),
  dateRevue: timestamp("date_revue"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Étalonnage des instruments de mesure (clause 7.1.5) ----------
export const instrumentsMesure = pgTable("instruments_mesure", {
  id: uuid("id").primaryKey().defaultRandom(),
  nom: varchar("nom", { length: 160 }).notNull(),
  reference: varchar("reference", { length: 80 }),
  dateDernierEtalonnage: timestamp("date_dernier_etalonnage"),
  periodiciteMois: integer("periodicite_mois").notNull().default(12),
  dateProchainEtalonnage: timestamp("date_prochain_etalonnage"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Satisfaction client (clause 9.1.2) ----------
export const enquetesSatisfaction = pgTable("enquetes_satisfaction", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "restrict" }),
  interventionId: uuid("intervention_id").references(() => interventions.id, {
    onDelete: "set null",
  }),
  note: integer("note").notNull(),
  commentaire: text("commentaire"),
  dateEnquete: timestamp("date_enquete").notNull().defaultNow(),
});

export const reclamationsClient = pgTable("reclamations_client", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "restrict" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  statut: statutNonConformiteEnum("statut").notNull().default("ouverte"),
  dateReclamation: timestamp("date_reclamation").notNull().defaultNow(),
  dateResolution: timestamp("date_resolution"),
});

// ---------- Revue de direction (clause 9.3) ----------
export const revuesDirection = pgTable("revues_direction", {
  id: uuid("id").primaryKey().defaultRandom(),
  dateRevue: timestamp("date_revue").notNull(),
  participants: text("participants"),
  pointsAbordes: text("points_abordes"),
  decisions: text("decisions"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Historique / audit trail générique (règle n°8 : "historique inviolable") ----------
// Table strictement en ajout (jamais modifiée ni supprimée par le code applicatif).
export const journalActivite = pgTable("journal_activite", {
  id: uuid("id").primaryKey().defaultRandom(),
  entite: varchar("entite", { length: 60 }).notNull(),
  entiteId: uuid("entite_id").notNull(),
  action: varchar("action", { length: 40 }).notNull(),
  utilisateurId: uuid("utilisateur_id").references(() => users.id, { onDelete: "set null" }),
  details: text("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ==========================================================================
// PHASE 5 — Projet central, Prestations, Fiche technicien RH, Garantie
// ==========================================================================

// ---------- Fiche technicien (RH) ----------
// 1-pour-1 avec un `users` de rôle technicien. Table séparée (plutôt que
// d'alourdir `users`) pour rester cohérent avec le style du fichier : les
// entités métier normalisées vivent à part, `users` reste centré sur l'auth.
export const technicienFiches = pgTable(
  "technicien_fiches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    technicienId: uuid("technicien_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    photoUrl: text("photo_url"),
    dateNaissance: timestamp("date_naissance"),
    contactUrgenceNom: varchar("contact_urgence_nom", { length: 160 }),
    contactUrgenceTelephone: varchar("contact_urgence_telephone", { length: 40 }),
    siteRattachementId: uuid("site_rattachement_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    // ---------- Phase 6 : fiche RH plus complète ----------
    dateEntreeEntreprise: timestamp("date_entree_entreprise"),
    typeContrat: varchar("type_contrat", { length: 80 }),
    adresseDomicile: text("adresse_domicile"),
    statutRh: statutRhTechnicienEnum("statut_rh").default("actif"),
    // ---------- Phase 13 : profil complet ----------
    poste: varchar("poste", { length: 120 }),
    specialites: text("specialites"),
    vehicule: varchar("vehicule", { length: 80 }),
    dateSortie: timestamp("date_sortie"),
    motifSortie: varchar("motif_sortie", { length: 200 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("technicien_fiches_technicien_idx").on(t.technicienId)]
);

// Dossier documents "comme un RH" : plusieurs fichiers par technicien.
export const technicienDocuments = pgTable("technicien_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  technicienId: uuid("technicien_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  titre: varchar("titre", { length: 200 }).notNull(),
  urlFichier: text("url_fichier").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Projet (hub central) ----------
// Relie Client + Appareil(s) + Prestation(s) + Technicien(s) et porte le
// suivi de validation ISO. Règle d'intégrité : un Projet a toujours un
// Client (le "pour qui") -> clientId NOT NULL + RESTRICT.
export const projets = pgTable(
  "projets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: varchar("reference", { length: 40 }).notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    titre: varchar("titre", { length: 200 }).notNull(),
    description: text("description"),
    statut: statutProjetEnum("statut").notNull().default("cree"),
    responsableId: uuid("responsable_id").references(() => users.id, { onDelete: "set null" }),
    dateDebutPrevue: timestamp("date_debut_prevue"),
    dateFinPrevue: timestamp("date_fin_prevue"),
    // Phase 6 : l'Appareil n'étant plus rattaché à un Site, c'est désormais
    // le Projet qui porte l'adresse d'intervention et le contact sur place.
    adresse: text("adresse"),
    instructionsAcces: text("instructions_acces"),
    contactNom: varchar("contact_nom", { length: 150 }),
    contactTelephone: varchar("contact_telephone", { length: 40 }),
    // Phase 13 : nature du projet (installation, maintenance, modernisation, réparation)
    typeProjet: varchar("type_projet", { length: 40 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("projets_reference_idx").on(t.reference)]
);

// Liaison many-to-many Projet <-> Appareil (un Projet peut couvrir plusieurs
// ascenseurs, ex. installation d'un immeuble entier).
export const projetAppareils = pgTable(
  "projet_appareils",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projetId: uuid("projet_id")
      .notNull()
      .references(() => projets.id, { onDelete: "cascade" }),
    appareilId: uuid("appareil_id")
      .notNull()
      .references(() => appareils.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("projet_appareils_idx").on(t.projetId, t.appareilId)]
);

// Liaison Projet <-> Technicien. C'est l'insertion dans cette table qui
// déclenche l'envoi de l'ordre de mission par email (voir src/lib/mail.ts).
export const projetTechniciens = pgTable(
  "projet_techniciens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projetId: uuid("projet_id")
      .notNull()
      .references(() => projets.id, { onDelete: "cascade" }),
    technicienId: uuid("technicien_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: varchar("role", { length: 120 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("projet_techniciens_idx").on(t.projetId, t.technicienId)]
);

// ---------- Catalogue de prestations (Phase 6) ----------
// Catalogue indépendant (au même titre que garantieFormules) : une
// prestation instanciée sur un Projet référence désormais une entrée de ce
// catalogue plutôt qu'un simple type texte libre.
export const prestationsCatalogue = pgTable("prestations_catalogue", {
  id: uuid("id").primaryKey().defaultRandom(),
  nom: varchar("nom", { length: 200 }).notNull(),
  categorie: categoriePrestationEnum("categorie").notNull().default("autre"),
  description: text("description"),
  prixIndicatif: numeric("prix_indicatif"),
  actif: integer("actif").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Prestation ----------
// N'existe que rattachée à un Projet (pas de fiche autonome), mais reste
// listable/filtrable indépendamment via /responsable/prestations.
export const prestations = pgTable("prestations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projetId: uuid("projet_id")
    .notNull()
    .references(() => projets.id, { onDelete: "cascade" }),
  // Phase 6 : le "type" texte libre est remplacé par un rattachement au
  // catalogue de prestations. La colonne `type` est conservée nullable pour
  // l'affichage rétro-compatible des prestations créées avant Phase 6.
  type: prestationTypeEnum("type"),
  catalogueId: uuid("catalogue_id").references(() => prestationsCatalogue.id, {
    onDelete: "set null",
  }),
  // Rattachement à une pièce de stock quand la prestation catalogue est une
  // "vente_piece" — permet de tracer la sortie de stock correspondante.
  pieceId: uuid("piece_id").references(() => pieces.id, { onDelete: "set null" }),
  description: text("description"),
  quantitePieces: integer("quantite_pieces"),
  prixEstime: numeric("prix_estime"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Garantie ----------
// Catalogue de formules (créées par l'utilisateur) : durée, nombre
// d'interventions incluses (total sur la durée), prix, option d'extension.
export const garantieFormules = pgTable("garantie_formules", {
  id: uuid("id").primaryKey().defaultRandom(),
  nom: varchar("nom", { length: 160 }).notNull(),
  dureeMois: integer("duree_mois").notNull(),
  nombreInterventionsInclues: integer("nombre_interventions_inclues").notNull(),
  prix: numeric("prix").notNull(),
  optionExtensionDisponible: integer("option_extension_disponible").notNull().default(0),
  prixExtension: numeric("prix_extension"),
  actif: integer("actif").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Instance de garantie choisie à la création d'un Projet (une seule par
// Projet). interventionsIncluses/interventionsRestantes sont copiés depuis
// la formule au moment de la création pour ne jamais changer rétroactivement
// une garantie déjà accordée si la formule est modifiée plus tard.
export const garanties = pgTable(
  "garanties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projetId: uuid("projet_id")
      .notNull()
      .references(() => projets.id, { onDelete: "cascade" }),
    formuleId: uuid("formule_id").references(() => garantieFormules.id, { onDelete: "set null" }),
    dateDebut: timestamp("date_debut").notNull().defaultNow(),
    dateFin: timestamp("date_fin").notNull(),
    interventionsIncluses: integer("interventions_inclues").notNull(),
    interventionsRestantes: integer("interventions_restantes").notNull(),
    extensionActivee: integer("extension_activee").notNull().default(0),
    dateExtensionAppliquee: timestamp("date_extension_appliquee"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("garanties_projet_idx").on(t.projetId)]
);

// ---------- Relations Phase 5 ----------
export const technicienFichesRelations = relations(technicienFiches, ({ one }) => ({
  technicien: one(users, { fields: [technicienFiches.technicienId], references: [users.id] }),
  siteRattachement: one(sites, {
    fields: [technicienFiches.siteRattachementId],
    references: [sites.id],
  }),
}));

export const technicienDocumentsRelations = relations(technicienDocuments, ({ one }) => ({
  technicien: one(users, { fields: [technicienDocuments.technicienId], references: [users.id] }),
}));

export const projetsRelations = relations(projets, ({ one, many }) => ({
  client: one(clients, { fields: [projets.clientId], references: [clients.id] }),
  responsable: one(users, { fields: [projets.responsableId], references: [users.id] }),
  appareils: many(projetAppareils),
  techniciens: many(projetTechniciens),
  prestations: many(prestations),
  garantie: many(garanties),
  interventions: many(interventions),
}));

export const projetAppareilsRelations = relations(projetAppareils, ({ one }) => ({
  projet: one(projets, { fields: [projetAppareils.projetId], references: [projets.id] }),
  appareil: one(appareils, { fields: [projetAppareils.appareilId], references: [appareils.id] }),
}));

export const projetTechniciensRelations = relations(projetTechniciens, ({ one }) => ({
  projet: one(projets, { fields: [projetTechniciens.projetId], references: [projets.id] }),
  technicien: one(users, { fields: [projetTechniciens.technicienId], references: [users.id] }),
}));

export const prestationsRelations = relations(prestations, ({ one }) => ({
  projet: one(projets, { fields: [prestations.projetId], references: [projets.id] }),
  catalogue: one(prestationsCatalogue, {
    fields: [prestations.catalogueId],
    references: [prestationsCatalogue.id],
  }),
  piece: one(pieces, { fields: [prestations.pieceId], references: [pieces.id] }),
}));

export const prestationsCatalogueRelations = relations(prestationsCatalogue, ({ many }) => ({
  prestations: many(prestations),
}));

export const garantieFormulesRelations = relations(garantieFormules, ({ many }) => ({
  garanties: many(garanties),
}));

export const garantiesRelations = relations(garanties, ({ one }) => ({
  projet: one(projets, { fields: [garanties.projetId], references: [projets.id] }),
  formule: one(garantieFormules, { fields: [garanties.formuleId], references: [garantieFormules.id] }),
}));

export const rapportPhotosRelations = relations(rapportPhotos, ({ one }) => ({
  rapport: one(rapports, { fields: [rapportPhotos.rapportId], references: [rapports.id] }),
}));

// ---------- Relations (pour les requêtes imbriquées Drizzle) ----------
export const clientsRelations = relations(clients, ({ many, one }) => ({
  sites: many(sites),
  contacts: many(contactsClient),
  commercialResponsable: one(users, {
    fields: [clients.commercialResponsableId],
    references: [users.id],
  }),
  nonConformites: many(nonConformites),
  devis: many(devis),
  enquetesSatisfaction: many(enquetesSatisfaction),
  reclamations: many(reclamationsClient),
}));

export const sitesRelations = relations(sites, ({ one, many }) => ({
  client: one(clients, { fields: [sites.clientId], references: [clients.id] }),
  appareils: many(appareils),
  nonConformites: many(nonConformites),
  devis: many(devis),
  reclamations: many(reclamationsClient),
}));

export const appareilsRelations = relations(appareils, ({ one, many }) => ({
  site: one(sites, { fields: [appareils.siteId], references: [sites.id] }),
  interventions: many(interventions),
  reglesPlanification: many(reglesPlanification),
  nonConformites: many(nonConformites),
}));

export const interventionsRelations = relations(interventions, ({ one, many }) => ({
  appareil: one(appareils, { fields: [interventions.appareilId], references: [appareils.id] }),
  technicien: one(users, { fields: [interventions.technicienId], references: [users.id] }),
  projet: one(projets, { fields: [interventions.projetId], references: [projets.id] }),
  rapport: many(rapports),
  nonConformites: many(nonConformites),
  mouvementsStock: many(mouvementsStock),
  demandesAide: many(demandesAide),
}));

export const rapportsRelations = relations(rapports, ({ one, many }) => ({
  intervention: one(interventions, {
    fields: [rapports.interventionId],
    references: [interventions.id],
  }),
  valuePar: one(users, { fields: [rapports.valideParId], references: [users.id] }),
  checklistModele: one(checklistModeles, {
    fields: [rapports.checklistModeleId],
    references: [checklistModeles.id],
  }),
  checklistReponses: many(rapportChecklistReponses),
  photos: many(rapportPhotos),
}));

export const usersRelations = relations(users, ({ many }) => ({
  interventionsAffectees: many(interventions),
  habilitations: many(habilitationsTechnicien),
  formationsConsultees: many(formationsConsultations),
  fiche: many(technicienFiches),
  documentsRh: many(technicienDocuments),
  projetsAffectes: many(projetTechniciens),
}));

// ---------- Relations Phase 2 / 3 ----------
export const checklistModelesRelations = relations(checklistModeles, ({ many }) => ({
  items: many(checklistItems),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one, many }) => ({
  modele: one(checklistModeles, {
    fields: [checklistItems.modeleId],
    references: [checklistModeles.id],
  }),
  reponses: many(rapportChecklistReponses),
}));

export const rapportChecklistReponsesRelations = relations(
  rapportChecklistReponses,
  ({ one }) => ({
    rapport: one(rapports, { fields: [rapportChecklistReponses.rapportId], references: [rapports.id] }),
    item: one(checklistItems, {
      fields: [rapportChecklistReponses.itemId],
      references: [checklistItems.id],
    }),
  })
);

export const nonConformitesRelations = relations(nonConformites, ({ one }) => ({
  client: one(clients, { fields: [nonConformites.clientId], references: [clients.id] }),
  site: one(sites, { fields: [nonConformites.siteId], references: [sites.id] }),
  appareil: one(appareils, { fields: [nonConformites.appareilId], references: [appareils.id] }),
  intervention: one(interventions, {
    fields: [nonConformites.interventionId],
    references: [interventions.id],
  }),
  declarant: one(users, { fields: [nonConformites.declarantId], references: [users.id] }),
  responsableAction: one(users, {
    fields: [nonConformites.responsableActionId],
    references: [users.id],
  }),
}));

export const reglesPlanificationRelations = relations(reglesPlanification, ({ one }) => ({
  appareil: one(appareils, {
    fields: [reglesPlanification.appareilId],
    references: [appareils.id],
  }),
  garantie: one(garanties, {
    fields: [reglesPlanification.garantieId],
    references: [garanties.id],
  }),
}));

export const auditeursRelations = relations(auditeurs, ({ many }) => ({
  audits: many(audits),
}));

export const auditsRelations = relations(audits, ({ one, many }) => ({
  auditeurFiche: one(auditeurs, {
    fields: [audits.auditeurFicheId],
    references: [auditeurs.id],
  }),
  documents: many(documentsFormations),
}));

export const documentsFormationsRelations = relations(documentsFormations, ({ one, many }) => ({
  appareil: one(appareils, {
    fields: [documentsFormations.appareilId],
    references: [appareils.id],
  }),
  projet: one(projets, {
    fields: [documentsFormations.projetId],
    references: [projets.id],
  }),
  audit: one(audits, {
    fields: [documentsFormations.auditId],
    references: [audits.id],
  }),
  piece: one(pieces, {
    fields: [documentsFormations.pieceId],
    references: [pieces.id],
  }),
  habilitations: many(habilitationsTechnicien),
  consultations: many(formationsConsultations),
}));

export const habilitationsTechnicienRelations = relations(habilitationsTechnicien, ({ one }) => ({
  technicien: one(users, { fields: [habilitationsTechnicien.technicienId], references: [users.id] }),
  document: one(documentsFormations, {
    fields: [habilitationsTechnicien.documentId],
    references: [documentsFormations.id],
  }),
}));

export const formationsConsultationsRelations = relations(
  formationsConsultations,
  ({ one }) => ({
    technicien: one(users, {
      fields: [formationsConsultations.technicienId],
      references: [users.id],
    }),
    document: one(documentsFormations, {
      fields: [formationsConsultations.documentId],
      references: [documentsFormations.id],
    }),
  })
);

export const piecesRelations = relations(pieces, ({ many }) => ({
  mouvements: many(mouvementsStock),
  documents: many(documentsFormations),
}));

export const mouvementsStockRelations = relations(mouvementsStock, ({ one }) => ({
  piece: one(pieces, { fields: [mouvementsStock.pieceId], references: [pieces.id] }),
  intervention: one(interventions, {
    fields: [mouvementsStock.interventionId],
    references: [interventions.id],
  }),
  projet: one(projets, { fields: [mouvementsStock.projetId], references: [projets.id] }),
  effectuePar: one(users, { fields: [mouvementsStock.effectueParId], references: [users.id] }),
}));

export const devisRelations = relations(devis, ({ one }) => ({
  client: one(clients, { fields: [devis.clientId], references: [clients.id] }),
  site: one(sites, { fields: [devis.siteId], references: [sites.id] }),
}));

export const enquetesSatisfactionRelations = relations(enquetesSatisfaction, ({ one }) => ({
  client: one(clients, { fields: [enquetesSatisfaction.clientId], references: [clients.id] }),
  intervention: one(interventions, {
    fields: [enquetesSatisfaction.interventionId],
    references: [interventions.id],
  }),
}));

export const reclamationsClientRelations = relations(reclamationsClient, ({ one }) => ({
  client: one(clients, { fields: [reclamationsClient.clientId], references: [clients.id] }),
  site: one(sites, { fields: [reclamationsClient.siteId], references: [sites.id] }),
}));

// ==========================================================================
// PHASE 6 — Fiche RH, Appareil indépendant, Documents, Interventions,
// Besoin d'aide, Prestations catalogue, Stock technicien
// ==========================================================================

// ---------- "Besoin d'aide" (technicien -> bureau) ----------
export const demandesAide = pgTable("demandes_aide", {
  id: uuid("id").primaryKey().defaultRandom(),
  interventionId: uuid("intervention_id")
    .notNull()
    .references(() => interventions.id, { onDelete: "cascade" }),
  technicienId: uuid("technicien_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  message: text("message"),
  resolue: integer("resolue").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const demandesAideRelations = relations(demandesAide, ({ one }) => ({
  intervention: one(interventions, {
    fields: [demandesAide.interventionId],
    references: [interventions.id],
  }),
  technicien: one(users, { fields: [demandesAide.technicienId], references: [users.id] }),
}));

// ==========================================================================
// PHASE 7 — Ordre de mission enrichi (message libre + documents joints)
// ==========================================================================

// Historique des envois d'ordre de mission (affectation initiale ou renvoi
// manuel depuis la fiche Projet) — table strictement en ajout, jamais mise à
// jour, pour garder une trace de chaque message envoyé à un technicien.
export const ordresMissionEnvois = pgTable("ordres_mission_envois", {
  id: uuid("id").primaryKey().defaultRandom(),
  projetId: uuid("projet_id")
    .notNull()
    .references(() => projets.id, { onDelete: "cascade" }),
  technicienId: uuid("technicien_id").references(() => users.id, { onDelete: "set null" }),
  message: text("message"),
  documentsJointIds: uuid("documents_joint_ids").array().default([]),
  envoyeParId: uuid("envoye_par_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ordresMissionEnvoisRelations = relations(ordresMissionEnvois, ({ one }) => ({
  projet: one(projets, { fields: [ordresMissionEnvois.projetId], references: [projets.id] }),
  technicien: one(users, { fields: [ordresMissionEnvois.technicienId], references: [users.id] }),
  envoyePar: one(users, { fields: [ordresMissionEnvois.envoyeParId], references: [users.id] }),
}));

// ==========================================================================
// SOUS-TRAITANCE — heures déclarées par les techniciens pour un client de
// type "sous_traitance" (suivi simple : date, durée, commentaire). Sert
// d'historique pour la facturation (faite dans Odoo, non synchronisée).
// La durée est stockée en minutes (entier) pour éviter les arrondis.
// ==========================================================================
export const heuresSousTraitance = pgTable(
  "heures_sous_traitance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    technicienId: uuid("technicien_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    dateTravail: date("date_travail", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull(),
    commentaire: text("commentaire"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("heures_st_technicien_idx").on(t.technicienId),
    index("heures_st_client_idx").on(t.clientId),
    index("heures_st_date_idx").on(t.dateTravail),
  ]
);

export const heuresSousTraitanceRelations = relations(heuresSousTraitance, ({ one }) => ({
  technicien: one(users, { fields: [heuresSousTraitance.technicienId], references: [users.id] }),
  client: one(clients, { fields: [heuresSousTraitance.clientId], references: [clients.id] }),
}));
