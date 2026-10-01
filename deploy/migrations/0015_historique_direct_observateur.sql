-- Phase 18 : historique technicien (modification 24 h), mission en direct,
-- validation des rapports par le bureau, espace Observateur (QR code).

-- 1. Rapports modifiables 24 h + validation bureau
ALTER TABLE "rapports" ADD COLUMN IF NOT EXISTS "modifie_le" timestamp;
ALTER TABLE "rapports" ADD COLUMN IF NOT EXISTS "nb_modifications" integer NOT NULL DEFAULT 0;
ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "validee_le" timestamp;
ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "validee_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

-- 2. Fil de mission (photos + notes envoyées pendant l'intervention)
CREATE TABLE IF NOT EXISTS "mission_journal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intervention_id" uuid NOT NULL REFERENCES "interventions"("id") ON DELETE CASCADE,
  "auteur_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "texte" text,
  "photos" text[] NOT NULL DEFAULT '{}',
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "mission_journal_intervention_idx" ON "mission_journal" ("intervention_id", "created_at");

-- 3. Observateur
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'observateur';

CREATE TABLE IF NOT EXISTS "observateurs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE RESTRICT,
  "modele" varchar(40),
  "droits" text[] NOT NULL DEFAULT '{}',
  "date_fin" timestamp,
  "cree_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "observateurs_user_idx" ON "observateurs" ("user_id");
CREATE INDEX IF NOT EXISTS "observateurs_client_idx" ON "observateurs" ("client_id");

CREATE TABLE IF NOT EXISTS "observateur_appareils" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "observateur_id" uuid NOT NULL REFERENCES "observateurs"("id") ON DELETE CASCADE,
  "appareil_id" uuid NOT NULL REFERENCES "appareils"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "observateur_appareils_idx" ON "observateur_appareils" ("observateur_id", "appareil_id");
CREATE INDEX IF NOT EXISTS "observateur_appareils_appareil_idx" ON "observateur_appareils" ("appareil_id");

ALTER TABLE "appareils" ADD COLUMN IF NOT EXISTS "qr_code" varchar(32);
CREATE UNIQUE INDEX IF NOT EXISTS "appareils_qr_code_idx" ON "appareils" ("qr_code");

ALTER TABLE "documents_formations" ADD COLUMN IF NOT EXISTS "visible_observateur" integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "signalements_panne" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "appareil_id" uuid NOT NULL REFERENCES "appareils"("id") ON DELETE RESTRICT,
  "auteur_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "nom" varchar(160),
  "telephone" varchar(40),
  "description" text NOT NULL,
  "intervention_id" uuid REFERENCES "interventions"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "signalements_panne_appareil_idx" ON "signalements_panne" ("appareil_id", "created_at");

ALTER TABLE "enquetes_satisfaction" ADD COLUMN IF NOT EXISTS "auteur_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "parametres" (
  "cle" varchar(80) PRIMARY KEY NOT NULL,
  "valeur" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
