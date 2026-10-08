import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Phase 25 : « Annuler » pendant quelques secondes après un retrait (photo…).
// Le message de confirmation porte un jeton signé décrivant ce qui a été
// retiré ; seul l'auteur du retrait peut l'utiliser, pendant 2 minutes.

export type Annulation =
  | { k: "photo_rapport"; rapportId: string; url: string; interventionId: string }
  | { k: "photo_bureau"; rapportId: string; url: string; interventionId: string };

const DUREE_MS = 2 * 60 * 1000;

function sig(charge: string) {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
  return createHmac("sha256", s).update(`annulation|${charge}`).digest("base64url");
}

export function signerAnnulation(userId: string, a: Annulation) {
  const charge = Buffer.from(JSON.stringify({ ...a, p: userId, e: Date.now() + DUREE_MS })).toString("base64url");
  return `${charge}.${sig(charge)}`;
}

export function lireAnnulation(jeton: string, userId: string): Annulation | null {
  const i = jeton.lastIndexOf(".");
  if (i < 1) return null;
  const charge = jeton.slice(0, i);
  const s = jeton.slice(i + 1);
  const att = sig(charge);
  if (s.length !== att.length || !timingSafeEqual(Buffer.from(s), Buffer.from(att))) return null;
  const d = JSON.parse(Buffer.from(charge, "base64url").toString("utf8")) as Annulation & { p: string; e: number };
  if (d.p !== userId || d.e < Date.now()) return null;
  return d;
}

/** Ajoute ?annuler=<jeton> à une URL (avant l'ancre). */
export function avecAnnulation(url: string, jeton: string) {
  const [sansAncre, ancre] = url.split("#");
  const sep = sansAncre.includes("?") ? "&" : "?";
  return `${sansAncre}${sep}annuler=${encodeURIComponent(jeton)}${ancre ? `#${ancre}` : ""}`;
}
