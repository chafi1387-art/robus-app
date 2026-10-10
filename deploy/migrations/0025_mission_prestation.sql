-- Phase 29 : mission « à la carte » liée à une prestation (nettoyage, démolition, câblage…).
-- Une mission vise désormais un appareil OU une prestation ponctuelle de son projet.
-- Les missions existantes (toutes liées à un appareil) ne changent pas.

ALTER TABLE "interventions" ALTER COLUMN "appareil_id" DROP NOT NULL;

ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "prestation_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interventions_prestation_id_fk') THEN
    ALTER TABLE "interventions"
      ADD CONSTRAINT "interventions_prestation_id_fk"
      FOREIGN KEY ("prestation_id") REFERENCES "prestations"("id") ON DELETE RESTRICT;
  END IF;
  -- Toujours une cible : un appareil, ou une prestation.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interventions_cible_chk') THEN
    ALTER TABLE "interventions"
      ADD CONSTRAINT "interventions_cible_chk"
      CHECK ("appareil_id" IS NOT NULL OR "prestation_id" IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "interventions_prestation_idx" ON "interventions" ("prestation_id");
