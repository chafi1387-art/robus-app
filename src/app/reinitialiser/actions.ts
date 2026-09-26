"use server";

import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { reinitialisationsMotDePasse, users } from "@/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";

export async function reinitialiserMotDePasse(formData: FormData) {
  const jeton = String(formData.get("jeton") ?? "");
  const mdp = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  const retour = (e: string) => redirect(`/reinitialiser?jeton=${encodeURIComponent(jeton)}&erreur=${e}`);
  if (!/^[0-9a-f]{64}$/.test(jeton)) redirect("/reinitialiser?erreur=lien");
  if (mdp.length < 8) retour("court");
  if (mdp !== confirmation) retour("different");

  const hash = createHash("sha256").update(jeton).digest("hex");
  const [demande] = await db
    .select()
    .from(reinitialisationsMotDePasse)
    .where(and(eq(reinitialisationsMotDePasse.jetonHash, hash), isNull(reinitialisationsMotDePasse.utiliseLe), gt(reinitialisationsMotDePasse.expireLe, new Date())))
    .limit(1);
  if (!demande) redirect("/reinitialiser?erreur=lien");

  await db.update(users).set({ passwordHash: await bcrypt.hash(mdp, 10) }).where(eq(users.id, demande.userId));
  // Tous les liens encore ouverts de ce compte deviennent inutilisables.
  await db.update(reinitialisationsMotDePasse).set({ utiliseLe: new Date() }).where(and(eq(reinitialisationsMotDePasse.userId, demande.userId), isNull(reinitialisationsMotDePasse.utiliseLe)));
  await journaliser({ entite: "utilisateur", entiteId: demande.userId, action: "mot_de_passe_reinitialise", utilisateurId: demande.userId });
  redirect("/connexion?reinit=1");
}
