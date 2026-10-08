"use server";

import { z } from "zod";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { photosRecues } from "@/lib/photos";
import { fichiersRecus } from "@/lib/fichiers";
import { avecAnnulation, signerAnnulation } from "@/lib/annulation";
import { avecMessage } from "@/lib/url";
import { piecesNettes } from "@/lib/pieces-mission";
import { db } from "@/db";
import { appareils, interventions, missionChecklistTaches, missionChecklists, missionNotes, mouvementsStock, nonConformites, pieces, rapportPhotos, rapports, rapportVersions } from "@/db/schema";
import { attribuerChecklists } from "@/lib/checklists";
import { requireUser } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { notifierObservateurs } from "@/lib/observateur";
import { REINIT_ENVOI } from "@/lib/missions";
import { envoyerMissionsAuTechnicien } from "@/lib/envoi-mission";
import { controlerHabilitations, messageManques, nomUtilisateur } from "@/lib/habilitations";
import { etatDepuisRapport } from "@/lib/etat-appareil";

// Phase 18 : le bureau valide le rapport d'une mission terminée. Le rapport
// devient visible par les observateurs (droit « rapports ») et n'est plus
// modifiable par le technicien.
export async function validerRapport(formData: FormData) {
  const user = await requireUser(["administrateur", "responsable_qualite"]);
  const id = String(formData.get("interventionId") ?? "");
  if (!z.string().uuid().safeParse(id).success) throw new Error("Mission introuvable.");
  const maj = await db
    .update(interventions)
    .set({ statut: "validee", valideeLe: new Date(), valideeParId: user.id })
    .where(and(eq(interventions.id, id), eq(interventions.statut, "terminee")))
    .returning({ appareilId: interventions.appareilId });
  if (maj.length) {
    await journaliser({ entite: "intervention", entiteId: id, action: "rapport_valide", utilisateurId: user.id });
    const [a] = await db.select({ numero: appareils.numeroInterne }).from(appareils).where(eq(appareils.id, maj[0].appareilId)).limit(1);
    after(() =>
      notifierObservateurs(
        maj[0].appareilId,
        "rapports",
        {
          titre: "📄 Rapport d'intervention disponible",
          corps: `Le rapport de l'intervention sur l'ascenseur ${a?.numero ?? ""} est disponible.`,
          url: `/observateur/interventions/${id}`,
        },
        true
      )
    );
  }
  revalidatePath(`/responsable/missions/${id}`);
}


// ==========================================================================
// Phase 19 — Le bureau corrige le rapport (texte, photos, pièces) avec
// historique des versions, et ajoute ses notes / documents / rapports.
// ==========================================================================

const GESTION = ["administrateur", "responsable_qualite"] as const;
const STATUT_APPAREIL = ["en_service", "sous_surveillance", "en_panne", "hors_service", "en_travaux"] as const;
const TYPES_NOTE = ["commentaire", "piece_manquante", "document", "rapport_bureau"] as const;

function page(id: string, ancre = "") {
  return `/responsable/missions/${id}${ancre}`;
}

async function contexteMission(id: string) {
  if (!z.string().uuid().safeParse(id).success) redirect("/responsable/interventions");
  const [m] = await db.select({ statut: interventions.statut }).from(interventions).where(eq(interventions.id, id)).limit(1);
  if (!m) redirect("/responsable/interventions");
  return m!;
}

/** Après validation, toute correction exige un motif (traçabilité ISO). */
function motifExige(statut: string, motif: string, retour: string) {
  if (["validee", "cloturee"].includes(statut) && !motif) {
    redirect(avecMessage(retour, "erreur", "Ce rapport est déjà validé : indiquez le motif de la modification."));
  }
}

async function instantane(interventionId: string) {
  const [r] = await db.select().from(rapports).where(eq(rapports.interventionId, interventionId)).limit(1);
  const photos = r ? await db.select({ url: rapportPhotos.url }).from(rapportPhotos).where(eq(rapportPhotos.rapportId, r.id)).orderBy(asc(rapportPhotos.createdAt)) : [];
  const pcs = await piecesNettes(interventionId);
  return {
    travauxRealises: r?.travauxRealises ?? null,
    observations: r?.observations ?? null,
    tempsPasseMinutes: r?.tempsPasseMinutes ?? null,
    heureReelle: r?.heureReelle?.toISOString() ?? null,
    statutFinalAppareil: r?.statutFinalAppareil ?? null,
    photos: photos.map((p) => p.url),
    pieces: pcs.filter((p) => p.quantite !== 0).map((p) => `${p.quantite} × ${p.nom}`),
  };
}

async function tracer(interventionId: string, auteurId: string, quoi: string, motif: string, avant: unknown) {
  const apres = await instantane(interventionId);
  await db.insert(rapportVersions).values({ interventionId, auteurId, quoi, motif: motif || null, avant, apres });
  await db.update(rapports).set({ corrigeBureauLe: new Date(), corrigeBureauParId: auteurId }).where(eq(rapports.interventionId, interventionId));
  await journaliser({ entite: "intervention", entiteId: interventionId, action: `bureau_${quoi}`, utilisateurId: auteurId, details: motif || null });
  revalidatePath(page(interventionId));
}

const rapportSchema = z.object({
  travauxRealises: z.string().trim().min(1, "Les travaux réalisés ne peuvent pas être vides."),
  observations: z.string().optional(),
  tempsPasseMinutes: z.coerce.number().int().min(0).max(100000).optional(),
  heureReelle: z.string().optional(),
  statutFinalAppareil: z.enum(STATUT_APPAREIL).optional(),
});

export async function modifierRapportBureau(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("interventionId") ?? "");
  const m = await contexteMission(id);
  const retour = page(id, "#rapport");
  const motif = String(formData.get("motif") ?? "").trim().slice(0, 500);
  motifExige(m.statut, motif, retour);
  const parsed = rapportSchema.safeParse({
    travauxRealises: formData.get("travauxRealises"),
    observations: formData.get("observations") || undefined,
    tempsPasseMinutes: formData.get("tempsPasseMinutes") || undefined,
    heureReelle: formData.get("heureReelle") || undefined,
    statutFinalAppareil: formData.get("statutFinalAppareil") || undefined,
  });
  if (!parsed.success) redirect(avecMessage(retour, "erreur", parsed.error.issues[0]?.message ?? "Formulaire invalide."));
  const avant = await instantane(id);
  await db
    .update(rapports)
    .set({
      travauxRealises: parsed.data!.travauxRealises,
      observations: parsed.data!.observations?.trim() || null,
      tempsPasseMinutes: parsed.data!.tempsPasseMinutes ?? null,
      ...(parsed.data!.heureReelle ? { heureReelle: new Date(parsed.data!.heureReelle) } : {}),
      ...(parsed.data!.statutFinalAppareil ? { statutFinalAppareil: parsed.data!.statutFinalAppareil } : {}),
    })
    .where(eq(rapports.interventionId, id));
  await tracer(id, user.id, "rapport_modifie", motif, avant);
  if (parsed.data!.statutFinalAppareil) await etatDepuisRapport(id, user.id);
  redirect(avecMessage(retour, "ok", "Rapport modifié — l'ancienne version est conservée."));
}

export async function ajouterPhotosBureau(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("interventionId") ?? "");
  const m = await contexteMission(id);
  const retour = page(id, "#photos");
  const motif = String(formData.get("motif") ?? "").trim().slice(0, 500);
  motifExige(m.statut, motif, retour);
  const [r] = await db.select({ id: rapports.id }).from(rapports).where(eq(rapports.interventionId, id)).limit(1);
  if (!r) redirect(avecMessage(retour, "erreur", "Pas encore de rapport pour cette mission."));
  let urls: string[] = [];
  try {
    urls = await photosRecues(formData, r!.id, user.id);
  } catch (e) {
    redirect(avecMessage(retour, "erreur", (e as Error).message));
  }
  if (!urls.length) redirect(avecMessage(retour, "erreur", "Choisissez au moins une photo."));
  const avant = await instantane(id);
  await db.insert(rapportPhotos).values(urls.map((url) => ({ rapportId: r!.id, url })));
  await tracer(id, user.id, "photos_ajoutees", motif, avant);
  redirect(avecMessage(retour, "ok", `${urls.length} photo(s) ajoutée(s) ✓`));
}

export async function retirerOuRemplacerPhotoBureau(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("interventionId") ?? "");
  const photoId = String(formData.get("photoId") ?? "");
  const m = await contexteMission(id);
  const retour = page(id, "#photos");
  const motif = String(formData.get("motif") ?? "").trim().slice(0, 500);
  motifExige(m.statut, motif, retour);
  const [ph] = z.string().uuid().safeParse(photoId).success
    ? await db
        .select({ id: rapportPhotos.id, rapportId: rapportPhotos.rapportId, url: rapportPhotos.url })
        .from(rapportPhotos)
        .innerJoin(rapports, eq(rapportPhotos.rapportId, rapports.id))
        .where(and(eq(rapportPhotos.id, photoId), eq(rapports.interventionId, id)))
        .limit(1)
    : [];
  if (!ph) redirect(avecMessage(retour, "erreur", "Photo déjà retirée."));
  let remplacement: string[] = [];
  try {
    remplacement = await photosRecues(formData, ph!.rapportId, user.id, "remplacement", 1);
  } catch (e) {
    redirect(avecMessage(retour, "erreur", (e as Error).message));
  }
  const avant = await instantane(id);
  if (remplacement.length) {
    const [url] = remplacement;
    await db.update(rapportPhotos).set({ url }).where(eq(rapportPhotos.id, ph!.id));
    await tracer(id, user.id, "photo_remplacee", motif, avant);
    redirect(avecMessage(retour, "ok", "Photo remplacée (l'originale reste archivée sur le serveur)."));
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(rapportPhotos).where(eq(rapportPhotos.rapportId, ph!.rapportId));
  if (n <= 1) redirect(avecMessage(retour, "erreur", "Le rapport doit garder au moins une photo — utilisez « Remplacer »."));
  await db.delete(rapportPhotos).where(eq(rapportPhotos.id, ph!.id));
  await tracer(id, user.id, "photo_retiree", motif, avant);
  const jeton = signerAnnulation(user.id, { k: "photo_bureau", rapportId: ph!.rapportId, url: ph!.url, interventionId: id });
  redirect(avecAnnulation(avecMessage(retour, "ok", "Photo retirée ✓ (le fichier reste archivé)"), jeton));
}

/** Corrige la quantité nette d'une pièce sur la mission (mouvement de correction + stock). */
export async function corrigerPieceBureau(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("interventionId") ?? "");
  const m = await contexteMission(id);
  const retour = page(id, "#pieces");
  const motif = String(formData.get("motif") ?? "").trim().slice(0, 500);
  motifExige(m.statut, motif, retour);
  const pieceId = String(formData.get("pieceId") ?? "");
  const cible = Number(formData.get("quantite"));
  if (!z.string().uuid().safeParse(pieceId).success || !Number.isInteger(cible) || cible < 0 || cible > 10000) {
    redirect(avecMessage(retour, "erreur", "Pièce ou quantité invalide."));
  }
  const [piece] = await db.select().from(pieces).where(eq(pieces.id, pieceId)).limit(1);
  if (!piece) redirect(avecMessage(retour, "erreur", "Pièce introuvable."));
  const actuelle = (await piecesNettes(id)).find((p) => p.pieceId === pieceId)?.quantite ?? 0;
  const diff = cible - actuelle;
  if (diff === 0) redirect(retour);
  if (diff > 0 && diff > piece!.quantiteStock) {
    redirect(avecMessage(retour, "erreur", `Stock insuffisant : il reste ${piece!.quantiteStock} ${piece!.unite ?? ""} de « ${piece!.nom} ».`));
  }
  const avant = await instantane(id);
  await db.update(pieces).set({ quantiteStock: piece!.quantiteStock - diff }).where(eq(pieces.id, pieceId));
  await db.insert(mouvementsStock).values({
    pieceId,
    type: diff > 0 ? "sortie" : "entree",
    quantite: Math.abs(diff),
    interventionId: id,
    effectueParId: user.id,
    commentaire: `Correction bureau${motif ? ` — ${motif}` : ""}`,
  });
  await tracer(id, user.id, "pieces_corrigees", motif, avant);
  redirect(avecMessage(retour, "ok", `${piece!.nom} : ${actuelle} → ${cible} (stock mis à jour).`));
}

// ---------- Notes internes, documents, rapports du bureau ----------

export async function ajouterNoteMission(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("interventionId") ?? "");
  await contexteMission(id);
  const retour = page(id, "#notes");
  const type = String(formData.get("type") ?? "");
  if (!(TYPES_NOTE as readonly string[]).includes(type)) redirect(avecMessage(retour, "erreur", "Type de note invalide."));
  const titre = String(formData.get("titre") ?? "").trim().slice(0, 200);
  const texte = String(formData.get("texte") ?? "").trim().slice(0, 10000);
  let joints: { url: string; nom: string }[] = [];
  try {
    joints = await fichiersRecus(formData, "missions", `mission-${id}`, user.id);
  } catch (e) {
    redirect(avecMessage(retour, "erreur", (e as Error).message));
  }
  if (type === "document" && !joints.length) redirect(avecMessage(retour, "erreur", "Joignez au moins un fichier."));
  if (type === "rapport_bureau" && (!titre || !texte)) redirect(avecMessage(retour, "erreur", "Un rapport du bureau a besoin d'un titre et d'un texte."));
  if ((type === "commentaire" || type === "piece_manquante") && !texte) redirect(avecMessage(retour, "erreur", "Écrivez le texte de la note."));
  await db
    .insert(missionNotes)
    .values({
      interventionId: id,
      auteurId: user.id,
      type,
      titre: titre || null,
      texte: texte || null,
      fichiers: joints,
      visibleClient: type === "rapport_bureau" && formData.get("visibleClient") === "on" ? 1 : 0,
    });
  await journaliser({ entite: "intervention", entiteId: id, action: `note_${type}`, utilisateurId: user.id, details: titre || texte.slice(0, 120) || null });
  revalidatePath(page(id));
  redirect(avecMessage(retour, "ok", type === "rapport_bureau" ? "Rapport du bureau ajouté." : "Ajouté."));
}

export async function actionNoteMission(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("interventionId") ?? "");
  const noteId = String(formData.get("noteId") ?? "");
  const action = String(formData.get("action") ?? "");
  const retour = page(id, "#notes");
  if (!z.string().uuid().safeParse(noteId).success) redirect(retour);
  const [n] = await db.select().from(missionNotes).where(and(eq(missionNotes.id, noteId), eq(missionNotes.interventionId, id))).limit(1);
  if (!n) redirect(retour);
  if (action === "regle" && n!.type === "piece_manquante") {
    await db.update(missionNotes).set({ regleLe: n!.regleLe ? null : new Date(), regleParId: n!.regleLe ? null : user.id }).where(eq(missionNotes.id, noteId));
  } else if (action === "visible" && n!.type === "rapport_bureau") {
    await db.update(missionNotes).set({ visibleClient: n!.visibleClient ? 0 : 1 }).where(eq(missionNotes.id, noteId));
  } else if (action === "archiver") {
    await db.update(missionNotes).set({ archiveLe: n!.archiveLe ? null : new Date(), archiveParId: n!.archiveLe ? null : user.id }).where(eq(missionNotes.id, noteId));
  } else {
    redirect(retour);
  }
  await journaliser({ entite: "intervention", entiteId: id, action: `note_${action}`, utilisateurId: user.id, details: n!.titre ?? n!.texte?.slice(0, 120) ?? null });
  revalidatePath(page(id));
  redirect(retour);
}

// ==========================================================================
// Phase 21 — Mission refusée par le technicien : c'est l'admin qui décide.
//  - reaffecter : à un autre technicien (contrôle des habilitations) ;
//  - renvoyer   : au même technicien (après un appel), avec un message ;
//  - liberer    : la mission repasse « à affecter ».
// ==========================================================================
export async function deciderMissionRefusee(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("interventionId") ?? "");
  if (!z.string().uuid().safeParse(id).success) throw new Error("Mission introuvable.");
  const decision = String(formData.get("decision") ?? "");
  const retour = page(id);
  const [m] = await db
    .select({ statut: interventions.statut, technicienId: interventions.technicienId, projetId: interventions.projetId, dateProgrammee: interventions.dateProgrammee, refuseeLe: interventions.refuseeLe })
    .from(interventions)
    .where(eq(interventions.id, id))
    .limit(1);
  if (!m || !["creee", "planifiee", "affectee"].includes(m.statut)) redirect(avecMessage(retour, "erreur", "Cette mission est déjà engagée."));
  const dateTxt = String(formData.get("dateProgrammee") ?? "").trim();
  const nouvelleDate = dateTxt ? new Date(dateTxt) : null;
  if (nouvelleDate && Number.isNaN(nouvelleDate.getTime())) redirect(avecMessage(retour, "erreur", "Date invalide."));
  const message = String(formData.get("message") ?? "").trim().slice(0, 1000) || undefined;

  if (decision === "liberer") {
    await db.update(interventions).set({ technicienId: null, statut: "creee", ...REINIT_ENVOI }).where(eq(interventions.id, id));
    await journaliser({ entite: "intervention", entiteId: id, action: "mission_liberee", utilisateurId: user.id, details: "Refus traité : mission remise à affecter" });
    revalidatePath(retour);
    redirect(avecMessage(retour, "ok", "La mission est remise « à affecter »."));
  }

  const technicienId = decision === "renvoyer" ? m!.technicienId : String(formData.get("technicienId") ?? "");
  if (!technicienId || !z.string().uuid().safeParse(technicienId).success) redirect(avecMessage(retour, "erreur", "Choisissez le technicien."));
  if (!m!.projetId) redirect(avecMessage(retour, "erreur", "Mission sans projet : affectez-la depuis le Planning des missions."));
  const date = nouvelleDate ?? m!.dateProgrammee;
  if (!date) redirect(avecMessage(retour, "erreur", "Indiquez la date de la mission."));
  if (decision === "reaffecter") {
    const manques = await controlerHabilitations(technicienId!, [id]);
    if (manques.length) redirect(avecMessage(retour, "erreur", messageManques(await nomUtilisateur(technicienId!), manques)));
  }
  await db
    .update(interventions)
    .set({ technicienId: technicienId!, statut: "affectee", dateProgrammee: date!, retardNotifieLe: null })
    .where(eq(interventions.id, id));
  await envoyerMissionsAuTechnicien({ projetId: m!.projetId!, technicienId: technicienId!, interventionIds: [id], message, envoyeParId: user.id });
  await journaliser({
    entite: "intervention",
    entiteId: id,
    action: decision === "renvoyer" ? "mission_renvoyee" : "mission_reaffectee",
    utilisateurId: user.id,
    details: `Refus traité — ${decision === "renvoyer" ? "renvoyée au même technicien" : `réaffectée à ${await nomUtilisateur(technicienId!)}`}`,
  });
  revalidatePath(retour);
  redirect(avecMessage(retour, "ok", decision === "renvoyer" ? "Mission renvoyée au technicien — il doit de nouveau l'accepter." : "Mission réaffectée et envoyée."));
}

// ==========================================================================
// Phase 23 — Checklists de la mission (bureau)
// ==========================================================================
export async function ajouterChecklistMission(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("interventionId") ?? "");
  const modeleId = String(formData.get("modeleId") ?? "");
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(modeleId).success) redirect(page(id, "#checklist"));
  const [m] = await db.select({ statut: interventions.statut }).from(interventions).where(eq(interventions.id, id)).limit(1);
  if (!m || ["terminee", "validee", "cloturee"].includes(m.statut)) redirect(avecMessage(page(id), "erreur", "Mission terminée : la checklist ne peut plus changer."));
  const n = await attribuerChecklists(id, [modeleId], user.id);
  await journaliser({ entite: "intervention", entiteId: id, action: "checklist_ajoutee", utilisateurId: user.id, details: modeleId });
  revalidatePath(page(id));
  redirect(avecMessage(page(id, "#checklist"), n ? "ok" : "erreur", n ? "Checklist ajoutée à la mission." : "Cette checklist est déjà sur la mission (ou n'a pas de tâche)."));
}

export async function retirerChecklistMission(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const id = String(formData.get("interventionId") ?? "");
  const mcId = String(formData.get("missionChecklistId") ?? "");
  if (!z.string().uuid().safeParse(mcId).success) redirect(page(id));
  const [rempli] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(missionChecklistTaches)
    .where(and(eq(missionChecklistTaches.missionChecklistId, mcId), sql`${missionChecklistTaches.resultat} is not null`));
  if ((rempli?.n ?? 0) > 0) redirect(avecMessage(page(id, "#checklist"), "erreur", "Le technicien a déjà commencé cette checklist : elle ne peut plus être retirée."));
  await db.delete(missionChecklists).where(and(eq(missionChecklists.id, mcId), eq(missionChecklists.interventionId, id)));
  await journaliser({ entite: "intervention", entiteId: id, action: "checklist_retiree", utilisateurId: user.id, details: mcId });
  revalidatePath(page(id));
  redirect(avecMessage(page(id, "#checklist"), "ok", "Checklist retirée de la mission."));
}

/** Point ✗ : le bureau le marque « traité » ou ouvre une non-conformité (ISO). */
export async function traiterTacheNonConforme(formData: FormData) {
  const user = await requireUser([...GESTION]);
  const tacheId = String(formData.get("tacheId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!z.string().uuid().safeParse(tacheId).success) redirect("/responsable/interventions");
  const [t] = await db
    .select({ tache: missionChecklistTaches, interventionId: missionChecklists.interventionId, appareilId: interventions.appareilId, numero: appareils.numeroInterne, technicienId: interventions.technicienId })
    .from(missionChecklistTaches)
    .innerJoin(missionChecklists, eq(missionChecklistTaches.missionChecklistId, missionChecklists.id))
    .innerJoin(interventions, eq(missionChecklists.interventionId, interventions.id))
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .where(eq(missionChecklistTaches.id, tacheId))
    .limit(1);
  if (!t || t.tache.resultat !== "nok") redirect("/responsable/interventions");
  const retour = page(t!.interventionId, "#checklist");
  let ncId: string | null = t!.tache.nonConformiteId;
  if (decision === "nc" && !ncId) {
    const [nc] = await db
      .insert(nonConformites)
      .values({
        titre: `Checklist ${t!.numero} : ${t!.tache.libelle}`.slice(0, 200),
        description: `${t!.tache.commentaire ?? ""}${t!.tache.valeur ? `\nValeur relevée : ${t!.tache.valeur}${t!.tache.unite ? ` ${t!.tache.unite}` : ""}` : ""}`,
        gravite: "mineure",
        appareilId: t!.appareilId,
        interventionId: t!.interventionId,
        declarantId: t!.technicienId,
        responsableActionId: user.id,
      })
      .returning({ id: nonConformites.id });
    ncId = nc.id;
  }
  await db.update(missionChecklistTaches).set({ traiteLe: new Date(), traiteParId: user.id, nonConformiteId: ncId }).where(eq(missionChecklistTaches.id, tacheId));
  await journaliser({ entite: "intervention", entiteId: t!.interventionId, action: decision === "nc" ? "checklist_non_conformite" : "checklist_point_traite", utilisateurId: user.id, details: t!.tache.libelle });
  revalidatePath(page(t!.interventionId));
  redirect(avecMessage(retour, "ok", decision === "nc" ? "Non-conformité ouverte — suivez-la dans « Non-conformités »." : "Point marqué comme traité."));
}
