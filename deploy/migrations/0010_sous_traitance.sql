-- Sous-traitance : nouveau type de client + heures déclarées par les techniciens
ALTER TYPE "public"."type_client" ADD VALUE IF NOT EXISTS 'sous_traitance';

CREATE TABLE IF NOT EXISTS "heures_sous_traitance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "technicien_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE restrict,
  "date_travail" date NOT NULL,
  "minutes" integer NOT NULL CHECK ("minutes" > 0 AND "minutes" <= 1440),
  "commentaire" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "heures_st_technicien_idx" ON "heures_sous_traitance" ("technicien_id");
CREATE INDEX IF NOT EXISTS "heures_st_client_idx" ON "heures_sous_traitance" ("client_id");
CREATE INDEX IF NOT EXISTS "heures_st_date_idx" ON "heures_sous_traitance" ("date_travail");
