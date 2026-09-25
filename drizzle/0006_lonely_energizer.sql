CREATE TABLE "auditeurs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" varchar(200) NOT NULL,
	"organisme" varchar(200),
	"numero_certification" varchar(100),
	"telephone" varchar(30),
	"email" varchar(200),
	"specialite" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "auditeur_fiche_id" uuid;--> statement-breakpoint
ALTER TABLE "documents_formations" ADD COLUMN "audit_id" uuid;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_auditeur_fiche_id_auditeurs_id_fk" FOREIGN KEY ("auditeur_fiche_id") REFERENCES "public"."auditeurs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents_formations" ADD CONSTRAINT "documents_formations_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE set null ON UPDATE no action;