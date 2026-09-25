"use server";

import { z } from "zod";
import { db } from "@/db";
import { pieces, mouvementsStock, interventions } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, ne, and, count } from "drizzle-orm";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const pieceSchema = z.object({
  reference: z.string().min(1, "Référence requise"),
  nom: z.string().min(2, "Nom requis"),
  marque: z.string().optional(),
  // Phase 11 : profil fournisseur (fiche pièce plus complète, ISO 9001).
  referenceFournisseur: z.string().optional(),
  fournisseur: z.string().optional(),
  quantiteStock: z.coerce.number().int().min(0, "Quantité invalide"),
  seuilAlerte: z.coerce.number().int().min(0, "Seuil invalide"),
  unite: z.string().min(1, "Unité requise"),
});

export async function createPiece(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = pieceSchema.safeParse({
    reference: formData.get("reference"),
    nom: formData.get("nom"),
    marque: formData.get("marque") || undefined,
    referenceFournisseur: formData.get("referenceFournisseur") || undefined,
    fournisseur: formData.get("fournisseur") || undefined,
    quantiteStock: formData.get("quantiteStock") || 0,
    seuilAlerte: formData.get("seuilAlerte") || 0,
    unite: formData.get("unite") || "unité",
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [existing] = await db
    .select({ id: pieces.id })
    .from(pieces)
    .where(eq(pieces.reference, parsed.data.reference))
    .limit(1);
  if (existing) throw new Error("Une pièce avec cette référence existe déjà.");

  await db.insert(pieces).values({
    reference: parsed.data.reference,
    nom: parsed.data.nom,
    marque: parsed.data.marque ?? null,
    referenceFournisseur: parsed.data.referenceFournisseur ?? null,
    fournisseur: parsed.data.fournisseur ?? null,
    quantiteStock: parsed.data.quantiteStock,
    seuilAlerte: parsed.data.seuilAlerte,
    unite: parsed.data.unite,
  });

  revalidatePath("/responsable/stock");
}

// Phase 11 : jusqu'ici il n'existait aucun moyen de corriger une pièce déjà
// créée (nom, marque, référence...) — seul le stock lui-même bougeait, via
// enregistrerMouvement. On l'ajoute ici, en laissant volontairement la
// quantité en stock en dehors : elle continue à ne se modifier que par un
// Mouvement de stock (entrée/sortie), pour conserver la traçabilité déjà en
// place (table mouvements_stock).
const updatePieceSchema = pieceSchema.omit({ quantiteStock: true });

export async function updatePiece(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Pièce invalide.");

  const parsed = updatePieceSchema.safeParse({
    reference: formData.get("reference"),
    nom: formData.get("nom"),
    marque: formData.get("marque") || undefined,
    referenceFournisseur: formData.get("referenceFournisseur") || undefined,
    fournisseur: formData.get("fournisseur") || undefined,
    seuilAlerte: formData.get("seuilAlerte") || 0,
    unite: formData.get("unite") || "unité",
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [existing] = await db.select({ id: pieces.id }).from(pieces).where(eq(pieces.id, id)).limit(1);
  if (!existing) throw new Error("Pièce introuvable.");

  const [autre] = await db
    .select({ id: pieces.id })
    .from(pieces)
    .where(and(eq(pieces.reference, parsed.data.reference), ne(pieces.id, id)))
    .limit(1);
  if (autre) throw new Error("Une autre pièce utilise déjà cette référence.");

  await db
    .update(pieces)
    .set({
      reference: parsed.data.reference,
      nom: parsed.data.nom,
      marque: parsed.data.marque ?? null,
      referenceFournisseur: parsed.data.referenceFournisseur ?? null,
      fournisseur: parsed.data.fournisseur ?? null,
      seuilAlerte: parsed.data.seuilAlerte,
      unite: parsed.data.unite,
    })
    .where(eq(pieces.id, id));

  revalidatePath("/responsable/stock");
  revalidatePath(`/responsable/stock/pieces/${id}`);
}

// Phase 11 : "supprimer une pièce" — une pièce qui a déjà des mouvements de
// stock ne peut pas être supprimée (mouvements_stock.piece_id est en
// onDelete "restrict", pour ne jamais perdre la traçabilité) : on la
// désactive à la place. Une pièce jamais utilisée peut, elle, être
// définitivement supprimée.
export async function toggleActifPiece(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const id = String(formData.get("id") ?? "");
  const [piece] = await db.select({ actif: pieces.actif }).from(pieces).where(eq(pieces.id, id)).limit(1);
  if (!piece) throw new Error("Pièce introuvable.");

  await db
    .update(pieces)
    .set({ actif: piece.actif === 1 ? 0 : 1 })
    .where(eq(pieces.id, id));

  revalidatePath("/responsable/stock");
  revalidatePath(`/responsable/stock/pieces/${id}`);
}

export async function deletePiece(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const id = String(formData.get("id") ?? "");
  const [piece] = await db.select({ id: pieces.id, photoUrl: pieces.photoUrl }).from(pieces).where(eq(pieces.id, id)).limit(1);
  if (!piece) throw new Error("Pièce introuvable.");

  const [{ n }] = await db
    .select({ n: count() })
    .from(mouvementsStock)
    .where(eq(mouvementsStock.pieceId, id));
  if (n > 0) {
    throw new Error(
      "Cette pièce a déjà des mouvements de stock enregistrés — impossible de la supprimer sans perdre l'historique. Désactivez-la plutôt."
    );
  }

  await db.delete(pieces).where(eq(pieces.id, id));

  if (piece.photoUrl) {
    const oldPath = path.join(process.cwd(), "public", piece.photoUrl.replace(/^\//, ""));
    await unlink(oldPath).catch(() => {});
  }

  revalidatePath("/responsable/stock");
  redirect("/responsable/stock");
}

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export async function uploadPiecePhoto(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const pieceId = String(formData.get("pieceId") ?? "");
  if (!pieceId) throw new Error("Pièce invalide.");

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Merci de choisir une photo.");
  }
  if (file.size > PHOTO_MAX_BYTES) {
    throw new Error("La photo dépasse la taille maximale de 8 Mo.");
  }
  const ext = PHOTO_TYPES[file.type];
  if (!ext) {
    throw new Error("Format non supporté — utilisez JPEG, PNG ou WEBP.");
  }

  const [existing] = await db
    .select({ photoUrl: pieces.photoUrl })
    .from(pieces)
    .where(eq(pieces.id, pieceId))
    .limit(1);
  if (!existing) throw new Error("Pièce introuvable.");

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "pieces");
  await mkdir(uploadsDir, { recursive: true });

  const filename = `${pieceId}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadsDir, filename), buffer);

  // Remplacement : on efface l'ancienne photo (une seule photo par pièce).
  if (existing.photoUrl) {
    const oldPath = path.join(process.cwd(), "public", existing.photoUrl.replace(/^\//, ""));
    await unlink(oldPath).catch(() => {});
  }

  await db
    .update(pieces)
    .set({ photoUrl: `/uploads/pieces/${filename}` })
    .where(eq(pieces.id, pieceId));

  revalidatePath(`/responsable/stock/pieces/${pieceId}`);
}

const mouvementSchema = z.object({
  pieceId: z.string().uuid("Pièce invalide"),
  type: z.enum(["entree", "sortie"]),
  quantite: z.coerce.number().int().positive("Quantité invalide"),
  interventionId: z.string().uuid().optional(),
  commentaire: z.string().optional(),
});

export async function enregistrerMouvement(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const interventionIdRaw = formData.get("interventionId");
  const parsed = mouvementSchema.safeParse({
    pieceId: formData.get("pieceId"),
    type: formData.get("type"),
    quantite: formData.get("quantite"),
    interventionId: interventionIdRaw && interventionIdRaw !== "" ? interventionIdRaw : undefined,
    commentaire: formData.get("commentaire") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [piece] = await db
    .select({ id: pieces.id, quantiteStock: pieces.quantiteStock })
    .from(pieces)
    .where(eq(pieces.id, parsed.data.pieceId))
    .limit(1);
  if (!piece) throw new Error("Pièce introuvable — impossible d'enregistrer le mouvement.");

  if (parsed.data.interventionId) {
    const [interventionExists] = await db
      .select({ id: interventions.id })
      .from(interventions)
      .where(eq(interventions.id, parsed.data.interventionId))
      .limit(1);
    if (!interventionExists) throw new Error("Intervention introuvable.");
  }

  const nouvelleQuantite =
    parsed.data.type === "entree"
      ? piece.quantiteStock + parsed.data.quantite
      : piece.quantiteStock - parsed.data.quantite;

  if (nouvelleQuantite < 0) {
    throw new Error(
      `Stock insuffisant : il ne reste que ${piece.quantiteStock} unité(s) en stock pour cette pièce.`
    );
  }

  await db.update(pieces).set({ quantiteStock: nouvelleQuantite }).where(eq(pieces.id, piece.id));

  await db.insert(mouvementsStock).values({
    pieceId: parsed.data.pieceId,
    type: parsed.data.type,
    quantite: parsed.data.quantite,
    interventionId: parsed.data.interventionId ?? null,
    effectueParId: user.id,
    commentaire: parsed.data.commentaire ?? null,
  });

  revalidatePath("/responsable/stock");
}
