CREATE TYPE "public"."priorite" AS ENUM('basse', 'normale', 'haute', 'critique');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('administrateur', 'responsable_qualite', 'technicien', 'commercial');--> statement-breakpoint
CREATE TYPE "public"."statut_appareil" AS ENUM('en_service', 'sous_surveillance', 'en_panne', 'hors_service', 'en_travaux');--> statement-breakpoint
CREATE TYPE "public"."statut_intervention" AS ENUM('creee', 'planifiee', 'affectee', 'en_cours', 'terminee', 'validee', 'cloturee');--> statement-breakpoint
CREATE TYPE "public"."type_client" AS ENUM('copropriete', 'entreprise', 'particulier', 'syndicat');--> statement-breakpoint
CREATE TYPE "public"."type_intervention" AS ENUM('preventive', 'corrective', 'systematique');--> statement-breakpoint
CREATE TABLE "appareils" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"numero_interne" varchar(40) NOT NULL,
	"numero_serie" varchar(80),
	"marque" varchar(80),
	"modele" varchar(80),
	"type_appareil" varchar(80),
	"annee_installation" integer,
	"charge_kg" numeric,
	"vitesse_ms" numeric,
	"niveaux" integer,
	"type_portes" varchar(80),
	"statut" "statut_appareil" DEFAULT 'en_service' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raison_sociale" varchar(200) NOT NULL,
	"type" "type_client" DEFAULT 'copropriete' NOT NULL,
	"commercial_responsable_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts_client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"nom" varchar(160) NOT NULL,
	"fonction" varchar(120),
	"telephone" varchar(40),
	"email" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appareil_id" uuid NOT NULL,
	"technicien_id" uuid,
	"type" "type_intervention" NOT NULL,
	"statut" "statut_intervention" DEFAULT 'creee' NOT NULL,
	"priorite" "priorite" DEFAULT 'normale' NOT NULL,
	"description" text,
	"date_programmee" timestamp,
	"date_debut" timestamp,
	"date_fin" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rapports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intervention_id" uuid NOT NULL,
	"travaux_realises" text,
	"observations" text,
	"temps_passe_minutes" integer,
	"statut_final_appareil" "statut_appareil",
	"date_envoi" timestamp,
	"valide_par_id" uuid,
	"date_validation" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"adresse" text NOT NULL,
	"instructions_acces" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" varchar(160) NOT NULL,
	"email" varchar(200) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"telephone" varchar(40),
	"actif" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appareils" ADD CONSTRAINT "appareils_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_commercial_responsable_id_users_id_fk" FOREIGN KEY ("commercial_responsable_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts_client" ADD CONSTRAINT "contacts_client_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_appareil_id_appareils_id_fk" FOREIGN KEY ("appareil_id") REFERENCES "public"."appareils"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_technicien_id_users_id_fk" FOREIGN KEY ("technicien_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapports" ADD CONSTRAINT "rapports_intervention_id_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapports" ADD CONSTRAINT "rapports_valide_par_id_users_id_fk" FOREIGN KEY ("valide_par_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appareils_numero_interne_idx" ON "appareils" USING btree ("numero_interne");--> statement-breakpoint
CREATE UNIQUE INDEX "rapports_intervention_idx" ON "rapports" USING btree ("intervention_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");