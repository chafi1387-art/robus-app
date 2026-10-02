"use server";

import { z } from "zod";
import { db } from "@/db";
import { checklistItems, checklistModeles } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { avecMessage } from "@/lib/url";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";

// Modèles de checklist. Phase 23 : sections, tâches obligatoires, mesures
// avec limites, ordre, versions (une mission garde la copie de la version
// qu'elle a reçue — modifier un modèle ne touche jamais une mission passée).

const TYPES = ["preventive", "corrective", "systematique"] as const;
const uuid = z.string().uuid();
const page = (id: string) => `/responsable/checklists/${id}`;

const modeleSchema = z.object({
  nom: z.string().trim().min(2, "Nom requis").max(200),
  typeIntervention: z.enum(TYPES).optional(),
  marque: z.string().trim().max(80).optional(),
  typeAppareil: z.string().trim().max(80).optional(),
  description: z.string().trim().max(1000).optional(),
});

function lireModele(formData: FormData) {
  const t = String(formData.get("typeIntervention") ?? "");
  return modeleSchema.safeParse({
    nom: formData.get("nom"),
    typeIntervention: t ? t : undefined,
    marque: String(formData.get("marque") ?? "").trim() || undefined,
    typeAppareil: String(formData.get("typeAppareil") ?? "").trim() || undefined,
    description: String(formData.get("description") ?? "").trim() || undefined,
  });
}

async function nouvelleVersion(modeleId: string) {
  await db
    .update(checklistModeles)
    .set({ version: sql`${checklistModeles.version} + 1`, updatedAt: new Date() })
    .where(eq(checklistModeles.id, modeleId));
}

export async function createChecklistModele(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = lireModele(formData);
  if (!parsed.success) redirect(avecMessage("/responsable/checklists", "erreur", parsed.error.issues[0]?.message ?? "Données invalides"));
  const [created] = await db
    .insert(checklistModeles)
    .values({
      nom: parsed.data!.nom,
      typeIntervention: parsed.data!.typeIntervention ?? null,
      marque: parsed.data!.marque ?? null,
      typeAppareil: parsed.data!.typeAppareil ?? null,
      description: parsed.data!.description ?? null,
    })
    .returning();
  await journaliser({ entite: "checklist", entiteId: created.id, action: "modele_cree", utilisateurId: user.id, details: created.nom });
  revalidatePath("/responsable/checklists");
  redirect(avecMessage(page(created.id), "ok", "Modèle créé — ajoutez maintenant ses tâches."));
}

export async function modifierChecklistModele(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("modeleId") ?? "");
  if (!uuid.safeParse(id).success) redirect("/responsable/checklists");
  const parsed = lireModele(formData);
  if (!parsed.success) redirect(avecMessage(page(id), "erreur", parsed.error.issues[0]?.message ?? "Données invalides"));
  await db
    .update(checklistModeles)
    .set({
      nom: parsed.data!.nom,
      typeIntervention: parsed.data!.typeIntervention ?? null,
      marque: parsed.data!.marque ?? null,
      typeAppareil: parsed.data!.typeAppareil ?? null,
      description: parsed.data!.description ?? null,
      updatedAt: new Date(),
    })
    .where(eq(checklistModeles.id, id));
  await journaliser({ entite: "checklist", entiteId: id, action: "modele_modifie", utilisateurId: user.id, details: parsed.data!.nom });
  revalidatePath(page(id));
  revalidatePath("/responsable/checklists");
  redirect(avecMessage(page(id), "ok", "Modèle enregistré."));
}

const tacheSchema = z.object({
  libelle: z.string().trim().min(1, "Libellé requis").max(200),
  section: z.string().trim().max(80).optional(),
  obligatoire: z.boolean(),
  type: z.enum(["case", "mesure"]),
  unite: z.string().trim().max(20).optional(),
  valeurMin: z.number().optional(),
  valeurMax: z.number().optional(),
});

function nombre(v: FormDataEntryValue | null) {
  const t = String(v ?? "").trim().replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isNaN(n) ? NaN : n;
}

function lireTache(formData: FormData) {
  const min = nombre(formData.get("valeurMin"));
  const max = nombre(formData.get("valeurMax"));
  if (Number.isNaN(min) || Number.isNaN(max)) return { success: false as const, message: "Les limites doivent être des nombres." };
  const type = formData.get("type") === "mesure" ? "mesure" : "case";
  const p = tacheSchema.safeParse({
    libelle: formData.get("libelle"),
    section: String(formData.get("section") ?? "").trim() || undefined,
    obligatoire: formData.get("obligatoire") === "on",
    type,
    unite: String(formData.get("unite") ?? "").trim() || undefined,
    valeurMin: min,
    valeurMax: max,
  });
  if (!p.success) return { success: false as const, message: p.error.issues[0]?.message ?? "Tâche invalide." };
  if (type === "mesure" && min === undefined && max === undefined) return { success: false as const, message: "Mesure : indiquez au moins une limite (minimum ou maximum)." };
  if (min !== undefined && max !== undefined && min > max) return { success: false as const, message: "Le minimum doit être inférieur au maximum." };
  return { success: true as const, data: p.data };
}

async function prochainOrdre(modeleId: string) {
  const [r] = await db.select({ m: sql<number>`coalesce(max(${checklistItems.ordre}), -1)::int` }).from(checklistItems).where(eq(checklistItems.modeleId, modeleId));
  return (r?.m ?? -1) + 1;
}

/** Ajout d'une tâche (avec options) ou de plusieurs (une par ligne, cases ✓/✗). */
export async function addChecklistItem(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const modeleId = String(formData.get("modeleId") ?? "");
  if (!uuid.safeParse(modeleId).success) redirect("/responsable/checklists");
  const [existe] = await db.select({ id: checklistModeles.id }).from(checklistModeles).where(eq(checklistModeles.id, modeleId)).limit(1);
  if (!existe) redirect("/responsable/checklists");
  let ordre = await prochainOrdre(modeleId);
  const lignes = String(formData.get("lignes") ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lignes.length) {
    const section = String(formData.get("section") ?? "").trim().slice(0, 80) || null;
    await db.insert(checklistItems).values(lignes.slice(0, 100).map((l) => ({ modeleId, libelle: l.slice(0, 200), section, obligatoire: 1, type: "case", ordre: ordre++ })));
    await nouvelleVersion(modeleId);
    await journaliser({ entite: "checklist", entiteId: modeleId, action: "taches_ajoutees", utilisateurId: user.id, details: `${lignes.length}` });
    revalidatePath(page(modeleId));
    redirect(avecMessage(page(modeleId), "ok", `${Math.min(lignes.length, 100)} tâche(s) ajoutée(s).`));
  }
  const t = lireTache(formData);
  if (!t.success) redirect(avecMessage(page(modeleId), "erreur", t.message));
  const d = t.data!;
  await db.insert(checklistItems).values({
    modeleId,
    libelle: d.libelle,
    section: d.section ?? null,
    obligatoire: d.obligatoire ? 1 : 0,
    type: d.type,
    unite: d.type === "mesure" ? (d.unite ?? null) : null,
    valeurMin: d.type === "mesure" && d.valeurMin !== undefined ? String(d.valeurMin) : null,
    valeurMax: d.type === "mesure" && d.valeurMax !== undefined ? String(d.valeurMax) : null,
    ordre,
  });
  await nouvelleVersion(modeleId);
  await journaliser({ entite: "checklist", entiteId: modeleId, action: "tache_ajoutee", utilisateurId: user.id, details: d.libelle });
  revalidatePath(page(modeleId));
  redirect(avecMessage(page(modeleId), "ok", "Tâche ajoutée."));
}

export async function modifierChecklistItem(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const modeleId = String(formData.get("modeleId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  if (!uuid.safeParse(modeleId).success || !uuid.safeParse(itemId).success) redirect("/responsable/checklists");
  const t = lireTache(formData);
  if (!t.success) redirect(avecMessage(page(modeleId), "erreur", t.message));
  const d = t.data!;
  await db
    .update(checklistItems)
    .set({
      libelle: d.libelle,
      section: d.section ?? null,
      obligatoire: d.obligatoire ? 1 : 0,
      type: d.type,
      unite: d.type === "mesure" ? (d.unite ?? null) : null,
      valeurMin: d.type === "mesure" && d.valeurMin !== undefined ? String(d.valeurMin) : null,
      valeurMax: d.type === "mesure" && d.valeurMax !== undefined ? String(d.valeurMax) : null,
    })
    .where(and(eq(checklistItems.id, itemId), eq(checklistItems.modeleId, modeleId)));
  await nouvelleVersion(modeleId);
  await journaliser({ entite: "checklist", entiteId: modeleId, action: "tache_modifiee", utilisateurId: user.id, details: d.libelle });
  revalidatePath(page(modeleId));
  redirect(avecMessage(page(modeleId), "ok", "Tâche modifiée — les missions déjà attribuées gardent l'ancienne version."));
}

export async function deplacerChecklistItem(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const modeleId = String(formData.get("modeleId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const sens = formData.get("sens") === "haut" ? -1 : 1;
  if (!uuid.safeParse(modeleId).success || !uuid.safeParse(itemId).success) redirect("/responsable/checklists");
  const items = await db
    .select({ id: checklistItems.id })
    .from(checklistItems)
    .where(and(eq(checklistItems.modeleId, modeleId), eq(checklistItems.actif, 1)))
    .orderBy(asc(checklistItems.ordre));
  const i = items.findIndex((x) => x.id === itemId);
  const j = i + sens;
  if (i >= 0 && j >= 0 && j < items.length) {
    [items[i], items[j]] = [items[j], items[i]];
    for (const [k, it] of items.entries()) await db.update(checklistItems).set({ ordre: k }).where(eq(checklistItems.id, it.id));
    await nouvelleVersion(modeleId);
  }
  revalidatePath(page(modeleId));
  redirect(page(modeleId));
}

/** Retrait « doux » : la tâche disparaît du modèle mais reste dans les rapports passés. */
export async function removeChecklistItem(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const modeleId = String(formData.get("modeleId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  if (!uuid.safeParse(modeleId).success || !uuid.safeParse(itemId).success) redirect("/responsable/checklists");
  await db.update(checklistItems).set({ actif: 0 }).where(and(eq(checklistItems.id, itemId), eq(checklistItems.modeleId, modeleId)));
  await nouvelleVersion(modeleId);
  await journaliser({ entite: "checklist", entiteId: modeleId, action: "tache_retiree", utilisateurId: user.id, details: itemId });
  revalidatePath(page(modeleId));
  redirect(avecMessage(page(modeleId), "ok", "Tâche retirée du modèle."));
}

export async function dupliquerChecklistModele(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const modeleId = String(formData.get("modeleId") ?? "");
  if (!uuid.safeParse(modeleId).success) redirect("/responsable/checklists");
  const [m] = await db.select().from(checklistModeles).where(eq(checklistModeles.id, modeleId)).limit(1);
  if (!m) redirect("/responsable/checklists");
  const [copie] = await db
    .insert(checklistModeles)
    .values({ nom: `${m!.nom} (copie)`.slice(0, 200), typeIntervention: m!.typeIntervention, marque: m!.marque, typeAppareil: m!.typeAppareil, description: m!.description, actif: 0 })
    .returning({ id: checklistModeles.id });
  const items = await db.select().from(checklistItems).where(and(eq(checklistItems.modeleId, modeleId), eq(checklistItems.actif, 1))).orderBy(asc(checklistItems.ordre));
  if (items.length) {
    await db.insert(checklistItems).values(
      items.map((it, k) => ({ modeleId: copie.id, libelle: it.libelle, section: it.section, obligatoire: it.obligatoire, type: it.type, unite: it.unite, valeurMin: it.valeurMin, valeurMax: it.valeurMax, ordre: k }))
    );
  }
  await journaliser({ entite: "checklist", entiteId: copie.id, action: "modele_duplique", utilisateurId: user.id, details: m!.nom });
  revalidatePath("/responsable/checklists");
  redirect(avecMessage(page(copie.id), "ok", "Copie créée (inactive) — adaptez-la puis activez-la."));
}

const toggleSchema = z.object({
  modeleId: z.string().uuid(),
  actif: z.coerce.number().int(),
});

export async function toggleChecklistModeleActif(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = toggleSchema.safeParse({
    modeleId: formData.get("modeleId"),
    actif: formData.get("actif"),
  });
  if (!parsed.success) redirect("/responsable/checklists");
  await db
    .update(checklistModeles)
    .set({ actif: parsed.data!.actif ? 0 : 1 })
    .where(eq(checklistModeles.id, parsed.data!.modeleId));
  revalidatePath("/responsable/checklists");
  revalidatePath(page(parsed.data!.modeleId));
}
