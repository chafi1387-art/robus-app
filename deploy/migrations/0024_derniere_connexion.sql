-- Phase 28 : tableau de bord de direction — « observateurs qui se sont déjà connectés ».
-- Date de la dernière connexion réussie de chaque compte.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "derniere_connexion" timestamp;

-- Reprise : un compte qui a déjà laissé une trace d'activité est considéré comme connecté au moins une fois.
UPDATE "users" u SET "derniere_connexion" = coalesce(
  (SELECT max(j."created_at") FROM "journal_activite" j WHERE j."utilisateur_id" = u."id"),
  (SELECT max(p."created_at") FROM "push_abonnements" p WHERE p."user_id" = u."id")
)
WHERE u."derniere_connexion" IS NULL;
