"use server";

import { db } from "@/db";
import { documentsFormations, formationsConsultations, habilitationsCatalogue, habilitationsTechnicien } from "@/db/schema";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { enregistrerFichiers, fichiersDuFormulaire } from "@/lib/fichiers";
import { calculerExpiration } from "@/lib/habilitations";
import { notifierBureau } from "@/lib/push";
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

  // Phase 19 : valider un document = « lecture attestée » (traçabilité de la
  // consultation). Les habilitations sont désormais ajoutées par le bureau,
  // avec certificat, ou déposées par le technicien puis validées.
  await journaliser({ entite: "document", entiteId: documentId, action: "lecture_attestee", utilisateurId: user.id });

  revalidatePath("/technicien/formations");
  revalidatePath("/technicien/profil");
}


// Phase 19 : le technicien dépose un certificat (nouvelle habilitation ou
// renouvellement) — il reste « en attente » jusqu'à validation par le bureau.
export async function deposerCertificat(formData: FormData) {
  const user = await requireUser(["technicien"]);
  const catalogueId = String(formData.get("catalogueId") ?? "");
  const dateTxt = String(formData.get("dateObtention") ?? "");
  const retour = (m: string) => redirect(`/technicien/profil?${m}#habilitations`);
  const [cat] = /^[0-9a-f-]{36}$/i.test(catalogueId)
    ? await db.select().from(habilitationsCatalogue).where(and(eq(habilitationsCatalogue.id, catalogueId), eq(habilitationsCatalogue.actif, 1))).limit(1)
    : [];
  if (!cat) retour("erreurHab=" + encodeURIComponent("Choisissez l'habilitation."));
  const dateObtention = new Date(`${dateTxt}T12:00:00`);
  if (Number.isNaN(dateObtention.getTime()) || dateObtention.getTime() > Date.now()) retour("erreurHab=" + encodeURIComponent("Date d'obtention invalide."));
  let fichiers: File[] = [];
  try {
    fichiers = fichiersDuFormulaire(formData, "certificat", 1);
  } catch (e) {
    retour("erreurHab=" + encodeURIComponent((e as Error).message));
  }
  if (!fichiers.length) retour("erreurHab=" + encodeURIComponent("Joignez le certificat (PDF ou photo)."));
  const [f] = await enregistrerFichiers(fichiers, "habilitations", `cert-${user.id}`);
  const [h] = await db
    .insert(habilitationsTechnicien)
    .values({
      technicienId: user.id,
      catalogueId: cat!.id,
      dateObtention,
      dateExpiration: calculerExpiration(dateObtention, cat!.validiteMois),
      organisme: String(formData.get("organisme") ?? "").trim().slice(0, 160) || null,
      numeroCertificat: String(formData.get("numeroCertificat") ?? "").trim().slice(0, 80) || null,
      certificatUrl: f.url,
      statut: "en_attente",
      ajouteeParId: user.id,
    })
    .returning({ id: habilitationsTechnicien.id });
  await journaliser({ entite: "habilitation", entiteId: h.id, action: "certificat_depose", utilisateurId: user.id, details: cat!.nom });
  after(() =>
    notifierBureau({ titre: "📄 Certificat à valider", corps: `${user.name ?? "Un technicien"} — ${cat!.nom}`, url: "/responsable/habilitations?onglet=a_valider", tag: `hab-${h.id}` })
  );
  revalidatePath("/technicien/profil");
  retour("depose=1");
}
