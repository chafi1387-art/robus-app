"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { interventions, nonConformites, projets, signalements } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { avecMessage } from "@/lib/url";
import { notifierTechnicienSignalement } from "@/lib/signalements";
import { TYPES_SIGNALEMENT } from "@/lib/signalements-types";
import { REINIT_ENVOI, STATUTS_NON_COMMENCES } from "@/lib/missions";

// Phase 21 : traitement d'un signalement par le bureau. Prise en charge,
// réponse au technicien, clôture (mesure prise obligatoire), non-conformité
// (ISO 9001 §10.2), mission remise à affecter. La décision finale revient
// toujours à l'administrateur / au responsable qualité.

const GESTION = ["administrateur", "responsable_qualite"] as const;
const uuid = z.string().uuid();

async function charger(formData: FormData) {
  const id = String(formData.get("signalementId") ?? "");
  if (!uuid.safeParse(id).success) redirect("/responsable/signalements");
  const [s] = await db.select().from(signalements).where(eq(signalements.id, id)).limit(1);
  if (!s) redirect("/responsable/signalements");
  return s!;
}

const page = (id: string) => `/responsable/signalements/${id}`;

export async function prendreEnChargeSignalement(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const s = await charger(formData);
  if (s.statut !== "nouveau") redirect(page(s.id));
  const message = String(formData.get("message") ?? "").trim().slice(0, 2000);
  const maintenant = new Date();
  await db
    .update(signalements)
    .set({
      statut: "pris_en_charge",
      prisEnChargeLe: maintenant,
      prisEnChargeParId: user.id,
      ...(message ? { reponse: message, reponseLe: maintenant } : {}),
      updatedAt: maintenant,
    })
    .where(eq(signalements.id, s.id));
  await journaliser({ entite: "signalement", entiteId: s.id, action: "pris_en_charge", utilisateurId: user.id, details: message || null });
  await notifierTechnicienSignalement(s.id, "👍 Signalement pris en charge", message || `Le bureau s'occupe de votre signalement ${s.numero}.`);
  revalidatePath(page(s.id));
  revalidatePath("/responsable/signalements");
  redirect(avecMessage(page(s.id), "ok", "Signalement pris en charge — le technicien est prévenu."));
}

export async function repondreSignalement(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const s = await charger(formData);
  const message = String(formData.get("message") ?? "").trim().slice(0, 2000);
  if (!message) redirect(avecMessage(page(s.id), "erreur", "Écrivez la réponse."));
  const maintenant = new Date();
  await db
    .update(signalements)
    .set({
      reponse: message,
      reponseLe: maintenant,
      ...(s.statut === "nouveau" ? { statut: "pris_en_charge", prisEnChargeLe: maintenant, prisEnChargeParId: user.id } : {}),
      updatedAt: maintenant,
    })
    .where(eq(signalements.id, s.id));
  await journaliser({ entite: "signalement", entiteId: s.id, action: "reponse", utilisateurId: user.id, details: message });
  await notifierTechnicienSignalement(s.id, "💬 Réponse du bureau", message);
  revalidatePath(page(s.id));
  redirect(avecMessage(page(s.id), "ok", "Réponse envoyée au technicien."));
}

export async function cloturerSignalement(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const s = await charger(formData);
  const message = String(formData.get("message") ?? "").trim().slice(0, 2000);
  if (!message) redirect(avecMessage(page(s.id), "erreur", "Indiquez la mesure prise / la conclusion avant de clôturer."));
  const maintenant = new Date();
  await db
    .update(signalements)
    .set({
      statut: "cloture",
      reponse: message,
      reponseLe: maintenant,
      clotureLe: maintenant,
      clotureParId: user.id,
      prisEnChargeLe: s.prisEnChargeLe ?? maintenant,
      prisEnChargeParId: s.prisEnChargeParId ?? user.id,
      updatedAt: maintenant,
    })
    .where(eq(signalements.id, s.id));
  await journaliser({ entite: "signalement", entiteId: s.id, action: "cloture", utilisateurId: user.id, details: message });
  await notifierTechnicienSignalement(s.id, "✅ Signalement clôturé", message);
  revalidatePath(page(s.id));
  revalidatePath("/responsable/signalements");
  redirect(avecMessage(page(s.id), "ok", "Signalement clôturé."));
}

export async function rouvrirSignalement(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const s = await charger(formData);
  if (s.statut !== "cloture") redirect(page(s.id));
  await db.update(signalements).set({ statut: "pris_en_charge", clotureLe: null, clotureParId: null, updatedAt: new Date() }).where(eq(signalements.id, s.id));
  await journaliser({ entite: "signalement", entiteId: s.id, action: "rouvert", utilisateurId: user.id });
  revalidatePath(page(s.id));
  redirect(avecMessage(page(s.id), "ok", "Signalement rouvert."));
}

/** Accident, presque accident, matériel, accès : traçabilité ISO via une non-conformité. */
export async function creerNcDepuisSignalement(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const s = await charger(formData);
  if (s.nonConformiteId) redirect(`/responsable/non-conformites`);
  const gravite = s.gravite === "critique" ? "critique" : s.gravite === "elevee" ? "majeure" : "mineure";
  let clientId: string | null = null;
  if (s.projetId) {
    const [p] = await db.select({ clientId: projets.clientId }).from(projets).where(eq(projets.id, s.projetId)).limit(1);
    clientId = p?.clientId ?? null;
  }
  const t = TYPES_SIGNALEMENT[s.type];
  const [nc] = await db
    .insert(nonConformites)
    .values({
      titre: `${t?.label ?? "Signalement"} — ${s.numero}`.slice(0, 200),
      description: `${s.description}${s.lieu ? `\nLieu : ${s.lieu}` : ""}${s.blesse ? "\nPersonne blessée." : ""}\n(Créée depuis le signalement ${s.numero})`,
      gravite,
      appareilId: s.appareilId,
      interventionId: s.interventionId,
      clientId,
      declarantId: s.technicienId,
      responsableActionId: user.id,
    })
    .returning({ id: nonConformites.id });
  await db.update(signalements).set({ nonConformiteId: nc.id, updatedAt: new Date() }).where(eq(signalements.id, s.id));
  await journaliser({ entite: "signalement", entiteId: s.id, action: "non_conformite_creee", utilisateurId: user.id, details: nc.id });
  revalidatePath(page(s.id));
  redirect(avecMessage(page(s.id), "ok", "Non-conformité créée — suivez l'action corrective dans « Non-conformités »."));
}

/** Mission bloquée par le signalement : l'admin la remet « à affecter ». */
export async function libererMissionSignalement(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const s = await charger(formData);
  if (!s.interventionId) redirect(page(s.id));
  const maj = await db
    .update(interventions)
    .set({ technicienId: null, statut: "creee", ...REINIT_ENVOI })
    .where(and(eq(interventions.id, s.interventionId!), inArray(interventions.statut, [...STATUTS_NON_COMMENCES])))
    .returning({ id: interventions.id });
  if (!maj.length) redirect(avecMessage(page(s.id), "erreur", "La mission est déjà commencée ou terminée : elle reste au technicien."));
  await journaliser({ entite: "intervention", entiteId: s.interventionId!, action: "mission_liberee", utilisateurId: user.id, details: `Suite au signalement ${s.numero}` });
  revalidatePath(page(s.id));
  redirect(avecMessage(page(s.id), "ok", "Mission remise « à affecter » — réaffectez-la dans le Planning des missions."));
}
