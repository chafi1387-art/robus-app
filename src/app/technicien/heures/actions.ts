"use server";

import { z } from "zod";
import { db } from "@/db";
import { clients, heuresSousTraitance } from "@/db/schema";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import {
  aujourdhuiBruxelles,
  formatMinutes,
  JOURS_ARRIERE_MAX,
  peutModifierHeures,
  saisieEnMinutes,
} from "@/lib/sous-traitance";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const saisieSchema = z.object({
  clientId: z.string().uuid(),
  dateTravail: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  commentaire: z.string().max(500).optional(),
});

function retour(formData: FormData, defaut: string) {
  const r = String(formData.get("retour") ?? "");
  return r.startsWith("/technicien/heures") || r.startsWith("/responsable/sous-traitance") ? r : defaut;
}

function avecParam(url: string, cle: string, val: string) {
  const u = new URL(url, "http://x");
  u.searchParams.set(cle, val);
  return u.pathname + u.search;
}

async function verifierClientSousTraitance(clientId: string) {
  const [c] = await db
    .select({ id: clients.id, nom: clients.raisonSociale })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.type, "sous_traitance")))
    .limit(1);
  return c ?? null;
}

function dateAutorisee(d: string, role: string) {
  if (d > aujourdhuiBruxelles()) return false; // pas de date future
  if (role === "administrateur") return true;
  return d >= aujourdhuiBruxelles(-JOURS_ARRIERE_MAX);
}

function lireSaisie(formData: FormData) {
  const parsed = saisieSchema.safeParse({
    clientId: formData.get("clientId"),
    dateTravail: formData.get("dateTravail"),
    commentaire: String(formData.get("commentaire") ?? "").trim() || undefined,
  });
  const minutes = saisieEnMinutes(formData.get("heures"), formData.get("minutes"));
  return { parsed, minutes };
}

export async function creerHeuresSousTraitance(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const base = retour(formData, "/technicien/heures");
  const { parsed, minutes } = lireSaisie(formData);
  if (!parsed.success) redirect(avecParam(base, "erreur", "champs"));
  if (minutes === null) redirect(avecParam(base, "erreur", "duree"));
  if (!dateAutorisee(parsed.data.dateTravail, user.role)) redirect(avecParam(base, "erreur", "date"));
  const client = await verifierClientSousTraitance(parsed.data.clientId);
  if (!client) redirect(avecParam(base, "erreur", "client"));

  const [row] = await db
    .insert(heuresSousTraitance)
    .values({
      technicienId: user.id,
      clientId: client.id,
      dateTravail: parsed.data.dateTravail,
      minutes,
      commentaire: parsed.data.commentaire ?? null,
    })
    .returning({ id: heuresSousTraitance.id });

  await journaliser({
    entite: "heures_sous_traitance",
    entiteId: row.id,
    action: "creation",
    utilisateurId: user.id,
    details: `${client.nom} — ${parsed.data.dateTravail} — ${formatMinutes(minutes)}`,
  });
  revalidatePath("/technicien/heures");
  revalidatePath("/responsable/sous-traitance");
  redirect(avecParam(base, "ok", "1"));
}

async function chargerPourModif(id: string, userId: string, role: string) {
  const [row] = await db.select().from(heuresSousTraitance).where(eq(heuresSousTraitance.id, id)).limit(1);
  if (!row) return { erreur: "introuvable" as const };
  if (role === "administrateur") return { row };
  if (role !== "technicien" || row.technicienId !== userId) return { erreur: "droits" as const };
  if (!peutModifierHeures(row.createdAt, role)) return { erreur: "verrou" as const };
  return { row };
}

export async function modifierHeuresSousTraitance(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const base = retour(formData, "/technicien/heures");
  const id = String(formData.get("id") ?? "");
  const { row, erreur } = await chargerPourModif(id, user.id, user.role);
  if (!row) redirect(avecParam(base, "erreur", erreur));

  const { parsed, minutes } = lireSaisie(formData);
  if (!parsed.success) redirect(avecParam(base, "erreur", "champs"));
  if (minutes === null) redirect(avecParam(base, "erreur", "duree"));
  if (!dateAutorisee(parsed.data.dateTravail, user.role)) redirect(avecParam(base, "erreur", "date"));
  const client = await verifierClientSousTraitance(parsed.data.clientId);
  if (!client) redirect(avecParam(base, "erreur", "client"));

  await db
    .update(heuresSousTraitance)
    .set({
      clientId: client.id,
      dateTravail: parsed.data.dateTravail,
      minutes,
      commentaire: parsed.data.commentaire ?? null,
      updatedAt: new Date(),
    })
    .where(eq(heuresSousTraitance.id, row.id));

  await journaliser({
    entite: "heures_sous_traitance",
    entiteId: row.id,
    action: "modification",
    utilisateurId: user.id,
    details: `Avant : ${row.dateTravail} — ${formatMinutes(row.minutes)} / Après : ${client.nom} — ${parsed.data.dateTravail} — ${formatMinutes(minutes)}`,
  });
  revalidatePath("/technicien/heures");
  revalidatePath("/responsable/sous-traitance");
  redirect(avecParam(base, "ok", "2"));
}

export async function supprimerHeuresSousTraitance(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const base = retour(formData, "/technicien/heures");
  const id = String(formData.get("id") ?? "");
  const { row, erreur } = await chargerPourModif(id, user.id, user.role);
  if (!row) redirect(avecParam(base, "erreur", erreur));

  await db.delete(heuresSousTraitance).where(eq(heuresSousTraitance.id, row.id));
  await journaliser({
    entite: "heures_sous_traitance",
    entiteId: row.id,
    action: "suppression",
    utilisateurId: user.id,
    details: `${row.dateTravail} — ${formatMinutes(row.minutes)} (technicien ${row.technicienId})`,
  });
  revalidatePath("/technicien/heures");
  revalidatePath("/responsable/sous-traitance");
  redirect(avecParam(base, "ok", "3"));
}
