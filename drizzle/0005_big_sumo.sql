CREATE TABLE "ordres_mission_envois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projet_id" uuid NOT NULL,
	"technicien_id" uuid,
	"message" text,
	"documents_joint_ids" uuid[] DEFAULT '{}',
	"envoye_par_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ordres_mission_envois" ADD CONSTRAINT "ordres_mission_envois_projet_id_projets_id_fk" FOREIGN KEY ("projet_id") REFERENCES "public"."projets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordres_mission_envois" ADD CONSTRAINT "ordres_mission_envois_technicien_id_users_id_fk" FOREIGN KEY ("technicien_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordres_mission_envois" ADD CONSTRAINT "ordres_mission_envois_envoye_par_id_users_id_fk" FOREIGN KEY ("envoye_par_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;