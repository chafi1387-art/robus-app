CREATE TYPE "public"."categorie_prestation" AS ENUM('installation', 'reparation', 'maintenance', 'vente_piece', 'autre');--> statement-breakpoint
CREATE TYPE "public"."statut_rh_technicien" AS ENUM('actif', 'en_conge', 'arret_maladie', 'en_formation', 'suspendu', 'sorti_effectifs');--> statement-breakpoint
CREATE TABLE "demandes_aide" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intervention_id" uuid NOT NULL,
	"technicien_id" uuid NOT NULL,
	"message" text,
	"resolue" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "prestations_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" varchar(200) NOT NULL,
	"categorie" "categorie_prestation" DEFAULT 'autre' NOT NULL,
	"description" text,
	"prix_indicatif" numeric,
	"actif" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appareils" DROP CONSTRAINT "appareils_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "appareils" ALTER COLUMN "site_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prestations" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents_formations" ADD COLUMN "projet_id" uuid;--> statement-breakpoint
ALTER TABLE "mouvements_stock" ADD COLUMN "projet_id" uuid;--> statement-breakpoint
ALTER TABLE "prestations" ADD COLUMN "catalogue_id" uuid;--> statement-breakpoint
ALTER TABLE "prestations" ADD COLUMN "piece_id" uuid;--> statement-breakpoint
ALTER TABLE "projets" ADD COLUMN "adresse" text;--> statement-breakpoint
ALTER TABLE "projets" ADD COLUMN "instructions_acces" text;--> statement-breakpoint
ALTER TABLE "projets" ADD COLUMN "contact_nom" varchar(150);--> statement-breakpoint
ALTER TABLE "projets" ADD COLUMN "contact_telephone" varchar(40);--> statement-breakpoint
ALTER TABLE "technicien_fiches" ADD COLUMN "date_entree_entreprise" timestamp;--> statement-breakpoint
ALTER TABLE "technicien_fiches" ADD COLUMN "type_contrat" varchar(80);--> statement-breakpoint
ALTER TABLE "technicien_fiches" ADD COLUMN "adresse_domicile" text;--> statement-breakpoint
ALTER TABLE "technicien_fiches" ADD COLUMN "statut_rh" "statut_rh_technicien" DEFAULT 'actif';--> statement-breakpoint
ALTER TABLE "demandes_aide" ADD CONSTRAINT "demandes_aide_intervention_id_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demandes_aide" ADD CONSTRAINT "demandes_aide_technicien_id_users_id_fk" FOREIGN KEY ("technicien_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appareils" ADD CONSTRAINT "appareils_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents_formations" ADD CONSTRAINT "documents_formations_projet_id_projets_id_fk" FOREIGN KEY ("projet_id") REFERENCES "public"."projets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_projet_id_projets_id_fk" FOREIGN KEY ("projet_id") REFERENCES "public"."projets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestations" ADD CONSTRAINT "prestations_catalogue_id_prestations_catalogue_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."prestations_catalogue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestations" ADD CONSTRAINT "prestations_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE set null ON UPDATE no action;