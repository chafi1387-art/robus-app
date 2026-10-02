-- Phase 21 : technicien complet — refus motivé d'une mission, signalements
-- (accident, véhicule, météo…), formations (réponse, émargement, documents),
-- heures de sous-traitance avec début / fin, index pour la rapidité.

-- 1. Missions : le technicien accepte OU refuse avec un motif (l'admin décide).
ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "refusee_le" timestamp;
ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "refus_motif" varchar(30);
ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "refus_commentaire" text;

-- 2. Signalements du technicien
CREATE TABLE IF NOT EXISTS "signalements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "numero" varchar(20) NOT NULL,
  "technicien_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "type" varchar(30) NOT NULL,
  "description" text NOT NULL,
  "lieu" varchar(200),
  "blesse" integer NOT NULL DEFAULT 0,
  "bloquant" integer NOT NULL DEFAULT 0,
  "gravite" varchar(20) NOT NULL DEFAULT 'normale',
  "photos" text[] NOT NULL DEFAULT '{}'::text[],
  "fichiers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "intervention_id" uuid REFERENCES "interventions"("id") ON DELETE SET NULL,
  "projet_id" uuid REFERENCES "projets"("id") ON DELETE SET NULL,
  "appareil_id" uuid REFERENCES "appareils"("id") ON DELETE SET NULL,
  "statut" varchar(20) NOT NULL DEFAULT 'nouveau',
  "pris_en_charge_le" timestamp,
  "pris_en_charge_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reponse" text,
  "reponse_le" timestamp,
  "cloture_le" timestamp,
  "cloture_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "non_conformite_id" uuid REFERENCES "non_conformites"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "signalements_numero_idx" ON "signalements" ("numero");
CREATE INDEX IF NOT EXISTS "signalements_technicien_idx" ON "signalements" ("technicien_id", "created_at");
CREATE INDEX IF NOT EXISTS "signalements_statut_idx" ON "signalements" ("statut");
CREATE INDEX IF NOT EXISTS "signalements_intervention_idx" ON "signalements" ("intervention_id");
CREATE INDEX IF NOT EXISTS "signalements_projet_idx" ON "signalements" ("projet_id");

-- 3. Heures de sous-traitance : heure de début, de fin et pause
ALTER TABLE "heures_sous_traitance" ADD COLUMN IF NOT EXISTS "heure_debut" varchar(5);
ALTER TABLE "heures_sous_traitance" ADD COLUMN IF NOT EXISTS "heure_fin" varchar(5);
ALTER TABLE "heures_sous_traitance" ADD COLUMN IF NOT EXISTS "pause_minutes" integer NOT NULL DEFAULT 0;

-- 4. Formations : réponse du technicien, émargement, rappel, documents
ALTER TABLE "formations_participants" ADD COLUMN IF NOT EXISTS "reponse" varchar(20);
ALTER TABLE "formations_participants" ADD COLUMN IF NOT EXISTS "reponse_le" timestamp;
ALTER TABLE "formations_participants" ADD COLUMN IF NOT EXISTS "reponse_motif" text;
ALTER TABLE "formations_participants" ADD COLUMN IF NOT EXISTS "emarge_le" timestamp;
ALTER TABLE "formations_participants" ADD COLUMN IF NOT EXISTS "rappel_le" timestamp;
ALTER TABLE "formations_participants" ADD COLUMN IF NOT EXISTS "inscrit_le" timestamp DEFAULT now();
ALTER TABLE "formations_sessions" ADD COLUMN IF NOT EXISTS "motif_annulation" text;
ALTER TABLE "formations_sessions" ADD COLUMN IF NOT EXISTS "cloturee_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "formations_sessions" ADD COLUMN IF NOT EXISTS "cloturee_le" timestamp;
ALTER TABLE "documents_formations" ADD COLUMN IF NOT EXISTS "session_id" uuid REFERENCES "formations_sessions"("id") ON DELETE SET NULL;
ALTER TYPE "categorie_document" ADD VALUE IF NOT EXISTS 'formation';

-- 5. Index (rapidité des fiches, du planning et de la cloche de notifications)
CREATE INDEX IF NOT EXISTS "journal_activite_utilisateur_idx" ON "journal_activite" ("utilisateur_id", "created_at");
CREATE INDEX IF NOT EXISTS "rapport_photos_rapport_idx" ON "rapport_photos" ("rapport_id");
CREATE INDEX IF NOT EXISTS "mouvements_stock_intervention_idx" ON "mouvements_stock" ("intervention_id");
CREATE INDEX IF NOT EXISTS "demandes_aide_intervention_idx" ON "demandes_aide" ("intervention_id");
CREATE INDEX IF NOT EXISTS "non_conformites_intervention_idx" ON "non_conformites" ("intervention_id");
CREATE INDEX IF NOT EXISTS "documents_formations_appareil_idx" ON "documents_formations" ("appareil_id");
CREATE INDEX IF NOT EXISTS "documents_formations_projet_idx" ON "documents_formations" ("projet_id");
CREATE INDEX IF NOT EXISTS "documents_formations_session_idx" ON "documents_formations" ("session_id");
CREATE INDEX IF NOT EXISTS "formations_consultations_technicien_idx" ON "formations_consultations" ("technicien_id", "date_consultation");
CREATE INDEX IF NOT EXISTS "formations_participants_technicien_idx" ON "formations_participants" ("technicien_id");
CREATE INDEX IF NOT EXISTS "technicien_documents_technicien_idx" ON "technicien_documents" ("technicien_id");
CREATE INDEX IF NOT EXISTS "habilitations_technicien_statut_idx" ON "habilitations_technicien" ("statut");
