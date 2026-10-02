import { auth } from "@/auth";
import { NextResponse } from "next/server";

const ROLE_HOME: Record<string, string> = {
  administrateur: "/responsable",
  responsable_qualite: "/responsable",
  commercial: "/responsable",
  technicien: "/technicien",
  observateur: "/observateur",
};
const BUREAU = new Set(["administrateur", "responsable_qualite", "commercial"]);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  // /api/auth-check répond lui-même 204/401 (utilisé par nginx pour /uploads/)
  const isPublic =
    pathname === "/connexion" ||
    pathname === "/mot-de-passe-oublie" ||
    pathname === "/reinitialiser" ||
    // Phase 16 : fichiers de l'application installable, lisibles sans connexion.
    pathname === "/sw.js" ||
    pathname === "/api/cron/retards" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons/") ||
    // Phase 18 : étiquette QR d'un appareil (page publique, sans donnée sensible).
    pathname.startsWith("/a/") ||
    pathname.startsWith("/api/auth");
  const session = req.auth;

  if (isPublic) {
    // Avec ?erreur= (ex. accès observateur expiré) on reste sur la page de connexion.
    if (session?.user?.role && pathname === "/connexion" && !req.nextUrl.searchParams.has("erreur")) {
      return NextResponse.redirect(
        new URL(ROLE_HOME[session.user.role] ?? "/", req.nextUrl)
      );
    }
    return NextResponse.next();
  }

  if (!session?.user) {
    const loginUrl = new URL("/connexion", req.nextUrl);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const role = session.user.role;

  const home = new URL(ROLE_HOME[role] ?? "/connexion", req.nextUrl);
  if (pathname.startsWith("/responsable") && !BUREAU.has(role)) {
    return NextResponse.redirect(home);
  }
  if (pathname.startsWith("/technicien") && role !== "technicien" && role !== "administrateur") {
    return NextResponse.redirect(home);
  }
  // Phase 18 : l'espace Observateur est réservé aux observateurs, et un
  // observateur n'accède qu'à son espace (+ notifications / API d'auth).
  if (pathname.startsWith("/observateur") && role !== "observateur") {
    return NextResponse.redirect(home);
  }
  if (role === "observateur" && !pathname.startsWith("/observateur") && !pathname.startsWith("/api/auth") && pathname !== "/api/auth-check" && !pathname.startsWith("/notifications")) {
    return NextResponse.redirect(home);
  }
  if (pathname === "/") {
    return NextResponse.redirect(new URL(ROLE_HOME[role] ?? "/connexion", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  // Phase 21 : le logo, les icônes et le service worker ne passent plus par
  // le contrôle de session (moins de travail par page). Les fichiers
  // envoyés (/uploads/) restent protégés.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo-robus.png|icons/|sw.js|manifest.webmanifest).*)"],
};
