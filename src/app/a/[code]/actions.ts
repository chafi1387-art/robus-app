"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { signIn } from "@/auth";
import { db } from "@/db";
import { appareils, users } from "@/db/schema";
import { accesObservateurValide } from "@/lib/observateur-acces";
import { enregistrerPanne, tropDeSignalements } from "@/lib/panne";

// Phase 18 : actions de la page ouverte en scannant le QR code de la cabine.

function codeValide(code: string) {
  return /^[A-Za-z0-9_-]{8,32}$/.test(code);
}

export async function connexionQr(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  if (!codeValide(code)) redirect("/connexion");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const erreur = (e: string) => redirect(`/a/${code}?erreur=${e}`);
  if (!email || !password) erreur("identifiants");
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.actif !== 1 || !(await bcrypt.compare(password, user.passwordHash))) erreur("identifiants");
  if (user!.role === "observateur" && !(await accesObservateurValide(user!.id))) erreur("expire");
  await signIn("credentials", { email, password, redirect: false });
  redirect(`/a/${code}`);
}

const panneSchema = z.object({
  nom: z.string().trim().min(2, "Indiquez votre nom.").max(160),
  telephone: z.string().trim().regex(/^[+0-9 ().-]{6,40}$/, "Indiquez un numéro de téléphone valide."),
  description: z.string().trim().min(5, "Décrivez la panne en quelques mots.").max(1000),
});

export async function signalerPanneQr(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  if (!codeValide(code)) redirect("/connexion");
  // Champ piège invisible : rempli seulement par les robots.
  if (String(formData.get("site_web") ?? "")) redirect(`/a/${code}?panne=1`);
  const [a] = await db.select({ id: appareils.id }).from(appareils).where(eq(appareils.qrCode, code)).limit(1);
  if (!a) redirect(`/a/${code}`);
  const parsed = panneSchema.safeParse({ nom: formData.get("nom"), telephone: formData.get("telephone"), description: formData.get("description") });
  if (!parsed.success) redirect(`/a/${code}?erreurPanne=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Formulaire invalide")}#panne`);
  if ((await tropDeSignalements(a.id, null, parsed.data.telephone)) || (await tropDeSignalements(a.id, null, null))) {
    redirect(`/a/${code}?erreurPanne=${encodeURIComponent("Cette panne a déjà été signalée — ROBUS est prévenu.")}#panne`);
  }
  await enregistrerPanne({ appareilId: a.id, description: parsed.data.description, nom: parsed.data.nom, telephone: parsed.data.telephone, auteurId: null });
  redirect(`/a/${code}?panne=1`);
}
