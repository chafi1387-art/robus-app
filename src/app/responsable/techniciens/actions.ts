"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { technicienDocuments, technicienFiches, users } from "@/db/schema";
import { requireUser, Role, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// La création d'un compte (identifiants de connexion) reste réservée aux
// administrateurs, comme pour /responsable/utilisateurs. La fiche RH seule
// (sans identifiants) reste consultable/modifiable par tout le bureau.
const ROLES_ADMIN_ONLY: Role[] = ["administrateur"];

const STATUTS_RH = [
  "actif",
  "en_conge",
  "arret_maladie",
  "en_formation",
  "suspendu",
  "sorti_effectifs",
] as const;

const createTechnicienSchema = z.object({
  nom: z.string().min(2, "Nom requis"),
  email: z.string().email("Email invalide").transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères"),
  telephone: z.string().optional(),
  dateNaissance: z.string().optional(),
  contactUrgenceNom: z.string().optional(),
  contactUrgenceTelephone: z.string().optional(),
  siteRattachementId: z.string().uuid().optional(),
  dateEntreeEntreprise: z.string().optional(),
  typeContrat: z.string().optional(),
  adresseDomicile: z.string().optional(),
  statutRh: z.enum(STATUTS_RH).optional(),
});

export async function createTechnicien(formData: FormData) {
  const admin = await requireUser(ROLES_ADMIN_ONLY);

  const siteRattachementId = formData.get("siteRattachementId");
  const parsed = createTechnicienSchema.safeParse({
    nom: formData.get("nom"),
    email: formData.get("email"),
    password: formData.get("password"),
    telephone: formData.get("telephone") || undefined,
    dateNaissance: formData.get("dateNaissance") || undefined,
    contactUrgenceNom: formData.get("contactUrgenceNom") || undefined,
    contactUrgenceTelephone: formData.get("contactUrgenceTelephone") || undefined,
    siteRattachementId:
      siteRattachementId && siteRattachementId !== "" ? siteRattachementId : undefined,
    dateEntreeEntreprise: formData.get("dateEntreeEntreprise") || undefined,
    typeContrat: formData.get("typeContrat") || undefined,
    adresseDomicile: formData.get("adresseDomicile") || undefined,
    statutRh: formData.get("statutRh") || undefined,
  });
  // Phase 13b : erreurs de saisie affichées sur la page (plus de page d'erreur serveur).
  if (!parsed.success) redirect(`/responsable/techniciens?nouveau=1&erreur=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Données invalides")}#nouveau`);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);
  if (existing) redirect(`/responsable/techniciens?nouveau=1&erreur=${encodeURIComponent(`Un compte existe déjà avec l'email ${parsed.data.email} (technicien actuel, ancien ou autre utilisateur). Utilisez un autre email ou ouvrez sa fiche.`)}#nouveau`);

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  const [createdUser] = await db
    .insert(users)
    .values({
      nom: parsed.data.nom,
      email: parsed.data.email,
      passwordHash,
      role: "technicien",
      telephone: parsed.data.telephone ?? null,
    })
    .returning();

  await db.insert(technicienFiches).values({
    technicienId: createdUser.id,
    dateNaissance: parsed.data.dateNaissance ? new Date(parsed.data.dateNaissance) : null,
    contactUrgenceNom: parsed.data.contactUrgenceNom ?? null,
    contactUrgenceTelephone: parsed.data.contactUrgenceTelephone ?? null,
    siteRattachementId: parsed.data.siteRattachementId ?? null,
    dateEntreeEntreprise: parsed.data.dateEntreeEntreprise
      ? new Date(parsed.data.dateEntreeEntreprise)
      : null,
    typeContrat: parsed.data.typeContrat ?? null,
    adresseDomicile: parsed.data.adresseDomicile ?? null,
    statutRh: parsed.data.statutRh ?? "actif",
  });

  await journaliser({
    entite: "technicien",
    entiteId: createdUser.id,
    action: "creation",
    utilisateurId: admin.id,
    details: `Fiche technicien créée — ${parsed.data.email}`,
  });

  revalidatePath("/responsable/techniciens");
  redirect(`/responsable/techniciens/${createdUser.id}`);
}

const updateFicheSchema = z.object({
  technicienId: z.string().uuid(),
  email: z.string().email("Email invalide").transform((v) => v.trim().toLowerCase()),
  telephone: z.string().optional(),
  dateNaissance: z.string().optional(),
  contactUrgenceNom: z.string().optional(),
  contactUrgenceTelephone: z.string().optional(),
  siteRattachementId: z.string().uuid().optional(),
  dateEntreeEntreprise: z.string().optional(),
  typeContrat: z.string().optional(),
  adresseDomicile: z.string().optional(),
  statutRh: z.enum(STATUTS_RH).optional(),
  poste: z.string().max(120).optional(),
  specialites: z.string().max(500).optional(),
  vehicule: z.string().max(80).optional(),
  dateSortie: z.string().optional(),
  motifSortie: z.string().max(200).optional(),
});

export async function updateTechnicienFiche(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const siteRattachementId = formData.get("siteRattachementId");
  const parsed = updateFicheSchema.safeParse({
    technicienId: formData.get("technicienId"),
    email: formData.get("email"),
    telephone: formData.get("telephone") || undefined,
    dateNaissance: formData.get("dateNaissance") || undefined,
    contactUrgenceNom: formData.get("contactUrgenceNom") || undefined,
    contactUrgenceTelephone: formData.get("contactUrgenceTelephone") || undefined,
    siteRattachementId:
      siteRattachementId && siteRattachementId !== "" ? siteRattachementId : undefined,
    dateEntreeEntreprise: formData.get("dateEntreeEntreprise") || undefined,
    typeContrat: formData.get("typeContrat") || undefined,
    adresseDomicile: formData.get("adresseDomicile") || undefined,
    statutRh: formData.get("statutRh") || undefined,
    poste: formData.get("poste") || undefined,
    specialites: formData.get("specialites") || undefined,
    vehicule: formData.get("vehicule") || undefined,
    dateSortie: formData.get("dateSortie") || undefined,
    motifSortie: formData.get("motifSortie") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, parsed.data.technicienId))
    .limit(1);
  if (!existingUser) throw new Error("Technicien introuvable.");

  // Email désormais modifiable — même contrôle d'unicité qu'à la création,
  // en excluant la propre ligne du technicien (pour autoriser un enregistrement
  // sans changement d'email).
  const [emailPrisAilleurs] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);
  if (emailPrisAilleurs && emailPrisAilleurs.id !== parsed.data.technicienId) {
    throw new Error("Un utilisateur existe déjà avec cet email.");
  }

  // Phase 13 : un technicien « sorti des effectifs » ne peut plus se
  // connecter (compte désactivé) mais tout son historique reste consultable.
  const sorti = parsed.data.statutRh === "sorti_effectifs";
  await db
    .update(users)
    .set({ email: parsed.data.email, telephone: parsed.data.telephone ?? null, actif: sorti ? 0 : 1 })
    .where(eq(users.id, parsed.data.technicienId));

  const [existingFiche] = await db
    .select({ id: technicienFiches.id })
    .from(technicienFiches)
    .where(eq(technicienFiches.technicienId, parsed.data.technicienId))
    .limit(1);

  const values = {
    dateNaissance: parsed.data.dateNaissance ? new Date(parsed.data.dateNaissance) : null,
    contactUrgenceNom: parsed.data.contactUrgenceNom ?? null,
    contactUrgenceTelephone: parsed.data.contactUrgenceTelephone ?? null,
    siteRattachementId: parsed.data.siteRattachementId ?? null,
    dateEntreeEntreprise: parsed.data.dateEntreeEntreprise
      ? new Date(parsed.data.dateEntreeEntreprise)
      : null,
    typeContrat: parsed.data.typeContrat ?? null,
    adresseDomicile: parsed.data.adresseDomicile ?? null,
    statutRh: parsed.data.statutRh ?? "actif",
    poste: parsed.data.poste ?? null,
    specialites: parsed.data.specialites ?? null,
    vehicule: parsed.data.vehicule ?? null,
    dateSortie: sorti ? (parsed.data.dateSortie ? new Date(parsed.data.dateSortie) : new Date()) : null,
    motifSortie: sorti ? (parsed.data.motifSortie ?? null) : null,
  };

  if (existingFiche) {
    await db
      .update(technicienFiches)
      .set(values)
      .where(eq(technicienFiches.technicienId, parsed.data.technicienId));
  } else {
    await db.insert(technicienFiches).values({ technicienId: parsed.data.technicienId, ...values });
  }

  await journaliser({
    entite: "technicien",
    entiteId: parsed.data.technicienId,
    action: sorti ? "sortie_effectifs" : "modification_fiche",
    utilisateurId: user.id,
    details: sorti ? `Sortie${parsed.data.motifSortie ? ` — ${parsed.data.motifSortie}` : ""} (connexion désactivée)` : null,
  });

  revalidatePath(`/responsable/techniciens/${parsed.data.technicienId}`);
  revalidatePath("/responsable/techniciens");
}

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export async function uploadTechnicienPhoto(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const technicienId = String(formData.get("technicienId") ?? "");
  if (!technicienId) throw new Error("Technicien invalide.");

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
    .select({ id: technicienFiches.id, photoUrl: technicienFiches.photoUrl })
    .from(technicienFiches)
    .where(eq(technicienFiches.technicienId, technicienId))
    .limit(1);

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "techniciens");
  await mkdir(uploadsDir, { recursive: true });

  const filename = `${technicienId}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadsDir, filename), buffer);

  if (existing?.photoUrl) {
    const oldPath = path.join(process.cwd(), "public", existing.photoUrl.replace(/^\//, ""));
    await unlink(oldPath).catch(() => {});
  }

  const photoUrl = `/uploads/techniciens/${filename}`;
  if (existing) {
    await db
      .update(technicienFiches)
      .set({ photoUrl })
      .where(eq(technicienFiches.technicienId, technicienId));
  } else {
    await db.insert(technicienFiches).values({ technicienId, photoUrl });
  }

  revalidatePath(`/responsable/techniciens/${technicienId}`);
}

const DOC_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};
const DOC_MAX_BYTES = 8 * 1024 * 1024;

const docSchema = z.object({
  technicienId: z.string().uuid(),
  titre: z.string().min(2, "Titre requis"),
});

export async function uploadTechnicienDocument(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = docSchema.safeParse({
    technicienId: formData.get("technicienId"),
    titre: formData.get("titre"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const file = formData.get("fichier");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Merci de choisir un fichier.");
  }
  if (file.size > DOC_MAX_BYTES) {
    throw new Error("Le fichier dépasse la taille maximale de 8 Mo.");
  }
  const ext = DOC_TYPES[file.type];
  if (!ext) {
    throw new Error("Format non supporté — utilisez PDF, JPEG ou PNG.");
  }

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "techniciens", "documents");
  await mkdir(uploadsDir, { recursive: true });

  const filename = `${parsed.data.technicienId}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadsDir, filename), buffer);

  await db.insert(technicienDocuments).values({
    technicienId: parsed.data.technicienId,
    titre: parsed.data.titre,
    urlFichier: `/uploads/techniciens/documents/${filename}`,
  });

  revalidatePath(`/responsable/techniciens/${parsed.data.technicienId}`);
}
