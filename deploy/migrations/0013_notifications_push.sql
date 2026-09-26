CREATE TABLE IF NOT EXISTS "push_abonnements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "appareil" varchar(200),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "push_abonnements_endpoint_idx" ON "push_abonnements" ("endpoint");
ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "retard_notifie_le" timestamp;
