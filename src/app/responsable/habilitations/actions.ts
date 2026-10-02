"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { documentsFormations, formationsParticipants, formationsSessions, habilitationsCatalogue, habilitationsTechnicien, users } from "@/db/schema";
import { LIEUX_FORMATION, avertirTechniciens, conflitsMissions, dateFormation } from "@/lib/formations";
import { requireUser } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { enregistrerFichiers, fichiersDuFormulaire } from "@/lib/fichiers";
import { CATEGORIES_HABILITATION, EXIGENCES_MISSION, calculerExpiration } from "@/lib/habilitations";
import { notifierUtilisateurs } from "@/lib/push";
import { avecMessage } from "@/lib/url";

// Phase 19 : habilitations & formations — gestion par le bureau
// (administrateur et responsable qualité).
const GESTION = ["administrateur", "responsable_qualite"] as const;
const uuid = z.string().uuid();

function dateDuChamp(v: FormDataEntryValue | null) {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const d = new Date(t.length === 10 ? `${t}T12:00:00` : t);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------- Catalogue ----------

const catalogueSchema = z.object({
  nom: z.string().trim().min(2, "Nom de l'habilitation requis.").max(160),
  categorie: z.string().refine((c) => c in CATEGORIES_HABILITATION, "Catégorie invalide."),
  pays: z.string().max(10).optional(),
  validiteMois: z.coerce.number().int().min(1).max(600).optional(),
  alerteJours: z.coerce.number().int().min(1).max(365).default(60),
  description: z.string().max(1000).optional(),
});

export async function enregistrerCatalogue(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("id") ?? "");
  const retour = "/responsable/habilitations?onglet=catalogue";
  const parsed = catalogueSchema.safeParse({
    nom: formData.get("nom"),
    categorie: formData.get("categorie"),
    pays: formData.get("pays") || undefined,
    validiteMois: formData.get("validiteMois") || undefined,
    alerteJours: formData.get("alerteJours") || 60,
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) redirect(avecMessage(retour, "erreur", parsed.error.issues[0]?.message ?? "Formulaire invalide."));
  const typesMission = formData.getAll("typesMission").map(String).filter((t) => t in EXIGENCES_MISSION);
  const valeurs = {
    ...parsed.data,
    pays: parsed.data.pays || null,
    validiteMois: parsed.data.validiteMois ?? null,
    description: parsed.data.description || null,
    certificatObligatoire: formData.get("certificatObligatoire") === "on" ? 1 : 0,
    obligatoire: typesMission.length ? 1 : 0,
    typesMission,
    marques: String(formData.get("marques") ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)
      .slice(0, 20),
    actif: formData.get("actif") === "off" ? 0 : 1,
  };
  if (uuid.safeParse(id).success) {
    await db.update(habilitationsCatalogue).set(valeurs).where(eq(habilitationsCatalogue.id, id));
    await journaliser({ entite: "habilitation_catalogue", entiteId: id, action: "modifiee", utilisateurId: user.id, details: valeurs.nom });
  } else {
    const [c] = await db.insert(habilitationsCatalogue).values(valeurs).returning({ id: habilitationsCatalogue.id });
    await journaliser({ entite: "habilitation_catalogue", entiteId: c.id, action: "creee", utilisateurId: user.id, details: valeurs.nom });
  }
  revalidatePath("/responsable/habilitations");
  redirect(avecMessage(retour, "ok", `Habilitation « ${valeurs.nom} » enregistrée.`));
}

// ---------- Habilitations d'un technicien ----------

/** L'ancienne habilitation du même type passe en « remplacée » (historique conservé). */
async function remplacerPrecedentes(technicienId: string, catalogueId: string, nouvelleId: string) {
  await db
    .update(habilitationsTechnicien)
    .set({ statut: "remplacee" })
    .where(
      and(
        eq(habilitationsTechnicien.technicienId, technicienId),
        eq(habilitationsTechnicien.catalogueId, catalogueId),
        inArray(habilitationsTechnicien.statut, ["valide"]),
        ne(habilitationsTechnicien.id, nouvelleId)
      )
    );
}

export async function ajouterHabilitation(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const technicienId = String(formData.get("technicienId") ?? "");
  const catalogueId = String(formData.get("catalogueId") ?? "");
  const retour = `/responsable/techniciens/${technicienId}?tab=habilitations`;
  if (!uuid.safeParse(technicienId).success) redirect("/responsable/techniciens");
  const [cat] = uuid.safeParse(catalogueId).success
    ? await db.select().from(habilitationsCatalogue).where(eq(habilitationsCatalogue.id, catalogueId)).limit(1)
    : [];
  if (!cat) redirect(avecMessage(retour, "erreur", "Choisissez une habilitation du catalogue."));
  const dateObtention = dateDuChamp(formData.get("dateObtention"));
  if (!dateObtention || dateObtention.getTime() > Date.now() + 86400000) redirect(avecMessage(retour, "erreur", "Date d'obtention invalide."));
  let fichiers: File[] = [];
  try {
    fichiers = fichiersDuFormulaire(formData, "certificat", 1);
  } catch (e) {
    redirect(avecMessage(retour, "erreur", (e as Error).message));
  }
  const [f] = fichiers.length ? await enregistrerFichiers(fichiers, "habilitations", `cert-${technicienId}`) : [];
  const expirationSaisie = dateDuChamp(formData.get("dateExpiration"));
  const [h] = await db
    .insert(habilitationsTechnicien)
    .values({
      technicienId,
      catalogueId: cat!.id,
      dateObtention: dateObtention!,
      dateExpiration: expirationSaisie ?? calculerExpiration(dateObtention!, cat!.validiteMois),
      organisme: String(formData.get("organisme") ?? "").trim().slice(0, 160) || null,
      numeroCertificat: String(formData.get("numeroCertificat") ?? "").trim().slice(0, 80) || null,
      certificatUrl: f?.url ?? null,
      statut: "valide",
      ajouteeParId: user.id,
      valideeParId: user.id,
      valideeLe: new Date(),
    })
    .returning({ id: habilitationsTechnicien.id });
  await remplacerPrecedentes(technicienId, cat!.id, h.id);
  await journaliser({ entite: "habilitation", entiteId: h.id, action: "ajoutee_bureau", utilisateurId: user.id, details: `${cat!.nom} — technicien ${technicienId}` });
  revalidatePath(`/responsable/techniciens/${technicienId}`);
  redirect(avecMessage(retour, "ok", `Habilitation « ${cat!.nom} » ajoutée.`));
}

export async function deciderCertificat(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("habilitationId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const motif = String(formData.get("motif") ?? "").trim().slice(0, 500);
  const retourDemande = String(formData.get("retour") ?? "");
  // Retour limité aux pages du bureau (pas de redirection externe).
  const retour = /^\/responsable\/[\w\-/?=&]*$/.test(retourDemande) ? retourDemande : "/responsable/habilitations?onglet=a_valider";
  if (!uuid.safeParse(id).success || !["valider", "refuser"].includes(decision)) redirect(retour);
  const [h] = await db.select().from(habilitationsTechnicien).where(eq(habilitationsTechnicien.id, id)).limit(1);
  if (!h || h.statut !== "en_attente") redirect(retour);
  if (decision === "refuser" && !motif) redirect(avecMessage(retour, "erreur", "Indiquez le motif du refus."));
  await db
    .update(habilitationsTechnicien)
    .set({ statut: decision === "valider" ? "valide" : "refusee", valideeParId: user.id, valideeLe: new Date(), commentaire: motif || null })
    .where(eq(habilitationsTechnicien.id, id));
  if (decision === "valider" && h.catalogueId) await remplacerPrecedentes(h.technicienId, h.catalogueId, h.id);
  await journaliser({ entite: "habilitation", entiteId: id, action: decision === "valider" ? "certificat_valide" : "certificat_refuse", utilisateurId: user.id, details: motif || null });
  after(() =>
    notifierUtilisateurs([h.technicienId], {
      titre: decision === "valider" ? "✅ Certificat validé" : "❌ Certificat refusé",
      corps: decision === "valider" ? "Votre habilitation est enregistrée." : `Motif : ${motif}`,
      url: "/technicien/profil#habilitations",
    })
  );
  revalidatePath("/responsable/habilitations");
  revalidatePath(`/responsable/techniciens/${h.technicienId}`);
  redirect(avecMessage(retour, "ok", decision === "valider" ? "Certificat validé — l'ancienne habilitation est archivée." : "Certificat refusé — le technicien est prévenu."));
}

export async function retirerHabilitation(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("habilitationId") ?? "");
  const technicienId = String(formData.get("technicienId") ?? "");
  const motif = String(formData.get("motif") ?? "").trim().slice(0, 500);
  const retour = `/responsable/techniciens/${technicienId}?tab=habilitations`;
  if (!uuid.safeParse(id).success) redirect(retour);
  if (!motif) redirect(avecMessage(retour, "erreur", "Indiquez le motif du retrait."));
  await db.update(habilitationsTechnicien).set({ statut: "retiree", commentaire: motif }).where(eq(habilitationsTechnicien.id, id));
  await journaliser({ entite: "habilitation", entiteId: id, action: "retiree", utilisateurId: user.id, details: motif });
  revalidatePath(retour.split("?")[0]);
  redirect(avecMessage(retour, "ok", "Habilitation retirée (conservée dans l'historique)."));
}

// ---------- Sessions de formation ----------

const sessionSchema = z.object({
  titre: z.string().trim().min(3, "Titre de la formation requis.").max(200),
  catalogueId: z.string().uuid().optional(),
  lieu: z.enum(["terrain", "bureau", "ecole"]),
  organisme: z.string().max(160).optional(),
  dureeHeures: z.coerce.number().min(0).max(1000).optional(),
  programme: z.string().max(2000).optional(),
});

export async function creerSession(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const retour = "/responsable/habilitations?onglet=sessions";
  const parsed = sessionSchema.safeParse({
    titre: formData.get("titre"),
    catalogueId: formData.get("catalogueId") || undefined,
    lieu: formData.get("lieu"),
    organisme: formData.get("organisme") || undefined,
    dureeHeures: formData.get("dureeHeures") || undefined,
    programme: formData.get("programme") || undefined,
  });
  if (!parsed.success) redirect(avecMessage(retour, "erreur", parsed.error.issues[0]?.message ?? "Formulaire invalide."));
  const dateDebut = dateDuChamp(formData.get("dateDebut"));
  if (!dateDebut) redirect(avecMessage(retour, "erreur", "Date de la formation requise."));
  const techIds = formData.getAll("technicienIds").map(String).filter((t) => uuid.safeParse(t).success);
  if (!techIds.length) redirect(avecMessage(retour, "erreur", "Inscrivez au moins un technicien."));
  try {
    fichiersDuFormulaire(formData, "documents", 10);
  } catch (e) {
    redirect(avecMessage(retour, "erreur", (e as Error).message));
  }
  const valides = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, techIds), eq(users.role, "technicien")));
  const [s] = await db
    .insert(formationsSessions)
    .values({
      ...parsed.data,
      catalogueId: parsed.data.catalogueId ?? null,
      organisme: parsed.data.organisme || null,
      programme: parsed.data.programme || null,
      dureeHeures: parsed.data.dureeHeures != null ? String(parsed.data.dureeHeures) : null,
      dateDebut: dateDebut!,
      creeParId: user.id,
    })
    .returning({ id: formationsSessions.id });
  await db.insert(formationsParticipants).values(valides.map((t) => ({ sessionId: s.id, technicienId: t.id })));
  // Phase 21 : documents de la formation (support, programme…) dès la création.
  const nbDocs = await enregistrerDocumentsSession(formData, s.id, parsed.data.titre);
  await journaliser({ entite: "formation_session", entiteId: s.id, action: "planifiee", utilisateurId: user.id, details: `${parsed.data.titre} — ${valides.length} participant(s)` });
  avertirTechniciens(
    valides.map((t) => t.id),
    s.id,
    "🎓 Formation planifiée",
    `${parsed.data.titre} — ${dateFormation(dateDebut!)} (${LIEUX_FORMATION[parsed.data.lieu] ?? parsed.data.lieu}). Confirmez votre présence dans l'application.`
  );
  const conflits = await conflitsMissions(valides.map((t) => t.id), dateDebut!);
  const page = `/responsable/habilitations/sessions/${s.id}`;
  if (conflits.length) {
    redirect(avecMessage(page, "erreur", `Formation planifiée et techniciens prévenus — attention : ${conflits.map((c) => `${c.nom} a ${c.n} mission(s) ce jour-là`).join(", ")}.`));
  }
  redirect(avecMessage(page, "ok", `Formation planifiée — ${valides.length} technicien(s) prévenu(s) (notification + email)${nbDocs ? `, ${nbDocs} document(s) joint(s)` : ""}.`));
}

/** Enregistre les fichiers « documents » d'un formulaire comme documents de la formation (bibliothèque, catégorie Formations internes). */
async function enregistrerDocumentsSession(formData: FormData, sessionId: string, titreSession: string) {
  let fichiers: File[] = [];
  try {
    fichiers = fichiersDuFormulaire(formData, "documents", 10);
  } catch (e) {
    redirect(avecMessage(`/responsable/habilitations/sessions/${sessionId}`, "erreur", (e as Error).message));
  }
  if (!fichiers.length) return 0;
  const enregistres = await enregistrerFichiers(fichiers, "formations", `form-${sessionId.slice(0, 8)}`);
  const titreSaisi = String(formData.get("titreDocument") ?? "").trim().slice(0, 200);
  await db.insert(documentsFormations).values(
    enregistres.map((f, i) => ({
      titre: (titreSaisi && enregistres.length === 1 ? titreSaisi : f.nom.replace(/\.[a-z0-9]+$/i, "")) || `${titreSession} — document ${i + 1}`,
      categorie: "formation" as const,
      typeContenu: "document",
      urlFichier: f.url,
      estFormation: formData.get("lectureObligatoire") === "off" ? 0 : 1,
      sessionId,
    }))
  );
  revalidatePath("/responsable/documents");
  return enregistres.length;
}

async function chargerSession(sessionId: string) {
  if (!uuid.safeParse(sessionId).success) redirect("/responsable/habilitations?onglet=sessions");
  const [s] = await db.select().from(formationsSessions).where(eq(formationsSessions.id, sessionId)).limit(1);
  if (!s) redirect("/responsable/habilitations?onglet=sessions");
  return s!;
}

async function participantsIds(sessionId: string) {
  return (await db.select({ id: formationsParticipants.technicienId }).from(formationsParticipants).where(eq(formationsParticipants.sessionId, sessionId))).map((p) => p.id);
}

/** Phase 21 : ajouter des documents à une formation existante. */
export async function ajouterDocumentsSession(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const s = await chargerSession(String(formData.get("sessionId") ?? ""));
  const page = `/responsable/habilitations/sessions/${s.id}`;
  const n = await enregistrerDocumentsSession(formData, s.id, s.titre);
  if (!n) redirect(avecMessage(page, "erreur", "Choisissez au moins un fichier."));
  await journaliser({ entite: "formation_session", entiteId: s.id, action: "documents_ajoutes", utilisateurId: user.id, details: `${n} document(s)` });
  if (s.statut === "planifiee" && formData.get("prevenir") === "on") {
    avertirTechniciens(await participantsIds(s.id), s.id, "📄 Nouveau document de formation", `${s.titre} — ${n} document(s) à consulter avant la formation.`);
  }
  revalidatePath(page);
  redirect(avecMessage(page, "ok", `${n} document(s) ajouté(s) — visibles par les participants et dans la Bibliothèque.`));
}

/** Phase 21 : détacher un document de la formation (il reste dans la bibliothèque). */
export async function detacherDocumentSession(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const s = await chargerSession(String(formData.get("sessionId") ?? ""));
  const documentId = String(formData.get("documentId") ?? "");
  if (uuid.safeParse(documentId).success) {
    await db.update(documentsFormations).set({ sessionId: null }).where(and(eq(documentsFormations.id, documentId), eq(documentsFormations.sessionId, s.id)));
    await journaliser({ entite: "formation_session", entiteId: s.id, action: "document_detache", utilisateurId: user.id, details: documentId });
  }
  const page = `/responsable/habilitations/sessions/${s.id}`;
  revalidatePath(page);
  redirect(avecMessage(page, "ok", "Document retiré de la formation (il reste dans la Bibliothèque)."));
}

/** Phase 21 : changer la date / le lieu — les participants doivent reconfirmer. */
export async function reporterSession(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const s = await chargerSession(String(formData.get("sessionId") ?? ""));
  const page = `/responsable/habilitations/sessions/${s.id}`;
  if (s.statut !== "planifiee") redirect(avecMessage(page, "erreur", "Seule une formation planifiée peut être reportée."));
  const date = dateDuChamp(formData.get("dateDebut"));
  if (!date) redirect(avecMessage(page, "erreur", "Nouvelle date requise."));
  const lieu = String(formData.get("lieu") ?? s.lieu);
  await db
    .update(formationsSessions)
    .set({ dateDebut: date!, lieu: ["terrain", "bureau", "ecole"].includes(lieu) ? lieu : s.lieu })
    .where(eq(formationsSessions.id, s.id));
  await db
    .update(formationsParticipants)
    .set({ reponse: null, reponseLe: null, reponseMotif: null, emargeLe: null, rappelLe: null })
    .where(eq(formationsParticipants.sessionId, s.id));
  await journaliser({ entite: "formation_session", entiteId: s.id, action: "reportee", utilisateurId: user.id, details: `${dateFormation(s.dateDebut)} → ${dateFormation(date!)}` });
  avertirTechniciens(await participantsIds(s.id), s.id, "📅 Formation déplacée", `${s.titre} — nouvelle date : ${dateFormation(date!)}. Merci de reconfirmer votre présence.`);
  revalidatePath(page);
  redirect(avecMessage(page, "ok", "Formation déplacée — les participants sont prévenus et doivent reconfirmer."));
}

/** Phase 21 : annuler une formation (motif) — les participants sont prévenus. */
export async function annulerSession(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const s = await chargerSession(String(formData.get("sessionId") ?? ""));
  const page = `/responsable/habilitations/sessions/${s.id}`;
  const motif = String(formData.get("motif") ?? "").trim().slice(0, 500);
  if (s.statut !== "planifiee") redirect(avecMessage(page, "erreur", "Cette formation n'est plus planifiée."));
  if (!motif) redirect(avecMessage(page, "erreur", "Indiquez le motif de l'annulation."));
  await db.update(formationsSessions).set({ statut: "annulee", motifAnnulation: motif }).where(eq(formationsSessions.id, s.id));
  await journaliser({ entite: "formation_session", entiteId: s.id, action: "annulee", utilisateurId: user.id, details: motif });
  avertirTechniciens(await participantsIds(s.id), s.id, "❌ Formation annulée", `${s.titre} du ${dateFormation(s.dateDebut)} est annulée : ${motif}`);
  revalidatePath(page);
  revalidatePath("/responsable/habilitations");
  redirect(avecMessage(page, "ok", "Formation annulée — les participants sont prévenus."));
}

/** Phase 21 : inscrire un ou plusieurs techniciens (depuis la formation ou la fiche technicien). */
export async function inscrireTechniciens(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const s = await chargerSession(String(formData.get("sessionId") ?? ""));
  const retourDemande = String(formData.get("retour") ?? "");
  const retour = /^\/responsable\/[\w\-/?=&]*$/.test(retourDemande) ? retourDemande : `/responsable/habilitations/sessions/${s.id}`;
  if (s.statut !== "planifiee") redirect(avecMessage(retour, "erreur", "Cette formation n'est plus planifiée."));
  const ids = formData.getAll("technicienIds").map(String).filter((t) => uuid.safeParse(t).success);
  if (!ids.length) redirect(avecMessage(retour, "erreur", "Choisissez au moins un technicien."));
  const valides = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), eq(users.role, "technicien")));
  const deja = new Set(await participantsIds(s.id));
  const nouveaux = valides.map((v) => v.id).filter((v) => !deja.has(v));
  if (nouveaux.length) {
    await db.insert(formationsParticipants).values(nouveaux.map((technicienId) => ({ sessionId: s.id, technicienId })));
    await journaliser({ entite: "formation_session", entiteId: s.id, action: "participants_ajoutes", utilisateurId: user.id, details: `${nouveaux.length}` });
    avertirTechniciens(nouveaux, s.id, "🎓 Formation planifiée", `${s.titre} — ${dateFormation(s.dateDebut)} (${LIEUX_FORMATION[s.lieu] ?? s.lieu}). Confirmez votre présence dans l'application.`);
  }
  revalidatePath(`/responsable/habilitations/sessions/${s.id}`);
  const conflits = await conflitsMissions(nouveaux, s.dateDebut);
  if (conflits.length) redirect(avecMessage(retour, "erreur", `Inscrit et prévenu — attention : ${conflits.map((c) => `${c.nom} a ${c.n} mission(s) ce jour-là`).join(", ")}.`));
  redirect(avecMessage(retour, "ok", nouveaux.length ? `${nouveaux.length} technicien(s) inscrit(s) et prévenu(s).` : "Déjà inscrit."));
}

/** Phase 21 : retirer un participant avant la formation (il est prévenu). */
export async function retirerParticipant(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const s = await chargerSession(String(formData.get("sessionId") ?? ""));
  const page = `/responsable/habilitations/sessions/${s.id}`;
  const participantId = String(formData.get("participantId") ?? "");
  if (s.statut !== "planifiee" || !uuid.safeParse(participantId).success) redirect(page);
  const [p] = await db.delete(formationsParticipants).where(and(eq(formationsParticipants.id, participantId), eq(formationsParticipants.sessionId, s.id))).returning({ technicienId: formationsParticipants.technicienId });
  if (p) {
    await journaliser({ entite: "formation_session", entiteId: s.id, action: "participant_retire", utilisateurId: user.id, details: p.technicienId });
    avertirTechniciens([p.technicienId], s.id, "🎓 Formation retirée de votre planning", `${s.titre} du ${dateFormation(s.dateDebut)} ne vous concerne plus.`);
  }
  revalidatePath(page);
  redirect(avecMessage(page, "ok", "Participant retiré."));
}

/** Présence + résultat de chaque participant ; « réussi » crée l'habilitation liée. */
export async function cloturerSession(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!uuid.safeParse(sessionId).success) redirect("/responsable/habilitations?onglet=sessions");
  const retour = `/responsable/habilitations/sessions/${sessionId}`;
  const [s] = await db.select().from(formationsSessions).where(eq(formationsSessions.id, sessionId)).limit(1);
  if (!s) redirect("/responsable/habilitations?onglet=sessions");
  // Phase 19b : pas de résultats avant le jour de la formation (sinon l'habilitation serait délivrée d'avance).
  if (s!.dateDebut.getTime() > Date.now() + 12 * 3600 * 1000) {
    redirect(avecMessage(retour, "erreur", "Les résultats ne peuvent être saisis qu'à partir du jour de la formation."));
  }
  const [cat] = s!.catalogueId ? await db.select().from(habilitationsCatalogue).where(eq(habilitationsCatalogue.id, s!.catalogueId)).limit(1) : [];
  const participants = await db.select().from(formationsParticipants).where(eq(formationsParticipants.sessionId, sessionId));
  let habCreees = 0;
  for (const p of participants) {
    const present = formData.get(`present_${p.id}`) === "on" ? 1 : 0;
    const resultat = present ? String(formData.get(`resultat_${p.id}`) ?? "") : "a_refaire";
    const res = ["reussi", "a_refaire"].includes(resultat) ? resultat : null;
    let habilitationId = p.habilitationId;
    if (res === "reussi" && cat && !habilitationId) {
      const [h] = await db
        .insert(habilitationsTechnicien)
        .values({
          technicienId: p.technicienId,
          catalogueId: cat.id,
          dateObtention: s!.dateDebut,
          dateExpiration: calculerExpiration(s!.dateDebut, cat.validiteMois),
          organisme: s!.organisme,
          statut: "valide",
          sessionId,
          ajouteeParId: user.id,
          valideeParId: user.id,
          valideeLe: new Date(),
          commentaire: `Formation « ${s!.titre} »`,
        })
        .returning({ id: habilitationsTechnicien.id });
      await remplacerPrecedentes(p.technicienId, cat.id, h.id);
      habilitationId = h.id;
      habCreees++;
    }
    await db.update(formationsParticipants).set({ present, resultat: res, habilitationId }).where(eq(formationsParticipants.id, p.id));
  }
  await db.update(formationsSessions).set({ statut: "terminee", clotureeParId: user.id, clotureeLe: new Date() }).where(eq(formationsSessions.id, sessionId));
  await journaliser({ entite: "formation_session", entiteId: sessionId, action: "cloturee", utilisateurId: user.id, details: `${habCreees} habilitation(s) créée(s)` });
  // Phase 21 : chaque participant reçoit son résultat (et son attestation s'il était présent).
  after(async () => {
    const res = await db.select({ technicienId: formationsParticipants.technicienId, present: formationsParticipants.present, resultat: formationsParticipants.resultat }).from(formationsParticipants).where(eq(formationsParticipants.sessionId, sessionId));
    for (const r of res) {
      await notifierUtilisateurs([r.technicienId], {
        titre: "🎓 Formation validée par le bureau",
        corps: `${s!.titre} — ${!r.present ? "absent" : r.resultat === "reussi" ? "réussie, attestation disponible" : r.resultat === "a_refaire" ? "à refaire" : "présence enregistrée"}`,
        url: `/technicien/formations/${sessionId}`,
        tag: `formation-${sessionId}`,
      });
    }
  });
  revalidatePath(retour);
  redirect(avecMessage(retour, "ok", `Résultats enregistrés${habCreees ? ` — ${habCreees} habilitation(s) créée(s)` : ""}.`));
}

/** Évaluation de l'efficacité (ISO 9001 §7.2 c) — en général quelques semaines après. */
export async function evaluerEfficacite(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("participantId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const efficacite = String(formData.get("efficacite") ?? "");
  const retour = `/responsable/habilitations/sessions/${sessionId}`;
  if (!uuid.safeParse(id).success || !["efficace", "partielle", "non_efficace"].includes(efficacite)) redirect(retour);
  await db
    .update(formationsParticipants)
    .set({ efficacite, efficaciteCommentaire: String(formData.get("commentaire") ?? "").trim().slice(0, 1000) || null, efficaciteLe: new Date() })
    .where(eq(formationsParticipants.id, id));
  await journaliser({ entite: "formation_session", entiteId: sessionId, action: "efficacite_evaluee", utilisateurId: user.id, details: efficacite });
  revalidatePath(retour);
  redirect(avecMessage(retour, "ok", "Évaluation de l'efficacité enregistrée."));
}
