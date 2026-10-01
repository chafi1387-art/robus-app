-- Phase 19 : page Mission (édition bureau, rapport du bureau, notes internes),
-- habilitations & formations, échéancier des passages de garantie.

-- 1. Page Mission
ALTER TABLE "rapports" ADD COLUMN IF NOT EXISTS "corrige_bureau_le" timestamp;
ALTER TABLE "rapports" ADD COLUMN IF NOT EXISTS "corrige_bureau_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "rapport_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intervention_id" uuid NOT NULL REFERENCES "interventions"("id") ON DELETE CASCADE,
  "auteur_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "quoi" varchar(80) NOT NULL,
  "motif" text,
  "avant" jsonb,
  "apres" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "rapport_versions_intervention_idx" ON "rapport_versions" ("intervention_id", "created_at");

CREATE TABLE IF NOT EXISTS "mission_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intervention_id" uuid NOT NULL REFERENCES "interventions"("id") ON DELETE CASCADE,
  "auteur_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "type" varchar(30) NOT NULL,
  "titre" varchar(200),
  "texte" text,
  "fichiers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "visible_client" integer NOT NULL DEFAULT 0,
  "regle_le" timestamp,
  "regle_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "archive_le" timestamp,
  "archive_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "mission_notes_intervention_idx" ON "mission_notes" ("intervention_id", "created_at");

-- 2. Habilitations & formations
CREATE TABLE IF NOT EXISTS "habilitations_catalogue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "nom" varchar(160) NOT NULL,
  "categorie" varchar(40) NOT NULL DEFAULT 'interne',
  "pays" varchar(10),
  "validite_mois" integer,
  "alerte_jours" integer NOT NULL DEFAULT 60,
  "certificat_obligatoire" integer NOT NULL DEFAULT 1,
  "obligatoire" integer NOT NULL DEFAULT 0,
  "types_mission" text[] NOT NULL DEFAULT '{}',
  "marques" text[] NOT NULL DEFAULT '{}',
  "description" text,
  "actif" integer NOT NULL DEFAULT 1,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "habilitations_technicien" ALTER COLUMN "document_id" DROP NOT NULL;
ALTER TABLE "habilitations_technicien" ADD COLUMN IF NOT EXISTS "catalogue_id" uuid REFERENCES "habilitations_catalogue"("id") ON DELETE RESTRICT;
ALTER TABLE "habilitations_technicien" ADD COLUMN IF NOT EXISTS "organisme" varchar(160);
ALTER TABLE "habilitations_technicien" ADD COLUMN IF NOT EXISTS "numero_certificat" varchar(80);
ALTER TABLE "habilitations_technicien" ADD COLUMN IF NOT EXISTS "certificat_url" text;
ALTER TABLE "habilitations_technicien" ADD COLUMN IF NOT EXISTS "statut" varchar(20) NOT NULL DEFAULT 'valide';
ALTER TABLE "habilitations_technicien" ADD COLUMN IF NOT EXISTS "ajoutee_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "habilitations_technicien" ADD COLUMN IF NOT EXISTS "validee_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "habilitations_technicien" ADD COLUMN IF NOT EXISTS "validee_le" timestamp;
ALTER TABLE "habilitations_technicien" ADD COLUMN IF NOT EXISTS "commentaire" text;
ALTER TABLE "habilitations_technicien" ADD COLUMN IF NOT EXISTS "session_id" uuid;
ALTER TABLE "habilitations_technicien" ADD COLUMN IF NOT EXISTS "alertes_envoyees" text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS "habilitations_technicien_catalogue_idx" ON "habilitations_technicien" ("technicien_id", "catalogue_id");

CREATE TABLE IF NOT EXISTS "formations_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "titre" varchar(200) NOT NULL,
  "catalogue_id" uuid REFERENCES "habilitations_catalogue"("id") ON DELETE SET NULL,
  "date_debut" timestamp NOT NULL,
  "duree_heures" numeric,
  "lieu" varchar(20) NOT NULL DEFAULT 'bureau',
  "organisme" varchar(160),
  "programme" text,
  "statut" varchar(20) NOT NULL DEFAULT 'planifiee',
  "cree_par_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "formations_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "formations_sessions"("id") ON DELETE CASCADE,
  "technicien_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "present" integer,
  "resultat" varchar(20),
  "efficacite" varchar(20),
  "efficacite_commentaire" text,
  "efficacite_le" timestamp,
  "habilitation_id" uuid REFERENCES "habilitations_technicien"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "formations_participants_idx" ON "formations_participants" ("session_id", "technicien_id");

-- Catalogue de départ (modifiable / désactivable) : France + Belgique.
INSERT INTO "habilitations_catalogue" ("nom", "categorie", "pays", "validite_mois", "alerte_jours", "certificat_obligatoire", "obligatoire", "types_mission", "description")
SELECT * FROM (VALUES
  ('Habilitation électrique B1V / BR / H0V', 'electrique', 'FR', 36, 60, 1, 1, ARRAY['toutes'], 'Recyclage recommandé tous les 3 ans (à ajuster selon votre organisme).'),
  ('Habilitation électrique BA4 / BA5 (RGIE)', 'electrique', 'BE', NULL, 60, 1, 0, ARRAY[]::text[], 'Attestation de l''employeur ; durée à définir selon votre politique interne.'),
  ('Travail en hauteur / port du harnais', 'hauteur', NULL, 36, 60, 1, 1, ARRAY['toutes'], NULL),
  ('Secourisme (SST / premiers secours)', 'secourisme', NULL, 24, 60, 1, 0, ARRAY[]::text[], NULL),
  ('Désincarcération / sauvetage de personnes bloquées', 'interne', NULL, 12, 30, 0, 1, ARRAY['corrective'], 'Procédure interne ROBUS.'),
  ('Consignation / déconsignation', 'electrique', NULL, 36, 60, 1, 0, ARRAY[]::text[], NULL),
  ('VCA (sécurité chantier)', 'securite', 'BE', 120, 90, 1, 0, ARRAY[]::text[], NULL),
  ('Formation constructeur (marque)', 'constructeur', NULL, NULL, 60, 1, 0, ARRAY[]::text[], 'Dupliquez par marque (Schindler, Otis, Kone…) et indiquez la marque concernée.')
) AS v(nom, categorie, pays, validite_mois, alerte_jours, certificat_obligatoire, obligatoire, types_mission, description)
WHERE NOT EXISTS (SELECT 1 FROM "habilitations_catalogue");

-- 3. Échéancier des passages de garantie (par appareil)
CREATE TABLE IF NOT EXISTS "garantie_passages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "garantie_id" uuid NOT NULL REFERENCES "garanties"("id") ON DELETE CASCADE,
  "appareil_id" uuid NOT NULL REFERENCES "appareils"("id") ON DELETE CASCADE,
  "numero" integer NOT NULL,
  "total" integer NOT NULL,
  "date_prevue" timestamp NOT NULL,
  "date_initiale" timestamp NOT NULL,
  "motif_decalage" text,
  "statut" varchar(20) NOT NULL DEFAULT 'a_venir',
  "intervention_id" uuid REFERENCES "interventions"("id") ON DELETE SET NULL,
  "realise_le" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "garantie_passages_idx" ON "garantie_passages" ("garantie_id", "appareil_id", "numero");
CREATE INDEX IF NOT EXISTS "garantie_passages_date_idx" ON "garantie_passages" ("statut", "date_prevue");

-- Garanties déjà en place : échéancier « milieu de période » pour chaque
-- appareil du projet ; les passages déjà consommés sont comptés comme réalisés.
INSERT INTO "garantie_passages" ("garantie_id", "appareil_id", "numero", "total", "date_prevue", "date_initiale", "statut", "realise_le")
SELECT g.id, pa.appareil_id, s.k, g.interventions_inclues,
  g.date_debut + ((s.k - 0.5) * (g.date_fin - g.date_debut) / g.interventions_inclues),
  g.date_debut + ((s.k - 0.5) * (g.date_fin - g.date_debut) / g.interventions_inclues),
  CASE WHEN s.k <= g.interventions_inclues - g.interventions_restantes THEN 'realise' ELSE 'a_venir' END,
  CASE WHEN s.k <= g.interventions_inclues - g.interventions_restantes THEN now() END
FROM "garanties" g
JOIN "projet_appareils" pa ON pa.projet_id = g.projet_id
CROSS JOIN LATERAL generate_series(1, g.interventions_inclues) AS s(k)
WHERE g.interventions_inclues > 0
  AND NOT EXISTS (SELECT 1 FROM "garantie_passages" gp WHERE gp.garantie_id = g.id);

-- L'ancienne règle de planification « garantie » (premier appareil seulement)
-- est remplacée par l'échéancier : on la désactive pour éviter les doublons.
UPDATE "regles_planification" SET "actif" = 0 WHERE "garantie_id" IS NOT NULL AND "actif" = 1;
