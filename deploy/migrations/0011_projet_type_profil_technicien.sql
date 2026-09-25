-- Phase 13 : type de projet + profil technicien complet
ALTER TABLE "projets" ADD COLUMN IF NOT EXISTS "type_projet" varchar(40);
ALTER TABLE "technicien_fiches" ADD COLUMN IF NOT EXISTS "poste" varchar(120);
ALTER TABLE "technicien_fiches" ADD COLUMN IF NOT EXISTS "specialites" text;
ALTER TABLE "technicien_fiches" ADD COLUMN IF NOT EXISTS "vehicule" varchar(80);
ALTER TABLE "technicien_fiches" ADD COLUMN IF NOT EXISTS "date_sortie" timestamp;
ALTER TABLE "technicien_fiches" ADD COLUMN IF NOT EXISTS "motif_sortie" varchar(200);
