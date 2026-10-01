import "server-only";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export type Role = "administrateur" | "responsable_qualite" | "technicien" | "commercial" | "observateur";

export const ROLE_HOME: Record<string, string> = {
  administrateur: "/responsable",
  responsable_qualite: "/responsable",
  commercial: "/responsable",
  technicien: "/technicien",
  observateur: "/observateur",
};

/**
 * À appeler en tête de chaque Server Action et de chaque page serveur sensible.
 * Le Proxy (ex-middleware) protège déjà les routes, mais toute Server Function
 * reste joignable directement en POST : elle doit vérifier elle-même la session.
 */
export async function requireUser(allowedRoles?: Role[]) {
  const session = await auth();
  if (!session?.user) {
    redirect("/connexion");
  }
  const role = session.user.role as Role;
  if (allowedRoles && !allowedRoles.includes(role)) {
    redirect(ROLE_HOME[role] ?? "/connexion");
  }
  return { ...session.user, role };
}

export const ROLES_BUREAU: Role[] = ["administrateur", "responsable_qualite", "commercial"];
export const ROLES_TECHNICIEN: Role[] = ["administrateur", "technicien"];
