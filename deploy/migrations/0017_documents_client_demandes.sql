-- Phase 20 : documents client par appareil + demandes client (pannes,
-- interventions, questions / réclamations, documents) avec discussion.

-- 1. Documents client (séparés des documents internes)
CREATE TABLE IF NOT EXISTS "documents_client" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "appareil_id" uuid NOT NULL REFERENCES "appareils"("id") ON DELETE CASCADE,
  "titre" varchar(200) NOT NULL,
  "type" varchar(30) NOT NULL DEFAULT 'autre',
  "url" text NOT NULL,
  "nom_fichier" varchar(200),
  "message" text,
  "cree_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "archive_le" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "documents_client_appareil_idx" ON "documents_client" ("appareil_id", "created_at");

CREATE TABLE IF NOT EXISTS "documents_client_consultations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "documents_client"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "premiere_le" timestamp DEFAULT now() NOT NULL,
  "derniere_le" timestamp DEFAULT now() NOT NULL,
  "nb" integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "documents_client_consultations_idx" ON "documents_client_consultations" ("document_id", "user_id");

-- Les documents internes déjà marqués « visible observateur » deviennent des
-- documents client (appareil direct, ou chaque appareil du projet), puis le
-- marquage interne est retiré.
INSERT INTO "documents_client" ("appareil_id", "titre", "type", "url", "nom_fichier", "created_at")
SELECT d.appareil_id, d.titre, 'autre', d.url_fichier, d.titre, d.created_at
FROM "documents_formations" d
WHERE d.visible_observateur = 1 AND d.url_fichier IS NOT NULL AND d.appareil_id IS NOT NULL;
INSERT INTO "documents_client" ("appareil_id", "titre", "type", "url", "nom_fichier", "created_at")
SELECT pa.appareil_id, d.titre, 'autre', d.url_fichier, d.titre, d.created_at
FROM "documents_formations" d
JOIN "projet_appareils" pa ON pa.projet_id = d.projet_id
WHERE d.visible_observateur = 1 AND d.url_fichier IS NOT NULL AND d.appareil_id IS NULL AND d.projet_id IS NOT NULL;
UPDATE "documents_formations" SET "visible_observateur" = 0 WHERE "visible_observateur" = 1;

-- 2. Demandes client
CREATE TABLE IF NOT EXISTS "demandes_client" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "numero" varchar(20) NOT NULL,
  "appareil_id" uuid NOT NULL REFERENCES "appareils"("id") ON DELETE RESTRICT,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "auteur_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "nom" varchar(160),
  "telephone" varchar(40),
  "email" varchar(200),
  "type" varchar(20) NOT NULL,
  "personne_bloquee" integer NOT NULL DEFAULT 0,
  "description" text NOT NULL,
  "photos" text[] NOT NULL DEFAULT '{}',
  "statut" varchar(20) NOT NULL DEFAULT 'nouvelle',
  "priorite" varchar(20) NOT NULL DEFAULT 'normale',
  "intervention_id" uuid REFERENCES "interventions"("id") ON DELETE SET NULL,
  "pris_en_charge_le" timestamp,
  "pris_en_charge_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolue_le" timestamp,
  "cloturee_le" timestamp,
  "resolution" text,
  "note_satisfaction" integer,
  "commentaire_satisfaction" text,
  "rappel_envoye_le" timestamp,
  "origine" varchar(20) NOT NULL DEFAULT 'espace',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "demandes_client_numero_idx" ON "demandes_client" ("numero");
CREATE INDEX IF NOT EXISTS "demandes_client_statut_idx" ON "demandes_client" ("statut", "created_at");
CREATE INDEX IF NOT EXISTS "demandes_client_auteur_idx" ON "demandes_client" ("auteur_id");
CREATE INDEX IF NOT EXISTS "demandes_client_intervention_idx" ON "demandes_client" ("intervention_id");

CREATE TABLE IF NOT EXISTS "demandes_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "demande_id" uuid NOT NULL REFERENCES "demandes_client"("id") ON DELETE CASCADE,
  "auteur_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "auteur_type" varchar(20) NOT NULL,
  "texte" text,
  "fichiers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "demandes_messages_demande_idx" ON "demandes_messages" ("demande_id", "created_at");

-- Pannes déjà signalées (Phase 18) -> demandes client.
INSERT INTO "demandes_client" ("numero", "appareil_id", "client_id", "auteur_id", "nom", "telephone", "type", "description", "statut", "priorite", "intervention_id", "origine", "created_at", "updated_at")
SELECT 'DC-' || to_char(s.created_at, 'YYYY') || '-' || lpad((row_number() over (order by s.created_at))::text, 4, '0'),
  s.appareil_id, p.client_id, s.auteur_id, s.nom, s.telephone, 'panne', s.description,
  CASE WHEN i.statut IN ('terminee','validee','cloturee') THEN 'resolue' WHEN i.technicien_id IS NOT NULL THEN 'planifiee' ELSE 'nouvelle' END,
  'haute', s.intervention_id, CASE WHEN s.auteur_id IS NULL THEN 'qr' ELSE 'espace' END, s.created_at, s.created_at
FROM "signalements_panne" s
LEFT JOIN "interventions" i ON i.id = s.intervention_id
LEFT JOIN "projets" p ON p.id = i.projet_id
WHERE NOT EXISTS (SELECT 1 FROM "demandes_client");

-- 3. Relation client
ALTER TABLE "observateurs" ADD COLUMN IF NOT EXISTS "resume_mensuel" integer NOT NULL DEFAULT 1;
ALTER TABLE "observateurs" ADD COLUMN IF NOT EXISTS "resume_envoye_le" timestamp;
