"use server";

import { attribuerParDefaut } from "@/lib/checklists";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { demandesClient, interventions, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { avecMessage } from "@/lib/url";
import { enregistrerFichiers, fichiersDuFormulaire } from "@/lib/fichiers";
import { ajouterMessage, changerStatutDemande, notifierClient } from "@/lib/demandes";
import { controlerHabilitations, messageManques } from "@/lib/habilitations";
import { envoyerMissionsAuTechnicien } from "@/lib/envoi-mission";
import { dernierProjetAppareil } from "@/lib/observateur";

// Phase 20 : traitement des demandes client par le bureau.
const page = (id: string, ancre = "") => `/responsable/demandes/${id}${ancre}`;

async function lire(id: string) {
  if (!z.string().uuid().safeParse(id).success) redirect("/responsable/demandes");
  const [d] = await db.select().from(demandesClient).where(eq(demandesClient.id, id)).limit(1);
  if (!d) redirect("/responsable/demandes");
  return d!;
}

export async function prendreEnCharge(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("demandeId") ?? "");
  const d = await lire(id);
  if (d.statut !== "nouvelle") redirect(page(id));
  const prenom = (user.name ?? "").split(" ")[0] || "notre équipe";
  await changerStatutDemande(id, "prise_en_charge", user.id, `Votre demande est prise en charge par ${prenom}.`);
  revalidatePath(page(id));
  redirect(avecMessage(page(id), "ok", "Demande prise en charge — le client est prévenu."));
}

export async function repondreDemande(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("demandeId") ?? "");
  const d = await lire(id);
  const texte = String(formData.get("texte") ?? "").trim().slice(0, 5000);
  let joints: { url: string; nom: string }[] = [];
  try {
    const f = fichiersDuFormulaire(formData, "fichiers", 5);
    joints = f.length ? await enregistrerFichiers(f, "missions", `demande-${id}`) : [];
  } catch (e) {
    redirect(avecMessage(page(id, "#fil"), "erreur", (e as Error).message));
  }
  if (!texte && !joints.length) redirect(avecMessage(page(id, "#fil"), "erreur", "Écrivez un message ou joignez un fichier."));
  await ajouterMessage(id, "bureau", texte || null, user.id, joints);
  if (d.statut === "nouvelle") {
    await db.update(demandesClient).set({ statut: "prise_en_charge", prisEnChargeLe: new Date(), prisEnChargeParId: user.id }).where(eq(demandesClient.id, id));
  }
  await journaliser({ entite: "demande_client", entiteId: id, action: "reponse_bureau", utilisateurId: user.id, details: texte.slice(0, 200) || "pièce jointe" });
  after(() => notifierClient(id, "Nouveau message de ROBUS", texte || "Un document vous a été envoyé."));
  revalidatePath(page(id));
  redirect(avecMessage(page(id, "#fil"), "ok", "Message envoyé au client."));
}

export async function planifierDepuisDemande(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("demandeId") ?? "");
  const d = await lire(id);
  const technicienId = String(formData.get("technicienId") ?? "");
  const date = new Date(String(formData.get("dateProgrammee") ?? ""));
  if (!z.string().uuid().safeParse(technicienId).success) redirect(avecMessage(page(id), "erreur", "Choisissez le technicien."));
  if (Number.isNaN(date.getTime())) redirect(avecMessage(page(id), "erreur", "Choisissez la date et l'heure."));
  const [tech] = await db.select({ nom: users.nom }).from(users).where(and(eq(users.id, technicienId), eq(users.role, "technicien"), eq(users.actif, 1))).limit(1);
  if (!tech) redirect(avecMessage(page(id), "erreur", "Technicien introuvable."));

  let missionId = d.interventionId;
  let projetId: string | null = null;
  if (missionId) {
    const [m] = await db.select({ statut: interventions.statut, projetId: interventions.projetId }).from(interventions).where(eq(interventions.id, missionId)).limit(1);
    if (!m) missionId = null;
    else if (!["creee", "planifiee", "affectee"].includes(m.statut)) redirect(avecMessage(page(id), "erreur", "La mission liée a déjà commencé."));
    else projetId = m.projetId;
  }
  if (!missionId) {
    projetId = await dernierProjetAppareil(d.appareilId);
    if (!projetId) redirect(avecMessage(page(id), "erreur", "Cet ascenseur n'est rattaché à aucun projet : créez d'abord un projet pour l'intervention."));
    const [m] = await db
      .insert(interventions)
      .values({
        appareilId: d.appareilId,
        projetId,
        type: "corrective",
        statut: "creee",
        priorite: d.priorite === "critique" ? "critique" : d.type === "panne" ? "haute" : "normale",
        description: `Demande client ${d.numero} : ${d.description}`,
        dateProgrammee: date,
      })
      .returning({ id: interventions.id });
    missionId = m.id;
    await attribuerParDefaut(m.id);
    await db.update(demandesClient).set({ interventionId: missionId }).where(eq(demandesClient.id, id));
  }
  if (!projetId) redirect(avecMessage(page(id), "erreur", "Mission sans projet : impossible de l'envoyer."));
  const manques = await controlerHabilitations(technicienId, [missionId!]);
  if (manques.length) redirect(avecMessage(page(id), "erreur", messageManques(tech!.nom, manques)));
  await db.update(interventions).set({ technicienId, statut: "affectee", dateProgrammee: date, retardNotifieLe: null }).where(eq(interventions.id, missionId!));
  // L'envoi met aussi la demande en « Intervention planifiée » et prévient le client.
  await envoyerMissionsAuTechnicien({ projetId: projetId!, technicienId, interventionIds: [missionId!], envoyeParId: user.id });
  await journaliser({ entite: "demande_client", entiteId: id, action: "intervention_planifiee", utilisateurId: user.id, details: `${tech!.nom} — ${date.toISOString()}` });
  revalidatePath(page(id));
  redirect(avecMessage(page(id), "ok", `Intervention planifiée et envoyée à ${tech!.nom}.`));
}

export async function resoudreDemande(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("demandeId") ?? "");
  const d = await lire(id);
  const resolution = String(formData.get("resolution") ?? "").trim().slice(0, 2000);
  if (!resolution) redirect(avecMessage(page(id), "erreur", "Indiquez ce qui a été fait (résumé envoyé au client)."));
  if (["resolue", "cloturee"].includes(d.statut)) redirect(page(id));
  await db.update(demandesClient).set({ resolution }).where(eq(demandesClient.id, id));
  await changerStatutDemande(id, "resolue", user.id, `Demande résolue : ${resolution}`);
  revalidatePath(page(id));
  redirect(avecMessage(page(id), "ok", "Demande résolue — le client peut noter le traitement."));
}

export async function cloturerDemande(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("demandeId") ?? "");
  const d = await lire(id);
  if (d.statut === "cloturee") redirect(page(id));
  if (d.statut !== "resolue") redirect(avecMessage(page(id), "erreur", "Résolvez d'abord la demande (avec un résumé pour le client)."));
  await changerStatutDemande(id, "cloturee", user.id, "Demande clôturée par ROBUS. Merci pour votre confiance.");
  revalidatePath(page(id));
  redirect(avecMessage(page(id), "ok", "Demande clôturée."));
}
