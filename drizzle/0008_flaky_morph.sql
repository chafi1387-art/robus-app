ALTER TYPE "public"."categorie_document" ADD VALUE 'fournisseur_iso';--> statement-breakpoint
ALTER TABLE "documents_formations" ADD COLUMN "piece_id" uuid;--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN "reference_fournisseur" varchar(80);--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN "fournisseur" varchar(120);--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "documents_formations" ADD CONSTRAINT "documents_formations_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE set null ON UPDATE no action;