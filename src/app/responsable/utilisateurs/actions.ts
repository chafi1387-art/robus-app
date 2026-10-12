"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser, Role } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { avecMessage } from "@/lib/url";

const ROLES_ADMIN_ONLY: Role[] = ["administrateur"];

const createUserSchema = z.object({
  nom: z.string().min(2, "Nom requis"),
  email: z.string().email("Email invalide").transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères"),
  role: z.enum(["administrateur", "responsable_qualite", "technicien", "commercial"]),
});

export async function createUser(formData: FormData) {
  const admin = await requireUser(ROLES_ADMIN_ONLY);

  const parsed = createUserSchema.safeParse({
    nom: formData.get("nom"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);
  if (existing) throw new Error("Un utilisateur existe déjà avec cet email.");

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  const [created] = await db
    .insert(users)
    .values({
      nom: parsed.data.nom,
      email: parsed.data.email,
      passwordHash,
      role: parsed.data.role,
    })
    .returning();

  await journaliser({
    entite: "users",
    entiteId: created.id,
    action: "creation",
    utilisateurId: admin.id,
    details: `Compte créé (${parsed.data.role}) — ${parsed.data.email}`,
  });

  revalidatePath("/responsable/utilisateurs");
  redirect("/responsable/utilisateurs");
}

const toggleSchema = z.object({
  userId: z.string().uuid(),
});

export async function toggleUserActive(formData: FormData) {
  const currentUser = await requireUser(ROLES_ADMIN_ONLY);

  const parsed = toggleSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) throw new Error("Utilisateur invalide.");

  if (parsed.data.userId === currentUser.id) {
    throw new Error("Vous ne pouvez pas désactiver votre propre compte.");
  }

  const [target] = await db
    .select({ id: users.id, actif: users.actif })
    .from(users)
    .where(eq(users.id, parsed.data.userId))
    .limit(1);
  if (!target) throw new Error("Utilisateur introuvable.");

  await db
    .update(users)
    .set({ actif: target.actif === 1 ? 0 : 1 })
    .where(eq(users.id, parsed.data.userId));

  await journaliser({
    entite: "users",
    entiteId: parsed.data.userId,
    action: target.actif === 1 ? "desactivation" : "activation",
    utilisateurId: currentUser.id,
  });

  revalidatePath("/responsable/utilisateurs");
}

const resetPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères"),
});

export async function resetUserPassword(formData: FormData) {
  const admin = await requireUser(ROLES_ADMIN_ONLY);

  const parsed = resetPasswordSchema.safeParse({
    userId: formData.get("userId"),
    password: formData.get("password"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, parsed.data.userId))
    .limit(1);
  if (!target) throw new Error("Utilisateur introuvable.");

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  await db.update(users).set({ passwordHash }).where(eq(users.id, parsed.data.userId));

  await journaliser({
    entite: "users",
    entiteId: parsed.data.userId,
    action: "reinitialisation_mot_de_passe",
    utilisateurId: admin.id,
  });

  revalidatePath("/responsable/utilisateurs");
}

// Phase 31 : corriger le nom, l'email ou le téléphone d'un compte (administrateur).
export async function modifierUtilisateur(formData: FormData) {
  const admin = await requireUser(ROLES_ADMIN_ONLY);
  const page = "/responsable/utilisateurs";
  const parsed = z
    .object({
      userId: z.string().uuid(),
      nom: z.string().trim().min(2, "Le nom doit contenir au moins 2 caractères.").max(160),
      email: z.string().trim().toLowerCase().email("Email invalide"),
      telephone: z.string().trim().max(40).optional(),
    })
    .safeParse({
      userId: formData.get("userId"),
      nom: formData.get("nom"),
      email: formData.get("email"),
      telephone: formData.get("telephone") || undefined,
    });
  if (!parsed.success) redirect(avecMessage(page, "erreur", parsed.error.issues[0]?.message ?? "Données invalides"));
  const d = parsed.data!;
  const [avant] = await db.select({ nom: users.nom, email: users.email, telephone: users.telephone }).from(users).where(eq(users.id, d.userId)).limit(1);
  if (!avant) redirect(avecMessage(page, "erreur", "Compte introuvable."));
  const [pris] = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email)).limit(1);
  if (pris && pris.id !== d.userId) redirect(avecMessage(page, "erreur", "Un autre compte utilise déjà cet email."));
  await db.update(users).set({ nom: d.nom, email: d.email, telephone: d.telephone ?? null }).where(eq(users.id, d.userId));
  const changements = [
    d.nom !== avant!.nom ? `nom : « ${avant!.nom} » → « ${d.nom} »` : null,
    d.email !== avant!.email ? `email : ${avant!.email} → ${d.email}` : null,
    (d.telephone ?? null) !== (avant!.telephone ?? null) ? "téléphone modifié" : null,
  ].filter(Boolean);
  if (changements.length) {
    await journaliser({ entite: "utilisateur", entiteId: d.userId, action: "identite_modifiee", utilisateurId: admin.id, details: changements.join(" · ") });
  }
  revalidatePath("/", "layout");
  redirect(
    avecMessage(
      page,
      "ok",
      !changements.length ? "Rien n'a changé." : d.email !== avant!.email ? `${d.nom} : enregistré. La connexion se fait désormais avec ${d.email}.` : `${d.nom} : enregistré.`
    )
  );
}
