-- Phase 26 : « depuis quand l'appareil est à l'arrêt ».
-- Chaque changement d'état d'un appareil (quel que soit l'écran ou le
-- traitement qui le fait) est enregistré par la base elle-même : période
-- (début / fin) par état. Sert à afficher « À l'arrêt depuis 2 j 4 h », la
-- disponibilité sur 12 mois et le délai moyen de remise en service.

ALTER TABLE "appareils" ADD COLUMN IF NOT EXISTS "statut_depuis" timestamp;

CREATE TABLE IF NOT EXISTS "appareil_etats" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "appareil_id" uuid NOT NULL REFERENCES "appareils"("id") ON DELETE CASCADE,
  "statut" "statut_appareil" NOT NULL,
  "debut" timestamp NOT NULL DEFAULT now(),
  "fin" timestamp,
  "estime" integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "appareil_etats_appareil_idx" ON "appareil_etats" ("appareil_id", "debut");
CREATE UNIQUE INDEX IF NOT EXISTS "appareil_etats_ouvert_idx" ON "appareil_etats" ("appareil_id") WHERE "fin" IS NULL;

-- Point de départ pour les appareils existants : dernier changement d'état
-- connu dans le journal, sinon dernière panne signalée (si en panne), sinon
-- la création de l'appareil. « estime » = 1 : date reconstituée.
UPDATE "appareils" a SET "statut_depuis" = COALESCE(
  (SELECT max(j."created_at") FROM "journal_activite" j WHERE j."entite" = 'appareil' AND j."entite_id" = a."id" AND j."action" = 'etat_modifie'),
  CASE WHEN a."statut" IN ('en_panne', 'hors_service') THEN
    (SELECT max(d."created_at") FROM "demandes_client" d WHERE d."appareil_id" = a."id" AND d."type" = 'panne')
  END,
  a."created_at"
)
WHERE a."statut_depuis" IS NULL;

INSERT INTO "appareil_etats" ("appareil_id", "statut", "debut", "estime")
SELECT a."id", a."statut", a."statut_depuis", 1
FROM "appareils" a
WHERE NOT EXISTS (SELECT 1 FROM "appareil_etats" e WHERE e."appareil_id" = a."id");

ALTER TABLE "appareils" ALTER COLUMN "statut_depuis" SET DEFAULT now();

CREATE OR REPLACE FUNCTION robus_appareil_etat_avant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.statut_depuis := COALESCE(NEW.statut_depuis, now());
  ELSIF NEW.statut IS DISTINCT FROM OLD.statut THEN
    NEW.statut_depuis := now();
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION robus_appareil_etat_apres() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.statut IS DISTINCT FROM OLD.statut THEN
    UPDATE "appareil_etats" SET "fin" = NEW.statut_depuis WHERE "appareil_id" = NEW.id AND "fin" IS NULL;
    INSERT INTO "appareil_etats" ("appareil_id", "statut", "debut") VALUES (NEW.id, NEW.statut, NEW.statut_depuis);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS robus_appareil_etat_avant ON "appareils";
CREATE TRIGGER robus_appareil_etat_avant BEFORE INSERT OR UPDATE OF "statut" ON "appareils" FOR EACH ROW EXECUTE FUNCTION robus_appareil_etat_avant();
DROP TRIGGER IF EXISTS robus_appareil_etat_apres ON "appareils";
CREATE TRIGGER robus_appareil_etat_apres AFTER INSERT OR UPDATE OF "statut" ON "appareils" FOR EACH ROW EXECUTE FUNCTION robus_appareil_etat_apres();
