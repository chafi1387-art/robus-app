"use server";

import { db } from "@/db";
import { documentsFormations, formationsConsultations, habilitationsTechnicien } from "@/db/schema";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

export async function consulterDocument(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);

  const documentId = String(formData.get("documentId") ?? "");
  if (!documentId) throw new Error("Document invalide.");

  const [doc] = await db
    .select({
      id: documentsFormations.id,
      estFormation: documentsFormations.estFormation,
      dureeValiditeMois: documentsFormations.dureeValiditeMois,
    })
    .from(documentsFormations)
    .where(eq(documentsFormations.id, documentId))
    .limit(1);
  if (!doc) throw new Error("Document introuvable.");

  await db.insert(formationsConsultations).values({
    technicienId: user.id,
    documentId,
  });

  // Formation certifiante : la validation crée (ou renouvelle) une
  // habilitation réelle pour ce technicien — sinon le clic ne faisait que
  // garder une trace sans jamais générer l'habilitation attendue.
  if (doc.estFormation === 1) {
    const maintenant = new Date();
    let dateExpiration: Date | null = null;
    if (doc.dureeValiditeMois) {
      dateExpiration = new Date(maintenant);
      dateExpiration.setMonth(dateExpiration.getMonth() + doc.dureeValiditeMois);
    }

    const [existante] = await db
      .select({ id: habilitationsTechnicien.id })
      .from(habilitationsTechnicien)
      .where(
        and(
          eq(habilitationsTechnicien.technicienId, user.id),
          eq(habilitationsTechnicien.documentId, documentId)
        )
      )
      .limit(1);

    if (existante) {
      // Revalidation (recyclage) : on repart de zéro plutôt que de cumuler
      // les mois, pour rester fidèle à un vrai audit qualité ISO 9001.
      await db
        .update(habilitationsTechnicien)
        .set({ dateObtention: maintenant, dateExpiration })
        .where(eq(habilitationsTechnicien.id, existante.id));
      await journaliser({
        entite: "habilitation",
        entiteId: existante.id,
        action: "renouvellement",
        utilisateurId: user.id,
      });
    } else {
      const [created] = await db
        .insert(habilitationsTechnicien)
        .values({
          technicienId: user.id,
          documentId,
          dateObtention: maintenant,
          dateExpiration,
        })
        .returning();
      await journaliser({
        entite: "habilitation",
        entiteId: created.id,
        action: "obtention",
        utilisateurId: user.id,
      });
    }
  }

  revalidatePath("/technicien/formations");
  revalidatePath("/technicien/profil");
}
