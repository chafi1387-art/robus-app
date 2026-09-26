"use server";

import { createHash, randomBytes } from "node:crypto";
import { db } from "@/db";
import { reinitialisationsMotDePasse, users } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { envoyerLienReinitialisation } from "@/lib/mail";
import { journaliser } from "@/lib/journal";

export async function demanderReinitialisation(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  // Réponse identique que le compte existe ou non (on ne révèle pas les emails).
  if (email) {
    const [u] = await db.select({ id: users.id, nom: users.nom, email: users.email, actif: users.actif }).from(users).where(eq(users.email, email)).limit(1);
    if (u && u.actif === 1) {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(reinitialisationsMotDePasse)
        .where(and(eq(reinitialisationsMotDePasse.userId, u.id), gte(reinitialisationsMotDePasse.createdAt, sql`now() - interval '1 hour'`)));
      if (n < 5) {
        const jeton = randomBytes(32).toString("hex");
        await db.insert(reinitialisationsMotDePasse).values({
          userId: u.id,
          jetonHash: createHash("sha256").update(jeton).digest("hex"),
          expireLe: new Date(Date.now() + 30 * 60 * 1000),
        });
        const base = process.env.NEXTAUTH_URL || "https://robuswork.tech";
        const ok = await envoyerLienReinitialisation({ email: u.email, nom: u.nom, lien: `${base}/reinitialiser?jeton=${jeton}` });
        await journaliser({ entite: "utilisateur", entiteId: u.id, action: ok ? "reinit_mdp_demandee" : "reinit_mdp_email_echec", utilisateurId: u.id });
      }
    }
  }
  redirect("/mot-de-passe-oublie?envoye=1");
}
