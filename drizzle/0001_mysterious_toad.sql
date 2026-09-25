CREATE TYPE "public"."categorie_document" AS ENUM('securite', 'installation', 'maintenance', 'depannage', 'marques', 'procedures_robus', 'videos');--> statement-breakpoint
CREATE TYPE "public"."gravite_non_conformite" AS ENUM('mineure', 'majeure', 'critique');--> statement-breakpoint
CREATE TYPE "public"."statut_audit" AS ENUM('planifie', 'en_cours', 'termine');--> statement-breakpoint
CREATE TYPE "public"."statut_devis" AS ENUM('brouillon', 'envoye', 'accepte', 'refuse');--> statement-breakpoint
CREATE TYPE "public"."statut_non_conformite" AS ENUM('ouverte', 'en_cours', 'cloturee');--> statement-breakpoint
CREATE TYPE "public"."statut_risque" AS ENUM('identifie', 'en_traitement', 'maitrise');--> statement-breakpoint
CREATE TYPE "public"."type_audit" AS ENUM('interne', 'externe');--> statement-breakpoint
CREATE TYPE "public"."type_mouvement_stock" AS ENUM('entree', 'sortie');--> statement-breakpoint
CREATE TYPE "public"."type_risque" AS ENUM('risque', 'opportunite');--> statement-breakpoint
CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "type_audit" DEFAULT 'interne' NOT NULL,
	"statut" "statut_audit" DEFAULT 'planifie' NOT NULL,
	"titre" varchar(200) NOT NULL,
	"date_planifiee" timestamp,
	"date_realisation" timestamp,
	"auditeur_id" uuid,
	"constats" text,
	"actions_suivi" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"modele_id" uuid NOT NULL,
	"ordre" integer DEFAULT 0 NOT NULL,
	"libelle" varchar(200) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_modeles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" varchar(200) NOT NULL,
	"type_intervention" "type_intervention",
	"marque" varchar(80),
	"type_appareil" varchar(80),
	"actif" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" varchar(40) NOT NULL,
	"client_id" uuid NOT NULL,
	"site_id" uuid,
	"statut" "statut_devis" DEFAULT 'brouillon' NOT NULL,
	"montant_ht" numeric,
	"description" text,
	"date_envoi" timestamp,
	"date_reponse" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents_formations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"titre" varchar(200) NOT NULL,
	"categorie" "categorie_document" DEFAULT 'maintenance' NOT NULL,
	"type_contenu" varchar(40) DEFAULT 'document' NOT NULL,
	"url_fichier" text,
	"marque" varchar(80),
	"type_appareil_concerne" varchar(80),
	"appareil_id" uuid,
	"est_formation" integer DEFAULT 0 NOT NULL,
	"duree_validite_mois" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquetes_satisfaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"intervention_id" uuid,
	"note" integer NOT NULL,
	"commentaire" text,
	"date_enquete" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formations_consultations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"technicien_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"date_consultation" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "habilitations_technicien" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"technicien_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"date_obtention" timestamp DEFAULT now() NOT NULL,
	"date_expiration" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments_mesure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" varchar(160) NOT NULL,
	"reference" varchar(80),
	"date_dernier_etalonnage" timestamp,
	"periodicite_mois" integer DEFAULT 12 NOT NULL,
	"date_prochain_etalonnage" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_activite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entite" varchar(60) NOT NULL,
	"entite_id" uuid NOT NULL,
	"action" varchar(40) NOT NULL,
	"utilisateur_id" uuid,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mouvements_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"piece_id" uuid NOT NULL,
	"type" "type_mouvement_stock" NOT NULL,
	"quantite" integer NOT NULL,
	"intervention_id" uuid,
	"effectue_par_id" uuid,
	"commentaire" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "non_conformites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"titre" varchar(200) NOT NULL,
	"description" text,
	"gravite" "gravite_non_conformite" DEFAULT 'mineure' NOT NULL,
	"statut" "statut_non_conformite" DEFAULT 'ouverte' NOT NULL,
	"client_id" uuid,
	"site_id" uuid,
	"appareil_id" uuid,
	"intervention_id" uuid,
	"declarant_id" uuid,
	"responsable_action_id" uuid,
	"action_corrective" text,
	"date_echeance" timestamp,
	"date_cloture" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pieces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(80) NOT NULL,
	"nom" varchar(200) NOT NULL,
	"marque" varchar(80),
	"quantite_stock" integer DEFAULT 0 NOT NULL,
	"seuil_alerte" integer DEFAULT 0 NOT NULL,
	"unite" varchar(20) DEFAULT 'unité' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rapport_checklist_reponses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rapport_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"conforme" integer,
	"observation" text
);
--> statement-breakpoint
CREATE TABLE "reclamations_client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"site_id" uuid,
	"description" text NOT NULL,
	"statut" "statut_non_conformite" DEFAULT 'ouverte' NOT NULL,
	"date_reclamation" timestamp DEFAULT now() NOT NULL,
	"date_resolution" timestamp
);
--> statement-breakpoint
CREATE TABLE "regles_planification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appareil_id" uuid NOT NULL,
	"type" "type_intervention" DEFAULT 'preventive' NOT NULL,
	"periodicite_mois" integer NOT NULL,
	"anticipation_jours" integer DEFAULT 15 NOT NULL,
	"prochaine_date" timestamp NOT NULL,
	"actif" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revues_direction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date_revue" timestamp NOT NULL,
	"participants" text,
	"points_abordes" text,
	"decisions" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risques" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "type_risque" DEFAULT 'risque' NOT NULL,
	"titre" varchar(200) NOT NULL,
	"description" text,
	"impact" "priorite" DEFAULT 'normale' NOT NULL,
	"statut" "statut_risque" DEFAULT 'identifie' NOT NULL,
	"plan_actions" text,
	"responsable_id" uuid,
	"date_revue" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_iso_saisies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mois" varchar(7) NOT NULL,
	"bloc" varchar(60) NOT NULL,
	"valeur" numeric NOT NULL,
	"commentaire" text,
	"saisi_par_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rapports" ADD COLUMN "checklist_modele_id" uuid;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_auditeur_id_users_id_fk" FOREIGN KEY ("auditeur_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_modele_id_checklist_modeles_id_fk" FOREIGN KEY ("modele_id") REFERENCES "public"."checklist_modeles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devis" ADD CONSTRAINT "devis_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devis" ADD CONSTRAINT "devis_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents_formations" ADD CONSTRAINT "documents_formations_appareil_id_appareils_id_fk" FOREIGN KEY ("appareil_id") REFERENCES "public"."appareils"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquetes_satisfaction" ADD CONSTRAINT "enquetes_satisfaction_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquetes_satisfaction" ADD CONSTRAINT "enquetes_satisfaction_intervention_id_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formations_consultations" ADD CONSTRAINT "formations_consultations_technicien_id_users_id_fk" FOREIGN KEY ("technicien_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formations_consultations" ADD CONSTRAINT "formations_consultations_document_id_documents_formations_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents_formations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habilitations_technicien" ADD CONSTRAINT "habilitations_technicien_technicien_id_users_id_fk" FOREIGN KEY ("technicien_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habilitations_technicien" ADD CONSTRAINT "habilitations_technicien_document_id_documents_formations_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents_formations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_activite" ADD CONSTRAINT "journal_activite_utilisateur_id_users_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_intervention_id_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_effectue_par_id_users_id_fk" FOREIGN KEY ("effectue_par_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformites" ADD CONSTRAINT "non_conformites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformites" ADD CONSTRAINT "non_conformites_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformites" ADD CONSTRAINT "non_conformites_appareil_id_appareils_id_fk" FOREIGN KEY ("appareil_id") REFERENCES "public"."appareils"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformites" ADD CONSTRAINT "non_conformites_intervention_id_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformites" ADD CONSTRAINT "non_conformites_declarant_id_users_id_fk" FOREIGN KEY ("declarant_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformites" ADD CONSTRAINT "non_conformites_responsable_action_id_users_id_fk" FOREIGN KEY ("responsable_action_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapport_checklist_reponses" ADD CONSTRAINT "rapport_checklist_reponses_rapport_id_rapports_id_fk" FOREIGN KEY ("rapport_id") REFERENCES "public"."rapports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapport_checklist_reponses" ADD CONSTRAINT "rapport_checklist_reponses_item_id_checklist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."checklist_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclamations_client" ADD CONSTRAINT "reclamations_client_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclamations_client" ADD CONSTRAINT "reclamations_client_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regles_planification" ADD CONSTRAINT "regles_planification_appareil_id_appareils_id_fk" FOREIGN KEY ("appareil_id") REFERENCES "public"."appareils"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risques" ADD CONSTRAINT "risques_responsable_id_users_id_fk" FOREIGN KEY ("responsable_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_iso_saisies" ADD CONSTRAINT "score_iso_saisies_saisi_par_id_users_id_fk" FOREIGN KEY ("saisi_par_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pieces_reference_idx" ON "pieces" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "score_iso_mois_bloc_idx" ON "score_iso_saisies" USING btree ("mois","bloc");--> statement-breakpoint
ALTER TABLE "rapports" ADD CONSTRAINT "rapports_checklist_modele_id_checklist_modeles_id_fk" FOREIGN KEY ("checklist_modele_id") REFERENCES "public"."checklist_modeles"("id") ON DELETE set null ON UPDATE no action;