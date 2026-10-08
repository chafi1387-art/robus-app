-- Phase 25b : devis dans la mission.
-- Le technicien signale qu'un devis est nécessaire, le bureau le prépare
-- (lignes saisies dans ROBUS ou devis déjà prêt joint en PDF), l'envoie par
-- email et/ou dans l'espace observateur (prix visible ou non, peut accepter
-- ou non, au choix pour chaque destinataire). Une fois accepté, la MÊME
-- mission repart (2e passage) avec le même technicien ou un autre.

ALTER TYPE statut_devis ADD VALUE IF NOT EXISTS 'a_preparer' BEFORE 'brouillon';
ALTER TYPE statut_devis ADD VALUE IF NOT EXISTS 'realise';
ALTER TYPE statut_devis ADD VALUE IF NOT EXISTS 'annule';

ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "intervention_id" uuid REFERENCES "interventions"("id") ON DELETE SET NULL;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "appareil_id" uuid REFERENCES "appareils"("id") ON DELETE SET NULL;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "projet_id" uuid REFERENCES "projets"("id") ON DELETE SET NULL;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "titre" varchar(200);
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "mode" varchar(20) NOT NULL DEFAULT 'lignes';
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "document_url" text;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "document_nom" varchar(200);
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "message" text;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "besoin_technicien" text;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "demande_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "cree_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "envoye_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "validite_jours" integer NOT NULL DEFAULT 30;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "decide_le" timestamp;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "decide_par_nom" varchar(150);
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "decide_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "decide_canal" varchar(20);
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "motif_refus" text;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "relance_le" timestamp;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "travaux_planifies_le" timestamp;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "realise_le" timestamp;
ALTER TABLE "devis" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS "devis_intervention_idx" ON "devis" ("intervention_id");
CREATE INDEX IF NOT EXISTS "devis_appareil_idx" ON "devis" ("appareil_id");
-- Numéro de devis unique (DEV-AAAA-NNNN)
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "devis_numero_idx" ON "devis" ("numero");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Numéros de devis en double : index unique non créé';
END $$;

CREATE TABLE IF NOT EXISTS "devis_lignes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "devis_id" uuid NOT NULL REFERENCES "devis"("id") ON DELETE CASCADE,
  "ordre" integer NOT NULL DEFAULT 0,
  "designation" text NOT NULL,
  "quantite" numeric NOT NULL DEFAULT 1,
  "prix_unitaire_ht" numeric,
  "piece_id" uuid REFERENCES "pieces"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "devis_lignes_devis_idx" ON "devis_lignes" ("devis_id");

CREATE TABLE IF NOT EXISTS "devis_destinataires" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "devis_id" uuid NOT NULL REFERENCES "devis"("id") ON DELETE CASCADE,
  "canal" varchar(20) NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "email" varchar(200),
  "nom" varchar(150),
  "prix_visible" integer NOT NULL DEFAULT 1,
  "peut_decider" integer NOT NULL DEFAULT 1,
  "jeton_hash" varchar(64),
  "envoye_le" timestamp,
  "envoi_email" varchar(20),
  "vu_le" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "devis_dest_devis_idx" ON "devis_destinataires" ("devis_id");
CREATE INDEX IF NOT EXISTS "devis_dest_user_idx" ON "devis_destinataires" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "devis_dest_jeton_idx" ON "devis_destinataires" ("jeton_hash");

CREATE TABLE IF NOT EXISTS "mission_passages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intervention_id" uuid NOT NULL REFERENCES "interventions"("id") ON DELETE CASCADE,
  "numero" integer NOT NULL,
  "technicien_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "date_programmee" timestamp,
  "date_debut" timestamp,
  "date_fin" timestamp,
  "validee_le" timestamp,
  "validee_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "rapport" jsonb,
  "photos" text[] NOT NULL DEFAULT '{}'::text[],
  "motif" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "mission_passages_numero_idx" ON "mission_passages" ("intervention_id", "numero");

ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "passage" integer NOT NULL DEFAULT 1;

-- Temps réel (fonction de la migration 0021)
DROP TRIGGER IF EXISTS robus_temps_reel ON "devis_destinataires";
CREATE TRIGGER robus_temps_reel AFTER INSERT OR UPDATE OR DELETE ON "devis_destinataires" FOR EACH ROW EXECUTE FUNCTION robus_notifier_changement();
DROP TRIGGER IF EXISTS robus_temps_reel ON "mission_passages";
CREATE TRIGGER robus_temps_reel AFTER INSERT OR UPDATE OR DELETE ON "mission_passages" FOR EACH ROW EXECUTE FUNCTION robus_notifier_changement();
