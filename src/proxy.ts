import { auth } from "@/auth";
import { NextResponse } from "next/server";

const ROLE_HOME: Record<string, string> = {
  administrateur: "/responsable",
  responsable_qualite: "/responsable",
  commercial: "/responsable",
  technicien: "/technicien",
};

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
    pathname.startsWith("/api/auth");
  const session = req.auth;

  if (isPublic) {
    if (session?.user?.role && pathname === "/connexion") {
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

  if (pathname.startsWith("/responsable") && role === "technicien") {
    return NextResponse.redirect(new URL("/technicien", req.nextUrl));
  }
  if (pathname.startsWith("/technicien") && role !== "technicien" && role !== "administrateur") {
    return NextResponse.redirect(new URL("/responsable", req.nextUrl));
  }
  if (pathname === "/") {
    return NextResponse.redirect(new URL(ROLE_HOME[role] ?? "/connexion", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
