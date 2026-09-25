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
