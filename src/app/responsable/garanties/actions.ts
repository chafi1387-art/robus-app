"use server";

import { creerMissionPassage, infoMissionPassage } from "@/lib/garantie-passages";
import { z } from "zod";
import { db } from "@/db";
import { garantieFormules, garantiePassages, interventions, users } from "@/db/schema";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
import { avecMessage } from "@/lib/url";
import { controlerHabilitations, messageManques } from "@/lib/habilitations";
import { envoyerMissionsAuTechnicien } from "@/lib/envoi-mission";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

const formuleSchema = z.object({
  nom: z.string().min(2, "Nom requis"),
  dureeMois: z.coerce.number().int().positive(),
  nombreInterventionsInclues: z.coerce.number().int().nonnegative(),
  prix: z.coerce.number().nonnegative(),
  optionExtensionDisponible: z.coerce.boolean().optional(),
  prixExtension: z.coerce.number().optional(),
});

export async function createGarantieFormule(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = formuleSchema.safeParse({
    nom: formData.get("nom"),
    dureeMois: formData.get("dureeMois"),
    nombreInterventionsInclues: formData.get("nombreInterventionsInclues"),
    prix: formData.get("prix"),
    optionExtensionDisponible: formData.get("optionExtensionDisponible") === "on",
    prixExtension: formData.get("prixExtension") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db.insert(garantieFormules).values({
    nom: parsed.data.nom,
    dureeMois: parsed.data.dureeMois,
    nombreInterventionsInclues: parsed.data.nombreInterventionsInclues,
    prix: String(parsed.data.prix),
    optionExtensionDisponible: parsed.data.optionExtensionDisponible ? 1 : 0,
    prixExtension: parsed.data.prixExtension != null ? String(parsed.data.prixExtension) : null,
  });

  revalidatePath("/responsable/garanties");
}

// Phase 24 : corriger une formule (nom, durée, passages, prix…). Les garanties
// déjà attribuées gardent leurs dates et leurs passages (copie figée).
export async function updateGarantieFormule(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("id") ?? "");
  const retour = `/responsable/garanties?modifier=${id}`;
  if (!z.string().uuid().safeParse(id).success) redirect("/responsable/garanties");
  const parsed = formuleSchema.safeParse({
    nom: String(formData.get("nom") ?? "").trim(),
    dureeMois: formData.get("dureeMois"),
    nombreInterventionsInclues: formData.get("nombreInterventionsInclues"),
    prix: formData.get("prix"),
    optionExtensionDisponible: formData.get("optionExtensionDisponible") === "on",
    prixExtension: formData.get("prixExtension") || undefined,
  });
  if (!parsed.success) redirect(avecMessage(retour, "erreur", parsed.error!.issues[0]?.message ?? "Données invalides"));
  const d = parsed.data!;
  const [avant] = await db.select().from(garantieFormules).where(eq(garantieFormules.id, id)).limit(1);
  if (!avant) redirect(avecMessage("/responsable/garanties", "erreur", "Formule introuvable."));
  await db
    .update(garantieFormules)
    .set({
      nom: d.nom,
      dureeMois: d.dureeMois,
      nombreInterventionsInclues: d.nombreInterventionsInclues,
      prix: String(d.prix),
      optionExtensionDisponible: d.optionExtensionDisponible ? 1 : 0,
      prixExtension: d.prixExtension != null ? String(d.prixExtension) : null,
    })
    .where(eq(garantieFormules.id, id));
  await journaliser({
    entite: "garantie_formule",
    entiteId: id,
    action: "formule_modifiee",
    utilisateurId: user.id,
    details: avant!.nom === d.nom ? d.nom : `${avant!.nom} → ${d.nom}`,
  });
  revalidatePath("/responsable/garanties");
  redirect(avecMessage("/responsable/garanties", "ok", "Formule enregistrée."));
}

export async function toggleGarantieFormuleActive(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const id = formData.get("id") as string;
  const [formule] = await db
    .select({ actif: garantieFormules.actif })
    .from(garantieFormules)
    .where(eq(garantieFormules.id, id))
    .limit(1);
  if (!formule) throw new Error("Formule introuvable.");

  await db
    .update(garantieFormules)
    .set({ actif: formule.actif === 1 ? 0 : 1 })
    .where(eq(garantieFormules.id, id));

  revalidatePath("/responsable/garanties");
}

// ==========================================================================
// Phase 19 — Passages de garantie : planifier (technicien + date) et décaler.
// ==========================================================================

export async function planifierPassage(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("passageId") ?? "");
  const retour = `/responsable/garanties/passages/${id}`;
  if (!z.string().uuid().safeParse(id).success) redirect("/responsable/garanties");
  const technicienId = String(formData.get("technicienId") ?? "");
  const date = new Date(String(formData.get("dateProgrammee") ?? ""));
  if (!z.string().uuid().safeParse(technicienId).success) redirect(avecMessage(retour, "erreur", "Choisissez le technicien."));
  if (Number.isNaN(date.getTime())) redirect(avecMessage(retour, "erreur", "Choisissez la date et l'heure du passage."));
  const info = await infoMissionPassage(id);
  if (!info || info.p.statut === "realise") redirect(retour);
  const p = { p: info!.p, projetId: info!.projetId, numero: info!.numeroAppareil, libelle: info!.libelle };
  const [tech] = await db.select({ nom: users.nom }).from(users).where(and(eq(users.id, technicienId), eq(users.role, "technicien"), eq(users.actif, 1))).limit(1);
  if (!tech) redirect(avecMessage(retour, "erreur", "Technicien introuvable."));

  let missionId = p.p.interventionId;
  if (missionId) {
    const [m] = await db.select({ statut: interventions.statut }).from(interventions).where(eq(interventions.id, missionId)).limit(1);
    if (!m) missionId = null;
    else if (!["creee", "planifiee", "affectee"].includes(m.statut)) redirect(avecMessage(retour, "erreur", "La mission de ce passage a déjà commencé."));
  }
  if (!missionId) {
    const m = await creerMissionPassage(id, date);
    if (!m) redirect(retour);
    missionId = m!.id;
  }
  const manques = await controlerHabilitations(technicienId, [missionId!]);
  if (manques.length) redirect(avecMessage(retour, "erreur", messageManques(tech!.nom, manques)));

  await db
    .update(interventions)
    .set({ technicienId, statut: "affectee", dateProgrammee: date, retardNotifieLe: null })
    .where(eq(interventions.id, missionId!));
  await envoyerMissionsAuTechnicien({ projetId: p.projetId, technicienId, interventionIds: [missionId!], envoyeParId: user.id });
  await journaliser({ entite: "garantie_passage", entiteId: id, action: "planifie", utilisateurId: user.id, details: `${p.numero} — ${p.libelle} — passage ${p.p.numero}/${p.p.total} — ${tech!.nom}` });
  revalidatePath("/responsable");
  redirect(avecMessage(retour, "ok", `Passage planifié et envoyé à ${tech!.nom}.`));
}

export async function decalerPassage(formData: FormData) {
  const user = await requireUser(["administrateur", "responsable_qualite"]);
  const id = String(formData.get("passageId") ?? "");
  const retour = `/responsable/garanties/passages/${id}`;
  if (!z.string().uuid().safeParse(id).success) redirect("/responsable/garanties");
  const motif = String(formData.get("motif") ?? "").trim().slice(0, 500);
  const date = new Date(`${String(formData.get("datePrevue") ?? "")}T09:00:00`);
  if (Number.isNaN(date.getTime())) redirect(avecMessage(retour, "erreur", "Nouvelle date invalide."));
  if (!motif) redirect(avecMessage(retour, "erreur", "Indiquez le motif du décalage."));
  const [p] = await db.select().from(garantiePassages).where(eq(garantiePassages.id, id)).limit(1);
  if (!p || p.statut === "realise") redirect(retour);
  await db.update(garantiePassages).set({ datePrevue: date, motifDecalage: motif }).where(eq(garantiePassages.id, id));
  await journaliser({
    entite: "garantie_passage",
    entiteId: id,
    action: "decale",
    utilisateurId: user.id,
    details: `${p!.datePrevue.toISOString().slice(0, 10)} → ${date.toISOString().slice(0, 10)} — ${motif}`,
  });
  revalidatePath("/responsable/garanties");
  redirect(avecMessage(retour, "ok", "Passage décalé."));
}
