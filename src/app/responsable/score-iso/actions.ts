"use server";

import { z } from "zod";
import { db } from "@/db";
import { scoreIsoSaisies } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { BLOCS_ISO } from "@/lib/score-iso";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const BLOC_CLES = BLOCS_ISO.map((b) => b.cle) as [string, ...string[]];

const saisieSchema = z.object({
  bloc: z.enum(BLOC_CLES),
  valeur: z.coerce.number().min(0).max(100),
  commentaire: z.string().optional(),
});

const formSchema = z.object({
  mois: z.string().regex(/^\d{4}-\d{2}$/, "Mois invalide (format AAAA-MM)"),
  saisies: z.array(saisieSchema),
});

export type SaisieBlocInput = z.infer<typeof saisieSchema>;

/**
 * Enregistre (upsert) les valeurs des 7 blocs du score ISO 9001 pour un mois
 * donné. Une ligne par (mois, bloc) — contrainte d'unicité en base.
 */
export async function enregistrerScoreMois(mois: string, saisies: SaisieBlocInput[]) {
  const user = await requireUser(ROLES_BUREAU);

  const parsed = formSchema.safeParse({ mois, saisies });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const lignes = await Promise.all(
    parsed.data.saisies.map((s) =>
      db
        .insert(scoreIsoSaisies)
        .values({
          mois: parsed.data.mois,
          bloc: s.bloc,
          valeur: String(s.valeur),
          commentaire: s.commentaire ?? null,
          saisiParId: user.id,
        })
        .onConflictDoUpdate({
          target: [scoreIsoSaisies.mois, scoreIsoSaisies.bloc],
          set: {
            valeur: String(s.valeur),
            commentaire: s.commentaire ?? null,
            saisiParId: user.id,
          },
        })
        .returning()
    )
  );

  await journaliser({
    entite: "score_iso_saisies",
    entiteId: lignes[0]?.[0]?.id ?? user.id,
    action: "saisie_mensuelle",
    utilisateurId: user.id,
    details: `Score ISO saisi pour ${parsed.data.mois} (${parsed.data.saisies.length} blocs)`,
  });

  revalidatePath("/responsable/score-iso");
  redirect(`/responsable/score-iso?mois=${parsed.data.mois}`);
}

/**
 * Server Action liée à un <form action={...}> : reconstruit les 7 saisies à
 * partir du FormData (un input par bloc) puis délègue à enregistrerScoreMois.
 */
export async function enregistrerScoreMoisForm(formData: FormData) {
  const mois = String(formData.get("mois") ?? "");
  const saisies: SaisieBlocInput[] = BLOCS_ISO.map((bloc) => ({
    bloc: bloc.cle,
    valeur: Number(formData.get(`valeur_${bloc.cle}`) ?? 0),
    commentaire: (formData.get(`commentaire_${bloc.cle}`) as string) || undefined,
  }));
  await enregistrerScoreMois(mois, saisies);
}
