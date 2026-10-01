-- Phase 17 : suivi de l'envoi des missions (accusé de réception) + index de performance.
ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "envoyee_le" timestamp;
ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "vue_le" timestamp;
ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "acceptee_le" timestamp;
ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "envoi_email" varchar(20);
ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "envoi_push" integer;
ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "alerte_non_vue_le" timestamp;

CREATE INDEX IF NOT EXISTS "interventions_technicien_date_idx" ON "interventions" ("technicien_id", "date_programmee");
CREATE INDEX IF NOT EXISTS "interventions_projet_idx" ON "interventions" ("projet_id");
CREATE INDEX IF NOT EXISTS "interventions_appareil_idx" ON "interventions" ("appareil_id");
CREATE INDEX IF NOT EXISTS "interventions_statut_idx" ON "interventions" ("statut");
CREATE INDEX IF NOT EXISTS "projet_techniciens_technicien_idx" ON "projet_techniciens" ("technicien_id");
CREATE INDEX IF NOT EXISTS "journal_activite_entite_idx" ON "journal_activite" ("entite", "entite_id");
CREATE INDEX IF NOT EXISTS "push_abonnements_user_idx" ON "push_abonnements" ("user_id");
CREATE INDEX IF NOT EXISTS "habilitations_technicien_idx" ON "habilitations_technicien" ("technicien_id");

-- Missions déjà affectées avant cette version : considérées comme envoyées.
-- Celles pas encore commencées apparaissent au technicien dans « Nouvelles missions »
-- (vue_le reste vide) mais sans alerte « non vue » rétroactive au bureau.
UPDATE "interventions" SET "envoyee_le" = "created_at", "alerte_non_vue_le" = now()
WHERE "technicien_id" IS NOT NULL AND "envoyee_le" IS NULL;
UPDATE "interventions" SET "vue_le" = COALESCE("date_debut", "created_at")
WHERE "technicien_id" IS NOT NULL AND "vue_le" IS NULL AND "statut" NOT IN ('creee', 'planifiee', 'affectee');
