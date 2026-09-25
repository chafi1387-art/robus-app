CREATE TYPE "public"."lieu_formation" AS ENUM('terrain', 'bureau', 'ecole');--> statement-breakpoint
ALTER TYPE "public"."statut_appareil" ADD VALUE 'installation';--> statement-breakpoint
ALTER TABLE "appareils" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "documents_formations" ADD COLUMN "lieu_formation" "lieu_formation";