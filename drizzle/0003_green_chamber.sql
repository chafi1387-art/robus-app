CREATE TYPE "public"."prestation_type" AS ENUM('installation', 'reparation', 'garantie', 'maintenance_preventive', 'maintenance_corrective', 'maintenance_systematique', 'vente_piece');--> statement-breakpoint
CREATE TYPE "public"."statut_projet" AS ENUM('cree', 'planifie', 'en_cours', 'termine', 'valide_iso');--> statement-breakpoint
CREATE TABLE "garantie_formules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" varchar(160) NOT NULL,
	"duree_mois" integer NOT NULL,
	"nombre_interventions_inclues" integer NOT NULL,
	"prix" numeric NOT NULL,
	"option_extension_disponible" integer DEFAULT 0 NOT NULL,
	"prix_extension" numeric,
	"actif" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "garanties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projet_id" uuid NOT NULL,
	"formule_id" uuid,
	"date_debut" timestamp DEFAULT now() NOT NULL,
	"date_fin" timestamp NOT NULL,
	"interventions_inclues" integer NOT NULL,
	"interventions_restantes" integer NOT NULL,
	"extension_activee" integer DEFAULT 0 NOT NULL,
	"date_extension_appliquee" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projet_id" uuid NOT NULL,
	"type" "prestation_type" NOT NULL,
	"description" text,
	"quantite_pieces" integer,
	"prix_estime" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projet_appareils" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projet_id" uuid NOT NULL,
	"appareil_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projet_techniciens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projet_id" uuid NOT NULL,
	"technicien_id" uuid NOT NULL,
	"role" varchar(120),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(40) NOT NULL,
	"client_id" uuid NOT NULL,
	"titre" varchar(200) NOT NULL,
	"description" text,
	"statut" "statut_projet" DEFAULT 'cree' NOT NULL,
	"responsable_id" uuid,
	"date_debut_prevue" timestamp,
	"date_fin_prevue" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rapport_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rapport_id" uuid NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technicien_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"technicien_id" uuid NOT NULL,
	"titre" varchar(200) NOT NULL,
	"url_fichier" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technicien_fiches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"technicien_id" uuid NOT NULL,
	"photo_url" text,
	"date_naissance" timestamp,
	"contact_urgence_nom" varchar(160),
	"contact_urgence_telephone" varchar(40),
	"site_rattachement_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "projet_id" uuid;--> statement-breakpoint
ALTER TABLE "regles_planification" ADD COLUMN "garantie_id" uuid;--> statement-breakpoint
ALTER TABLE "garanties" ADD CONSTRAINT "garanties_projet_id_projets_id_fk" FOREIGN KEY ("projet_id") REFERENCES "public"."projets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garanties" ADD CONSTRAINT "garanties_formule_id_garantie_formules_id_fk" FOREIGN KEY ("formule_id") REFERENCES "public"."garantie_formules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestations" ADD CONSTRAINT "prestations_projet_id_projets_id_fk" FOREIGN KEY ("projet_id") REFERENCES "public"."projets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projet_appareils" ADD CONSTRAINT "projet_appareils_projet_id_projets_id_fk" FOREIGN KEY ("projet_id") REFERENCES "public"."projets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projet_appareils" ADD CONSTRAINT "projet_appareils_appareil_id_appareils_id_fk" FOREIGN KEY ("appareil_id") REFERENCES "public"."appareils"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projet_techniciens" ADD CONSTRAINT "projet_techniciens_projet_id_projets_id_fk" FOREIGN KEY ("projet_id") REFERENCES "public"."projets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projet_techniciens" ADD CONSTRAINT "projet_techniciens_technicien_id_users_id_fk" FOREIGN KEY ("technicien_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projets" ADD CONSTRAINT "projets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projets" ADD CONSTRAINT "projets_responsable_id_users_id_fk" FOREIGN KEY ("responsable_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapport_photos" ADD CONSTRAINT "rapport_photos_rapport_id_rapports_id_fk" FOREIGN KEY ("rapport_id") REFERENCES "public"."rapports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technicien_documents" ADD CONSTRAINT "technicien_documents_technicien_id_users_id_fk" FOREIGN KEY ("technicien_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technicien_fiches" ADD CONSTRAINT "technicien_fiches_technicien_id_users_id_fk" FOREIGN KEY ("technicien_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technicien_fiches" ADD CONSTRAINT "technicien_fiches_site_rattachement_id_sites_id_fk" FOREIGN KEY ("site_rattachement_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "garanties_projet_idx" ON "garanties" USING btree ("projet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projet_appareils_idx" ON "projet_appareils" USING btree ("projet_id","appareil_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projet_techniciens_idx" ON "projet_techniciens" USING btree ("projet_id","technicien_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projets_reference_idx" ON "projets" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "technicien_fiches_technicien_idx" ON "technicien_fiches" USING btree ("technicien_id");--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_projet_id_projets_id_fk" FOREIGN KEY ("projet_id") REFERENCES "public"."projets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regles_planification" ADD CONSTRAINT "regles_planification_garantie_id_garanties_id_fk" FOREIGN KEY ("garantie_id") REFERENCES "public"."garanties"("id") ON DELETE set null ON UPDATE no action;