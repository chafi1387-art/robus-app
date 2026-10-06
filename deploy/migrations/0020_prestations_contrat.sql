-- Phase 24 : la planification passe dans la prestation.
-- Une prestation du catalogue peut être « ponctuelle » ou un « contrat à
-- passages » (durée + nombre de passages, comme la garantie). Ajoutée à un
-- projet, elle crée un échéancier de passages par appareil (au milieu de
-- chaque période) dans la même table que les passages de garantie.

-- 1. Catalogue : mode + paramètres du contrat
ALTER TABLE "prestations_catalogue" ADD COLUMN IF NOT EXISTS "mode" varchar(20) NOT NULL DEFAULT 'ponctuelle';
ALTER TABLE "prestations_catalogue" ADD COLUMN IF NOT EXISTS "duree_mois" integer;
ALTER TABLE "prestations_catalogue" ADD COLUMN IF NOT EXISTS "nb_passages" integer;
ALTER TABLE "prestations_catalogue" ADD COLUMN IF NOT EXISTS "type_mission" "type_intervention";
ALTER TABLE "prestations_catalogue" ADD COLUMN IF NOT EXISTS "anticipation_jours" integer NOT NULL DEFAULT 30;
ALTER TABLE "prestations_catalogue" ADD COLUMN IF NOT EXISTS "checklist_modele_id" uuid REFERENCES "checklist_modeles"("id") ON DELETE SET NULL;

-- 2. Prestation d'un projet : copie figée des paramètres du contrat
ALTER TABLE "prestations" ADD COLUMN IF NOT EXISTS "mode" varchar(20) NOT NULL DEFAULT 'ponctuelle';
ALTER TABLE "prestations" ADD COLUMN IF NOT EXISTS "date_debut" timestamp;
ALTER TABLE "prestations" ADD COLUMN IF NOT EXISTS "date_fin" timestamp;
ALTER TABLE "prestations" ADD COLUMN IF NOT EXISTS "nb_passages" integer;
ALTER TABLE "prestations" ADD COLUMN IF NOT EXISTS "type_mission" "type_intervention";
ALTER TABLE "prestations" ADD COLUMN IF NOT EXISTS "anticipation_jours" integer;
ALTER TABLE "prestations" ADD COLUMN IF NOT EXISTS "checklist_modele_id" uuid REFERENCES "checklist_modeles"("id") ON DELETE SET NULL;
ALTER TABLE "prestations" ADD COLUMN IF NOT EXISTS "statut_contrat" varchar(20);
ALTER TABLE "prestations" ADD COLUMN IF NOT EXISTS "renouvelee_par_id" uuid REFERENCES "prestations"("id") ON DELETE SET NULL;
ALTER TABLE "prestations" ADD COLUMN IF NOT EXISTS "alerte_fin_le" timestamp;
CREATE INDEX IF NOT EXISTS "prestations_projet_idx" ON "prestations" ("projet_id");

-- 3. Appareils couverts par un contrat
CREATE TABLE IF NOT EXISTS "prestation_appareils" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prestation_id" uuid NOT NULL REFERENCES "prestations"("id") ON DELETE CASCADE,
  "appareil_id" uuid NOT NULL REFERENCES "appareils"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "prestation_appareils_idx" ON "prestation_appareils" ("prestation_id", "appareil_id");
CREATE INDEX IF NOT EXISTS "prestation_appareils_appareil_idx" ON "prestation_appareils" ("appareil_id");

-- 4. Passages : une seule table pour la garantie ET les contrats
ALTER TABLE "garantie_passages" ALTER COLUMN "garantie_id" DROP NOT NULL;
ALTER TABLE "garantie_passages" ADD COLUMN IF NOT EXISTS "prestation_id" uuid REFERENCES "prestations"("id") ON DELETE CASCADE;
DO $$ BEGIN
  ALTER TABLE "garantie_passages" ADD CONSTRAINT "garantie_passages_source_chk" CHECK (num_nonnulls("garantie_id", "prestation_id") = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "garantie_passages_prestation_idx" ON "garantie_passages" ("prestation_id", "appareil_id", "numero");
CREATE INDEX IF NOT EXISTS "garantie_passages_appareil_idx" ON "garantie_passages" ("appareil_id");

-- 5. Les anciennes règles de planification (par appareil) ne génèrent plus rien.
UPDATE "regles_planification" SET "actif" = 0 WHERE "actif" = 1;
