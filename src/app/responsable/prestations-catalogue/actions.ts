"use server";

import { z } from "zod";
import { db } from "@/db";
import { checklistModeles, prestationsCatalogue } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { avecMessage } from "@/lib/url";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

const CATEGORIES = ["installation", "reparation", "maintenance", "vente_piece", "autre"] as const;
const TYPES_MISSION = ["preventive", "systematique", "corrective"] as const;

const catalogueSchema = z.object({
  nom: z.string().trim().min(2, "Nom requis"),
  categorie: z.enum(CATEGORIES),
  description: z.string().trim().max(2000).optional(),
  prixIndicatif: z.coerce.number().nonnegative().optional(),
  mode: z.enum(["ponctuelle", "contrat"]),
});

// Phase 24 : paramètres d'un « contrat à passages » (même principe que la garantie).
const contratSchema = z.object({
  dureeMois: z.coerce.number().int().min(1, "Durée du contrat : au moins 1 mois.").max(120, "Durée du contrat : 120 mois maximum."),
  nbPassages: z.coerce.number().int().min(1, "Au moins 1 passage.").max(120, "120 passages maximum."),
  typeMission: z.enum(TYPES_MISSION),
  anticipationJours: z.coerce.number().int().min(1, "Délai de création : au moins 1 jour.").max(90, "Délai de création : 90 jours maximum."),
  checklistModeleId: z.string().uuid().optional(),
});

type Valeurs = typeof prestationsCatalogue.$inferInsert;

async function lireFormulaire(formData: FormData): Promise<{ ok: true; v: Valeurs } | { ok: false; erreur: string }> {
  const base = catalogueSchema.safeParse({
    nom: formData.get("nom"),
    categorie: formData.get("categorie"),
    description: formData.get("description") || undefined,
    prixIndicatif: formData.get("prixIndicatif") || undefined,
    mode: formData.get("mode") === "contrat" ? "contrat" : "ponctuelle",
  });
  if (!base.success) return { ok: false, erreur: base.error.issues[0]?.message ?? "Données invalides" };
  const b = base.data;
  const v: Valeurs = {
    nom: b.nom,
    categorie: b.categorie,
    description: b.description || null,
    prixIndicatif: b.prixIndicatif != null ? String(b.prixIndicatif) : null,
    mode: b.mode,
    dureeMois: null,
    nbPassages: null,
    typeMission: null,
    anticipationJours: 30,
    checklistModeleId: null,
  };
  if (b.mode === "contrat") {
    if (b.categorie === "vente_piece") return { ok: false, erreur: "Une vente de pièce ne peut pas être un contrat à passages." };
    const c = contratSchema.safeParse({
      dureeMois: formData.get("dureeMois"),
      nbPassages: formData.get("nbPassages"),
      typeMission: formData.get("typeMission"),
      anticipationJours: formData.get("anticipationJours") || 30,
      checklistModeleId: formData.get("checklistModeleId") || undefined,
    });
    if (!c.success) return { ok: false, erreur: c.error.issues[0]?.message ?? "Paramètres du contrat invalides" };
    if (c.data.nbPassages > c.data.dureeMois * 4)
      return { ok: false, erreur: "Trop de passages pour cette durée (4 par mois au maximum)." };
    if (c.data.checklistModeleId) {
      const [m] = await db.select({ id: checklistModeles.id }).from(checklistModeles).where(eq(checklistModeles.id, c.data.checklistModeleId)).limit(1);
      if (!m) return { ok: false, erreur: "Modèle de checklist introuvable." };
    }
    Object.assign(v, {
      dureeMois: c.data.dureeMois,
      nbPassages: c.data.nbPassages,
      typeMission: c.data.typeMission,
      anticipationJours: c.data.anticipationJours,
      checklistModeleId: c.data.checklistModeleId ?? null,
    });
  }
  return { ok: true, v };
}

export async function createPrestationCatalogue(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const r = await lireFormulaire(formData);
  if (!r.ok) redirect(avecMessage("/responsable/prestations-catalogue", "erreur", r.erreur));
  const [cree] = await db.insert(prestationsCatalogue).values(r.v).returning({ id: prestationsCatalogue.id });
  await journaliser({
    entite: "prestation_catalogue",
    entiteId: cree.id,
    action: "prestation_catalogue_creee",
    utilisateurId: user.id,
    details: r.v.mode === "contrat" ? `${r.v.nom} — contrat ${r.v.dureeMois} mois / ${r.v.nbPassages} passage(s)` : r.v.nom,
  });
  revalidatePath("/responsable/prestations-catalogue");
  redirect(avecMessage("/responsable/prestations-catalogue", "ok", "Prestation créée."));
}

/** Corriger une prestation du catalogue. Les prestations déjà ajoutées aux projets ne changent pas. */
export async function updatePrestationCatalogue(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) redirect("/responsable/prestations-catalogue");
  const retour = `/responsable/prestations-catalogue?modifier=${id}#formulaire`;
  const [avant] = await db.select().from(prestationsCatalogue).where(eq(prestationsCatalogue.id, id)).limit(1);
  if (!avant) redirect(avecMessage("/responsable/prestations-catalogue", "erreur", "Prestation introuvable."));
  const r = await lireFormulaire(formData);
  if (!r.ok) redirect(avecMessage(retour, "erreur", r.erreur));
  await db.update(prestationsCatalogue).set(r.v).where(eq(prestationsCatalogue.id, id));
  await journaliser({
    entite: "prestation_catalogue",
    entiteId: id,
    action: "prestation_catalogue_modifiee",
    utilisateurId: user.id,
    details: avant!.nom === r.v.nom ? r.v.nom : `${avant!.nom} → ${r.v.nom}`,
  });
  revalidatePath("/responsable/prestations-catalogue");
  redirect(avecMessage("/responsable/prestations-catalogue", "ok", "Prestation enregistrée."));
}

export async function togglePrestationCatalogueActive(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const id = formData.get("id") as string;
  const [entree] = await db
    .select({ actif: prestationsCatalogue.actif })
    .from(prestationsCatalogue)
    .where(eq(prestationsCatalogue.id, id))
    .limit(1);
  if (!entree) throw new Error("Prestation du catalogue introuvable.");

  await db
    .update(prestationsCatalogue)
    .set({ actif: entree.actif === 1 ? 0 : 1 })
    .where(eq(prestationsCatalogue.id, id));

  revalidatePath("/responsable/prestations-catalogue");
}
