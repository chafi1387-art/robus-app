"use server";

import { db } from "@/db";
import { documentsFormations, formationsConsultations, formationsParticipants, formationsSessions, habilitationsCatalogue, habilitationsTechnicien } from "@/db/schema";
import { fenetreEmargement } from "@/lib/formations";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { enregistrerFichiers, fichiersDuFormulaire } from "@/lib/fichiers";
import { calculerExpiration } from "@/lib/habilitations";
import { notifierBureau } from "@/lib/push";
import { and, eq } from "drizzle-orm";

export async function consulterDocument(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);

  const documentId = String(formData.get("documentId") ?? "");
  if (!documentId) throw new Error("Document invalide.");

  const [doc] = await db
    .select({
      id: documentsFormations.id,
      estFormation: documentsFormations.estFormation,
      dureeValiditeMois: documentsFormations.dureeValiditeMois,
    })
    .from(documentsFormations)
    .where(eq(documentsFormations.id, documentId))
    .limit(1);
  if (!doc) throw new Error("Document introuvable.");

  await db.insert(formationsConsultations).values({
    technicienId: user.id,
    documentId,
  });

  // Phase 19 : valider un document = « lecture attestée » (traçabilité de la
  // consultation). Les habilitations sont désormais ajoutées par le bureau,
  // avec certificat, ou déposées par le technicien puis validées.
  await journaliser({ entite: "document", entiteId: documentId, action: "lecture_attestee", utilisateurId: user.id });

  revalidatePath("/technicien/formations", "layout");
  revalidatePath("/technicien/profil");
}


// Phase 19 : le technicien dépose un certificat (nouvelle habilitation ou
// renouvellement) — il reste « en attente » jusqu'à validation par le bureau.
export async function deposerCertificat(formData: FormData) {
  const user = await requireUser(["technicien"]);
  const catalogueId = String(formData.get("catalogueId") ?? "");
  const dateTxt = String(formData.get("dateObtention") ?? "");
  const retour = (m: string) => redirect(`/technicien/profil?${m}#habilitations`);
  const [cat] = /^[0-9a-f-]{36}$/i.test(catalogueId)
    ? await db.select().from(habilitationsCatalogue).where(and(eq(habilitationsCatalogue.id, catalogueId), eq(habilitationsCatalogue.actif, 1))).limit(1)
    : [];
  if (!cat) retour("erreurHab=" + encodeURIComponent("Choisissez l'habilitation."));
  const dateObtention = new Date(`${dateTxt}T12:00:00`);
  if (Number.isNaN(dateObtention.getTime()) || dateObtention.getTime() > Date.now()) retour("erreurHab=" + encodeURIComponent("Date d'obtention invalide."));
  let fichiers: File[] = [];
  try {
    fichiers = fichiersDuFormulaire(formData, "certificat", 1);
  } catch (e) {
    retour("erreurHab=" + encodeURIComponent((e as Error).message));
  }
  if (!fichiers.length) retour("erreurHab=" + encodeURIComponent("Joignez le certificat (PDF ou photo)."));
  const [f] = await enregistrerFichiers(fichiers, "habilitations", `cert-${user.id}`);
  const [h] = await db
    .insert(habilitationsTechnicien)
    .values({
      technicienId: user.id,
      catalogueId: cat!.id,
      dateObtention,
      dateExpiration: calculerExpiration(dateObtention, cat!.validiteMois),
      organisme: String(formData.get("organisme") ?? "").trim().slice(0, 160) || null,
      numeroCertificat: String(formData.get("numeroCertificat") ?? "").trim().slice(0, 80) || null,
      certificatUrl: f.url,
      statut: "en_attente",
      ajouteeParId: user.id,
    })
    .returning({ id: habilitationsTechnicien.id });
  await journaliser({ entite: "habilitation", entiteId: h.id, action: "certificat_depose", utilisateurId: user.id, details: cat!.nom });
  after(() =>
    notifierBureau({ titre: "📄 Certificat à valider", corps: `${user.name ?? "Un technicien"} — ${cat!.nom}`, url: "/responsable/habilitations?onglet=a_valider", tag: `hab-${h.id}` })
  );
  revalidatePath("/technicien/profil");
  retour("depose=1");
}

// ==========================================================================
// Phase 21 — Formations internes : le technicien confirme sa présence (ou
// dit qu'il est indisponible, avec le motif), puis signe sa présence le jour J.
// La validation finale (présence, résultat) reste au bureau.
// ==========================================================================
async function participation(sessionId: string, technicienId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const [r] = await db
    .select({ p: formationsParticipants, s: formationsSessions })
    .from(formationsParticipants)
    .innerJoin(formationsSessions, eq(formationsParticipants.sessionId, formationsSessions.id))
    .where(and(eq(formationsParticipants.sessionId, sessionId), eq(formationsParticipants.technicienId, technicienId)))
    .limit(1);
  return r ?? null;
}

export async function repondreFormation(formData: FormData) {
  const user = await requireUser(["technicien"]);
  const sessionId = String(formData.get("sessionId") ?? "");
  const reponse = String(formData.get("reponse") ?? "");
  const motif = String(formData.get("motif") ?? "").trim().slice(0, 500);
  const page = `/technicien/formations/${sessionId}`;
  const r = await participation(sessionId, user.id);
  if (!r) redirect("/technicien/formations");
  if (r!.s.statut !== "planifiee" || r!.s.dateDebut.getTime() < Date.now()) redirect(`${page}?erreur=${encodeURIComponent("La formation a commencé : contactez le bureau.")}`);
  if (!["confirme", "indisponible"].includes(reponse)) redirect(page);
  if (reponse === "indisponible" && !motif) redirect(`${page}?erreur=${encodeURIComponent("Indiquez pourquoi vous n'êtes pas disponible.")}`);
  await db
    .update(formationsParticipants)
    .set({ reponse, reponseLe: new Date(), reponseMotif: reponse === "indisponible" ? motif : null })
    .where(eq(formationsParticipants.id, r!.p.id));
  await journaliser({ entite: "formation_session", entiteId: sessionId, action: reponse === "confirme" ? "presence_confirmee" : "indisponible", utilisateurId: user.id, details: motif || null });
  if (reponse === "indisponible" || r!.p.reponse === "indisponible") {
    after(() =>
      notifierBureau({
        titre: reponse === "indisponible" ? "🎓 Technicien indisponible pour une formation" : "🎓 Présence finalement confirmée",
        corps: `${user.name ?? "Un technicien"} — ${r!.s.titre}${motif ? ` : ${motif}` : ""}`,
        url: `/responsable/habilitations/sessions/${sessionId}`,
        tag: `formation-${sessionId}-${user.id}`,
      })
    );
  }
  revalidatePath("/technicien");
  revalidatePath(page);
  redirect(`${page}?ok=${reponse}`);
}

export async function emargerFormation(formData: FormData) {
  const user = await requireUser(["technicien"]);
  const sessionId = String(formData.get("sessionId") ?? "");
  const page = `/technicien/formations/${sessionId}`;
  const r = await participation(sessionId, user.id);
  if (!r) redirect("/technicien/formations");
  if (r!.s.statut !== "planifiee" || !fenetreEmargement(r!.s.dateDebut)) {
    redirect(`${page}?erreur=${encodeURIComponent("La signature de présence est ouverte le jour de la formation.")}`);
  }
  if (!r!.p.emargeLe) {
    await db
      .update(formationsParticipants)
      .set({ emargeLe: new Date(), reponse: "confirme", reponseLe: r!.p.reponseLe ?? new Date() })
      .where(eq(formationsParticipants.id, r!.p.id));
    await journaliser({ entite: "formation_session", entiteId: sessionId, action: "emargement", utilisateurId: user.id });
  }
  revalidatePath("/technicien");
  revalidatePath(page);
  redirect(`${page}?ok=emarge`);
}
