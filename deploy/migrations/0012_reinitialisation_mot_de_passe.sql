CREATE TABLE IF NOT EXISTS "reinitialisations_mot_de_passe" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "jeton_hash" varchar(64) NOT NULL,
  "expire_le" timestamp NOT NULL,
  "utilise_le" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "reinit_mdp_jeton_idx" ON "reinitialisations_mot_de_passe" ("jeton_hash");
