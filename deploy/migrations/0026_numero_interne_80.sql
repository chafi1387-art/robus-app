-- Phase 30 : le n° interne d'un appareil passe de 40 à 80 caractères
-- (un n° plus long faisait échouer l'enregistrement de la fiche).
ALTER TABLE "appareils" ALTER COLUMN "numero_interne" TYPE varchar(80);
