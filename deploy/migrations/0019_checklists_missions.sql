-- Phase 23 : checklists choisies à la création de la mission, cochées en
-- direct par le technicien (✓ conforme / ✗ non conforme + commentaire,
-- mesures avec limites), copie figée par mission (preuve ISO).

-- 1. Modèles : tâches plus riches (section, obligatoire, mesure)
ALTER TABLE "checklist_modeles" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "checklist_modeles" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "checklist_modeles" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "checklist_items" ADD COLUMN IF NOT EXISTS "section" varchar(80);
ALTER TABLE "checklist_items" ADD COLUMN IF NOT EXISTS "obligatoire" integer NOT NULL DEFAULT 1;
ALTER TABLE "checklist_items" ADD COLUMN IF NOT EXISTS "type" varchar(20) NOT NULL DEFAULT 'case';
ALTER TABLE "checklist_items" ADD COLUMN IF NOT EXISTS "unite" varchar(20);
ALTER TABLE "checklist_items" ADD COLUMN IF NOT EXISTS "valeur_min" numeric;
ALTER TABLE "checklist_items" ADD COLUMN IF NOT EXISTS "valeur_max" numeric;
ALTER TABLE "checklist_items" ADD COLUMN IF NOT EXISTS "actif" integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS "checklist_items_modele_idx" ON "checklist_items" ("modele_id", "ordre");

-- 2. Checklists d'une mission (copie du modèle au moment où elle est attribuée)
CREATE TABLE IF NOT EXISTS "mission_checklists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intervention_id" uuid NOT NULL REFERENCES "interventions"("id") ON DELETE CASCADE,
  "modele_id" uuid REFERENCES "checklist_modeles"("id") ON DELETE SET NULL,
  "nom" varchar(200) NOT NULL,
  "version_modele" integer NOT NULL DEFAULT 1,
  "ordre" integer NOT NULL DEFAULT 0,
  "ajoutee_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "mission_checklists_intervention_idx" ON "mission_checklists" ("intervention_id");

CREATE TABLE IF NOT EXISTS "mission_checklist_taches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mission_checklist_id" uuid NOT NULL REFERENCES "mission_checklists"("id") ON DELETE CASCADE,
  "item_id" uuid REFERENCES "checklist_items"("id") ON DELETE SET NULL,
  "ordre" integer NOT NULL DEFAULT 0,
  "section" varchar(80),
  "libelle" varchar(200) NOT NULL,
  "obligatoire" integer NOT NULL DEFAULT 1,
  "type" varchar(20) NOT NULL DEFAULT 'case',
  "unite" varchar(20),
  "valeur_min" numeric,
  "valeur_max" numeric,
  "resultat" varchar(10),
  "valeur" numeric,
  "commentaire" text,
  "rempli_le" timestamp,
  "rempli_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "traite_le" timestamp,
  "traite_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "non_conformite_id" uuid REFERENCES "non_conformites"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "mission_checklist_taches_checklist_idx" ON "mission_checklist_taches" ("mission_checklist_id", "ordre");
CREATE INDEX IF NOT EXISTS "mission_checklist_taches_nok_idx" ON "mission_checklist_taches" ("resultat") WHERE "resultat" = 'nok';
