import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// ==========================================================================
// Phase 25 — Envoi des fichiers une par une, avec suivi.
//
// Le navigateur envoie chaque photo / fichier séparément à
// /api/televersement (barre de progression, ✓ / ✗ par fichier). Le serveur
// l'enregistre tout de suite et renvoie une « référence » signée
// (HMAC AUTH_SECRET) : le formulaire ne transporte plus que ces références.
// Une référence n'est valable que pour la personne qui a envoyé le fichier,
// 24 h, et uniquement pour un fichier qui existe vraiment sous /uploads/.
// ==========================================================================

export const DOSSIERS_TELEVERSEMENT = ["rapports", "missions", "signalements", "habilitations", "formations", "devis"] as const;
export type DossierTeleversement = (typeof DOSSIERS_TELEVERSEMENT)[number];

export const TYPES_PHOTO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const TYPES_FICHIER: Record<string, string> = {
  ...TYPES_PHOTO,
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};
export const PHOTO_MAX = 8 * 1024 * 1024;
export const FICHIER_MAX = 20 * 1024 * 1024;
const DUREE_REF_MS = 24 * 3600 * 1000;

function secret() {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET manquant");
  return s;
}

function signature(contenu: string) {
  return createHmac("sha256", secret()).update(`televersement|${contenu}`).digest("base64url");
}

/** Référence : base64url(JSON {u: url, n: nom d'origine, e: expiration, p: utilisateur}).signature */
export function creerReference(userId: string, url: string, nom: string) {
  const charge = Buffer.from(JSON.stringify({ u: url, n: nom.slice(0, 160), e: Date.now() + DUREE_REF_MS, p: userId })).toString("base64url");
  return `ref:${charge}.${signature(charge)}`;
}

export function estReference(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("ref:");
}

const URL_SURE = /^\/uploads\/([a-z]+)\/[A-Za-z0-9._-]+$/;

/**
 * Vérifie une référence et renvoie le fichier qu'elle désigne — ou une
 * erreur explicite (référence modifiée, expirée, d'un autre utilisateur…).
 */
export async function lireReference(ref: string, userId: string, dossiersPermis: readonly string[]) {
  const corps = ref.slice(4);
  const point = corps.lastIndexOf(".");
  if (point < 1) throw new Error("Fichier envoyé invalide — renvoyez-le.");
  const charge = corps.slice(0, point);
  const sig = corps.slice(point + 1);
  const attendue = signature(charge);
  if (sig.length !== attendue.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(attendue))) {
    throw new Error("Fichier envoyé invalide — renvoyez-le.");
  }
  const d = JSON.parse(Buffer.from(charge, "base64url").toString("utf8")) as { u: string; n: string; e: number; p: string };
  if (d.p !== userId) throw new Error("Ce fichier a été envoyé par une autre personne.");
  if (d.e < Date.now()) throw new Error("Envoi trop ancien (plus de 24 h) — renvoyez le fichier.");
  const m = URL_SURE.exec(d.u);
  if (!m || !dossiersPermis.includes(m[1])) throw new Error("Fichier envoyé invalide — renvoyez-le.");
  try {
    await stat(path.join(process.cwd(), "public", d.u));
  } catch {
    throw new Error("Fichier introuvable sur le serveur — renvoyez-le.");
  }
  return { url: d.u, nom: d.n };
}

/** Enregistre le fichier (et sa miniature éventuelle) sous public/uploads/<dossier>/. */
export async function enregistrerTeleversement(
  dossier: DossierTeleversement,
  prefixe: string,
  fichier: File,
  extension: string,
  miniature?: File | null
) {
  const rep = path.join(process.cwd(), "public", "uploads", dossier);
  await mkdir(rep, { recursive: true });
  const base = `${prefixe}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const nom = `${base}.${extension}`;
  await writeFile(path.join(rep, nom), Buffer.from(await fichier.arrayBuffer()));
  // Miniature (≈ 30 Ko) fabriquée par le téléphone : affichée dans les listes et galeries.
  if (miniature && miniature.size > 0 && miniature.size < 600 * 1024 && miniature.type === "image/jpeg") {
    await writeFile(path.join(rep, `${base}.mini.jpg`), Buffer.from(await miniature.arrayBuffer()));
  }
  return `/uploads/${dossier}/${nom}`;
}
