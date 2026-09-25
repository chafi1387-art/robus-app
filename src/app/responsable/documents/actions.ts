"use server";

import { z } from "zod";
import { db } from "@/db";
import { appareils, audits, documentsFormations, pieces, projets } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FICHIER_MAX_BYTES, FICHIER_TYPES } from "@/lib/document-file-rules";

// Suppression volontairement non proposée : habilitationsTechnicien référence
// documentsFormations avec onDelete: "restrict" (voir src/db/schema.ts). Un
// document utilisé par au moins une habilitation ne peut pas être supprimé —
// la contrainte FK ferait échouer la requête. Plutôt que de gérer un cas
// d'erreur partiel, ce module ne propose que création + consultation.

// Phase 6 : upload direct de fichier (PDF ou vidéo) en plus du champ URL
// existant — les deux restent mutuellement exclusifs côté formulaire, le
// fichier uploadé prenant le pas s'il est fourni. Règles de validation
// (types acceptés, taille max) dans src/lib/document-file-rules.ts — ce
// fichier "use server" ne peut exporter que des fonctions async.

const documentSchema = z.object({
  titre: z.string().min(2, "Titre requis"),
  categorie: z.enum([
    "securite",
    "installation",
    "maintenance",
    "depannage",
    "marques",
    "procedures_robus",
    "videos",
    "fournisseur_iso",
  ]),
  typeContenu: z.enum(["document", "video"]),
  urlFichier: z.string().optional(),
  marque: z.string().optional(),
  typeAppareilConcerne: z.string().optional(),
  appareilId: z.string().uuid().optional(),
  projetId: z.string().uuid().optional(),
  // Phase 9a : un document peut aussi être rattaché à un Audit précis.
  auditId: z.string().uuid().optional(),
  // Phase 11 : ou à une Pièce de stock (certificat fournisseur ISO 9001).
  pieceId: z.string().uuid().optional(),
  estFormation: z.boolean(),
  dureeValiditeMois: z.coerce.number().int().positive().optional(),
  lieuFormation: z.enum(["terrain", "bureau", "ecole"]).optional(),
});

export async function createDocument(formData: FormData) {
  await requireUser(ROLES_BUREAU);

  const estFormation = formData.get("estFormation") === "on";
  const appareilId = formData.get("appareilId");
  const projetId = formData.get("projetId");
  const auditId = formData.get("auditId");
  const pieceId = formData.get("pieceId");
  const parsed = documentSchema.safeParse({
    titre: formData.get("titre"),
    categorie: formData.get("categorie"),
    typeContenu: formData.get("typeContenu"),
    urlFichier: formData.get("urlFichier") || undefined,
    marque: formData.get("marque") || undefined,
    typeAppareilConcerne: formData.get("typeAppareilConcerne") || undefined,
    appareilId: appareilId && appareilId !== "" ? appareilId : undefined,
    projetId: projetId && projetId !== "" ? projetId : undefined,
    auditId: auditId && auditId !== "" ? auditId : undefined,
    pieceId: pieceId && pieceId !== "" ? pieceId : undefined,
    estFormation,
    dureeValiditeMois: estFormation ? formData.get("dureeValiditeMois") || undefined : undefined,
    lieuFormation: estFormation ? formData.get("lieuFormation") || undefined : undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  if (parsed.data.appareilId) {
    const [exists] = await db
      .select({ id: appareils.id })
      .from(appareils)
      .where(eq(appareils.id, parsed.data.appareilId))
      .limit(1);
    if (!exists) throw new Error("Appareil introuvable.");
  }
  if (parsed.data.projetId) {
    const [exists] = await db
      .select({ id: projets.id })
      .from(projets)
      .where(eq(projets.id, parsed.data.projetId))
      .limit(1);
    if (!exists) throw new Error("Projet introuvable.");
  }
  if (parsed.data.auditId) {
    const [exists] = await db
      .select({ id: audits.id })
      .from(audits)
      .where(eq(audits.id, parsed.data.auditId))
      .limit(1);
    if (!exists) throw new Error("Audit introuvable.");
  }
  if (parsed.data.pieceId) {
    const [exists] = await db
      .select({ id: pieces.id })
      .from(pieces)
      .where(eq(pieces.id, parsed.data.pieceId))
      .limit(1);
    if (!exists) throw new Error("Pièce introuvable.");
  }

  let urlFichier = parsed.data.urlFichier ?? null;

  const file = formData.get("fichier");
  if (file instanceof File && file.size > 0) {
    if (file.size > FICHIER_MAX_BYTES) {
      throw new Error("Le fichier dépasse la taille maximale de 200 Mo.");
    }
    const ext = FICHIER_TYPES[file.type];
    if (!ext) {
      throw new Error("Format non supporté — utilisez PDF, MP4, MOV, WEBM ou AVI.");
    }

    const uploadsDir = path.join(process.cwd(), "public", "uploads", "documents");
    await mkdir(uploadsDir, { recursive: true });
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadsDir, filename), buffer);
    urlFichier = `/uploads/documents/${filename}`;
  }

  await db.insert(documentsFormations).values({
    titre: parsed.data.titre,
    categorie: parsed.data.categorie,
    typeContenu: parsed.data.typeContenu,
    urlFichier,
    marque: parsed.data.marque ?? null,
    typeAppareilConcerne: parsed.data.typeAppareilConcerne ?? null,
    appareilId: parsed.data.appareilId ?? null,
    projetId: parsed.data.projetId ?? null,
    auditId: parsed.data.auditId ?? null,
    pieceId: parsed.data.pieceId ?? null,
    estFormation: parsed.data.estFormation ? 1 : 0,
    dureeValiditeMois: parsed.data.dureeValiditeMois ?? null,
    lieuFormation: parsed.data.lieuFormation ?? null,
  });

  revalidatePath("/responsable/documents");
  if (parsed.data.projetId) revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
  if (parsed.data.auditId) revalidatePath("/responsable/audits");
  if (parsed.data.pieceId) revalidatePath(`/responsable/stock/pieces/${parsed.data.pieceId}`);

  const redirectTo = formData.get("redirectTo");
  redirect(typeof redirectTo === "string" && redirectTo ? redirectTo : "/responsable/documents");
}
