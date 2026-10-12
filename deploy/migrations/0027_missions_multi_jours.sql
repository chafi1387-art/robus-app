-- Phase 31 : missions sur plusieurs jours (option A) — une seule mission,
-- affichée chaque jour entre la date de début et le dernier jour.
ALTER TABLE interventions ADD COLUMN IF NOT EXISTS date_fin_prevue timestamp;
ALTER TABLE interventions ADD COLUMN IF NOT EXISTS weekend_inclus integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS interventions_fin_prevue_idx ON interventions (date_fin_prevue) WHERE date_fin_prevue IS NOT NULL;
