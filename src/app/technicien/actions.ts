"use server";

import { z } from "zod";
import { db } from "@/db";
import {
  appareils,
  demandesAide,
  interventions,
  missionJournal,
  mouvementsStock,
  nonConformites,
  pieces,
  rapportChecklistReponses,
  rapportPhotos,
  rapports,
  sites,
} from "@/db/schema";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { envoyerAlerteAide, envoyerAlerteDemande } from "@/lib/mail";
import { destinatairesAlertes } from "@/lib/demandes";
import { MOTIFS_REFUS, libelleRefus } from "@/lib/missions";
import { attribuerParDefaut, tachesObligatoiresManquantes } from "@/lib/checklists";
import { notifierBureau } from "@/lib/push";
import { peutModifierHeureReelle } from "@/lib/rapport-rules";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { after } from "next/server";
import { photosRecues } from "@/lib/photos";
import { avecMessage } from "@/lib/url";
import { lireReference } from "@/lib/televersement";
import { avecAnnulation, signerAnnulation } from "@/lib/annulation";
import { peutModifierRapport } from "@/lib/rapport-rules";
import { notifierObservateurs } from "@/lib/observateur";
import { marquerPassageRealise } from "@/lib/garantie-passages";
import { demandesMissionTerminee } from "@/lib/demandes";
import { etatDepuisRapport } from "@/lib/etat-appareil";
import { devisMissionTerminee, signalerBesoinDevis } from "@/lib/devis";

async function assertOwnIntervention(interventionId: string, userId: string, role: string) {
  const [row] = await db
    .select({ technicienId: interventions.technicienId })
    .from(interventions)
    .where(eq(interventions.id, interventionId))
    .limit(1);
  if (!row) throw new Error("Intervention introuvable.");
  if (role !== "administrateur" && row.technicienId !== userId) {
    throw new Error("Cette intervention n'est pas affectée à votre compte.");
  }
}

export async function commencerIntervention(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const interventionId = formData.get("interventionId") as string;
  await assertOwnIntervention(interventionId, user.id, user.role);

  const maintenant = new Date();
  // Phase 21 : la mission doit d'abord être acceptée manuellement (le bureau
  // sait ainsi que le technicien est disponible).
  const [etat] = await db
    .select({ accepteeLe: interventions.accepteeLe, refuseeLe: interventions.refuseeLe, statut: interventions.statut })
    .from(interventions)
    .where(eq(interventions.id, interventionId))
    .limit(1);
  if (!etat || !["creee", "planifiee", "affectee"].includes(etat.statut)) throw new Error("Cette mission ne peut pas être commencée.");
  if (!etat.accepteeLe && user.role !== "administrateur") throw new Error("Acceptez d'abord la mission.");
  await db
    .update(interventions)
    .set({ statut: "en_cours", dateDebut: maintenant })
    .where(eq(interventions.id, interventionId));
  // Phase 23 : mission sans checklist (créée avant) -> checklist suggérée.
  await attribuerParDefaut(interventionId);
  await db
    .update(interventions)
    .set({ vueLe: maintenant })
    .where(and(eq(interventions.id, interventionId), isNull(interventions.vueLe)));

  // Phase 18 : l'observateur suit en temps réel (« Technicien sur place »).
  const [m] = await db
    .select({ appareilId: interventions.appareilId, numero: appareils.numeroInterne })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .where(eq(interventions.id, interventionId))
    .limit(1);
  if (m) {
    after(() =>
      notifierObservateurs(m.appareilId, "temps_reel", {
        titre: "🔧 Technicien sur place",
        corps: `L'intervention sur l'ascenseur ${m.numero} a commencé.`,
        url: `/observateur/appareils/${m.appareilId}`,
      })
    );
  }

  revalidatePath("/technicien");
  revalidatePath(`/technicien/interventions/${interventionId}`);
  // Pas de redirect() : on reste sur la même page, Next rafraîchit
  // automatiquement les données du Server Component après l'action.
}

// Phase 17 : le technicien confirme avoir reçu la mission (accusé de réception).
export async function accepterMission(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const interventionId = String(formData.get("interventionId") ?? "");
  if (!z.string().uuid().safeParse(interventionId).success) throw new Error("Mission introuvable.");
  await assertOwnIntervention(interventionId, user.id, user.role);
  const maintenant = new Date();
  const [avant] = await db
    .select({ refuseeLe: interventions.refuseeLe, statut: interventions.statut })
    .from(interventions)
    .where(eq(interventions.id, interventionId))
    .limit(1);
  if (!avant || !["creee", "planifiee", "affectee"].includes(avant.statut)) throw new Error("Cette mission n'est plus à accepter.");
  // Phase 21 : accepter après un refus (changement d'avis) annule le refus.
  await db
    .update(interventions)
    .set({ accepteeLe: maintenant, refuseeLe: null, refusMotif: null, refusCommentaire: null })
    .where(and(eq(interventions.id, interventionId), isNull(interventions.accepteeLe)));
  await db
    .update(interventions)
    .set({ vueLe: maintenant })
    .where(and(eq(interventions.id, interventionId), isNull(interventions.vueLe)));
  await journaliser({
    entite: "intervention",
    entiteId: interventionId,
    action: "mission_acceptee",
    utilisateurId: user.id,
    details: avant.refuseeLe ? "Mission finalement acceptée (refus annulé)" : "Mission acceptée par le technicien",
  });
  if (avant.refuseeLe) {
    after(() =>
      notifierBureau({ titre: "✅ Mission finalement acceptée", corps: `${user.name ?? "Le technicien"} a accepté la mission qu'il avait refusée.`, url: `/responsable/missions/${interventionId}`, tag: `refus-${interventionId}` })
    );
  }
  revalidatePath("/technicien");
  revalidatePath(`/technicien/interventions/${interventionId}`);
}

// Phase 21 : le technicien ne peut pas faire la mission — il le dit avec un
// motif. La mission reste à son nom : c'est le bureau (admin) qui décide
// (réaffecter, renvoyer après un appel, remettre à affecter).
export async function refuserMission(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const interventionId = String(formData.get("interventionId") ?? "");
  if (!z.string().uuid().safeParse(interventionId).success) throw new Error("Mission introuvable.");
  await assertOwnIntervention(interventionId, user.id, user.role);
  const motif = String(formData.get("motif") ?? "");
  const commentaire = String(formData.get("commentaire") ?? "").trim().slice(0, 500);
  const retourErreur = (m: string) => redirect(`/technicien/interventions/${interventionId}?erreur=${encodeURIComponent(m)}`);
  if (!(motif in MOTIFS_REFUS)) retourErreur("Choisissez la raison.");
  if (motif === "autre" && !commentaire) retourErreur("Précisez la raison.");
  const [m] = await db
    .select({
      statut: interventions.statut,
      accepteeLe: interventions.accepteeLe,
      refuseeLe: interventions.refuseeLe,
      dateProgrammee: interventions.dateProgrammee,
      numero: appareils.numeroInterne,
      projetId: interventions.projetId,
    })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .where(eq(interventions.id, interventionId))
    .limit(1);
  if (!m || !["creee", "planifiee", "affectee"].includes(m.statut)) retourErreur("Cette mission ne peut plus être refusée.");
  const maintenant = new Date();
  await db
    .update(interventions)
    .set({ refuseeLe: maintenant, refusMotif: motif, refusCommentaire: commentaire || null, accepteeLe: null })
    .where(eq(interventions.id, interventionId));
  await db.update(interventions).set({ vueLe: maintenant }).where(and(eq(interventions.id, interventionId), isNull(interventions.vueLe)));
  const raison = `${libelleRefus(motif)}${commentaire ? ` — ${commentaire}` : ""}`;
  await journaliser({ entite: "intervention", entiteId: interventionId, action: "mission_refusee", utilisateurId: user.id, details: raison });
  const quand = m!.dateProgrammee ? m!.dateProgrammee.toLocaleString("fr-BE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short" }) : "sans date";
  after(async () => {
    await notifierBureau({ titre: "⛔ Mission refusée", corps: `${user.name ?? "Le technicien"} · ${m!.numero} (${quand}) — ${raison}`, url: `/responsable/missions/${interventionId}`, tag: `refus-${interventionId}` });
    await envoyerAlerteDemande({
      destinataires: await destinatairesAlertes(),
      sujet: `Mission refusée — ${user.name ?? "technicien"} · ${m!.numero}`,
      lignes: [["Technicien", user.name ?? ""], ["Appareil", m!.numero], ["Date prévue", quand], ["Raison", libelleRefus(motif)]],
      description: commentaire || "Aucun commentaire.",
      lien: `${process.env.NEXTAUTH_URL || "https://robuswork.tech"}/responsable/missions/${interventionId}`,
      urgence: false,
      bouton: "Décider (réaffecter / renvoyer)",
    });
  });
  revalidatePath("/technicien");
  revalidatePath(`/technicien/interventions/${interventionId}`);
  redirect(`/technicien/interventions/${interventionId}?refusee=1`);
}

const rapportSchema = z.object({
  interventionId: z.string().uuid(),
  travauxRealises: z.string().min(1, "Merci de décrire les travaux réalisés."),
  observations: z.string().optional(),
  tempsPasseMinutes: z.coerce.number().int().min(0).optional(),
  statutFinalAppareil: z.enum([
    "en_service",
    "sous_surveillance",
    "en_panne",
    "hors_service",
    "en_travaux",
  ]),
  checklistModeleId: z.string().uuid().optional(),
  // Phase 10 : heure réelle de l'intervention (peut différer de l'heure
  // programmée) — optionnelle à la clôture, modifiable ensuite pendant 24h.
  heureReelle: z.string().optional(),
});

export async function terminerIntervention(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const raw = {
    interventionId: formData.get("interventionId"),
    travauxRealises: formData.get("travauxRealises"),
    observations: formData.get("observations") || undefined,
    tempsPasseMinutes: formData.get("tempsPasseMinutes") || undefined,
    statutFinalAppareil: formData.get("statutFinalAppareil"),
    checklistModeleId: formData.get("checklistModeleId") || undefined,
    heureReelle: formData.get("heureReelle") || undefined,
  };
  const parsed = rapportSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Formulaire invalide");

  await assertOwnIntervention(parsed.data.interventionId, user.id, user.role);

  // Phase 23 : toutes les tâches obligatoires de la checklist doivent être remplies.
  const manquantes = await tachesObligatoiresManquantes(parsed.data.interventionId);
  if (manquantes > 0) {
    redirect(`/technicien/interventions/${parsed.data.interventionId}?erreur=${encodeURIComponent(`Checklist incomplète : ${manquantes} tâche(s) obligatoire(s) à remplir avant d'envoyer le rapport.`)}#checklist`);
  }

  // Phase 18 : les photos envoyées pendant la mission (fil) comptent.
  // Phase 25 : photos déjà envoyées une par une (références) ou jointes.
  let nouvellesPhotos: string[] = [];
  try {
    nouvellesPhotos = await photosRecues(formData, `rap-${parsed.data.interventionId}`, user.id);
  } catch (e) {
    redirect(avecMessage(`/technicien/interventions/${parsed.data.interventionId}#rapport`, "erreur", (e as Error).message));
  }
  // Phase 25 : seulement les photos du passage en cours (une mission peut repartir après un devis).
  const [debutPassage] = await db.select({ d: interventions.dateDebut }).from(interventions).where(eq(interventions.id, parsed.data.interventionId)).limit(1);
  const fil = await db
    .select({ photos: missionJournal.photos })
    .from(missionJournal)
    .where(and(eq(missionJournal.interventionId, parsed.data.interventionId), debutPassage?.d ? gte(missionJournal.createdAt, new Date(debutPassage.d.getTime() - 60000)) : undefined))
    .orderBy(asc(missionJournal.createdAt));
  const photosFil = fil.flatMap((f) => f.photos);
  if (nouvellesPhotos.length === 0 && photosFil.length === 0) {
    redirect(avecMessage(`/technicien/interventions/${parsed.data.interventionId}#rapport`, "erreur", "Merci d'ajouter au moins une photo pour clôturer la mission."));
  }

  const [rapport] = await db
    .insert(rapports)
    .values({
      interventionId: parsed.data.interventionId,
      checklistModeleId: parsed.data.checklistModeleId ?? null,
      travauxRealises: parsed.data.travauxRealises,
      observations: parsed.data.observations ?? null,
      tempsPasseMinutes: parsed.data.tempsPasseMinutes ?? null,
      statutFinalAppareil: parsed.data.statutFinalAppareil,
      dateEnvoi: new Date(),
      heureReelle: parsed.data.heureReelle ? new Date(parsed.data.heureReelle) : null,
    })
    .returning();

  // Réponses de checklist : tous les champs `conforme_<itemId>` /
  // `observation_<itemId>` présents dans le formulaire correspondent aux
  // items du modèle affiché au technicien à l'écran.
  const reponses: { itemId: string; conforme: number | null; observation: string | null }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("conforme_")) continue;
    const itemId = key.slice("conforme_".length);
    const conforme = value === "oui" ? 1 : value === "non" ? 0 : null;
    const observation = (formData.get(`observation_${itemId}`) as string | null) || null;
    reponses.push({ itemId, conforme, observation });
  }
  if (reponses.length > 0) {
    await db.insert(rapportChecklistReponses).values(
      reponses.map((r) => ({
        rapportId: rapport.id,
        itemId: r.itemId,
        conforme: r.conforme,
        observation: r.observation,
      }))
    );
  }

  const urls = [...photosFil, ...nouvellesPhotos];
  if (urls.length) await db.insert(rapportPhotos).values(urls.map((url) => ({ rapportId: rapport.id, url })));

  await db
    .update(interventions)
    .set({ statut: "terminee", dateFin: new Date() })
    .where(eq(interventions.id, parsed.data.interventionId));
  // Phase 25 : l'état de l'ascenseur suit le rapport (vu tout de suite par le client).
  await etatDepuisRapport(parsed.data.interventionId, user.id);
  // Phase 25b : devis demandé par le technicien / travaux du devis terminés.
  await devisMissionTerminee(parsed.data.interventionId);
  const besoinDevis = String(formData.get("besoinDevis") ?? "").trim().slice(0, 4000);
  if (formData.get("devisNecessaire") === "on") {
    await signalerBesoinDevis(parsed.data.interventionId, besoinDevis || "Devis demandé par le technicien (voir le rapport).", user.id);
  }
  // Phase 19 : passage de garantie lié -> réalisé (le compteur baisse maintenant).
  await marquerPassageRealise(parsed.data.interventionId);
  // Phase 20 : demande client liée (panne…) -> résolue, client prévenu.
  await demandesMissionTerminee(parsed.data.interventionId);

  const [fin] = await db
    .select({ appareilId: interventions.appareilId, numero: appareils.numeroInterne })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .where(eq(interventions.id, parsed.data.interventionId))
    .limit(1);
  if (fin) {
    after(() =>
      notifierObservateurs(fin.appareilId, "temps_reel", {
        titre: "✅ Intervention terminée",
        corps: `L'intervention sur l'ascenseur ${fin.numero} est terminée. Le rapport sera disponible après validation par ROBUS.`,
        url: `/observateur/appareils/${fin.appareilId}`,
      })
    );
  }

  revalidatePath("/technicien");
  revalidatePath(`/technicien/interventions/${parsed.data.interventionId}`);
  redirect(avecMessage("/technicien", "ok", "Rapport envoyé au bureau ✓"));
}

// Phase 10 : correction de l'heure réelle sur un rapport déjà envoyé —
// possible pour le technicien pendant 24h après l'heure programmée de
// l'intervention, sans limite de temps pour l'administrateur.
const modifierHeureReelleSchema = z.object({
  interventionId: z.string().uuid(),
  heureReelle: z.string().min(1, "Merci de renseigner une heure."),
});

export async function modifierHeureReelleRapport(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const parsed = modifierHeureReelleSchema.safeParse({
    interventionId: formData.get("interventionId"),
    heureReelle: formData.get("heureReelle"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Formulaire invalide");

  await assertOwnIntervention(parsed.data.interventionId, user.id, user.role);

  const [row] = await db
    .select({ dateProgrammee: interventions.dateProgrammee })
    .from(interventions)
    .where(eq(interventions.id, parsed.data.interventionId))
    .limit(1);
  if (!row) throw new Error("Intervention introuvable.");

  if (!peutModifierHeureReelle(row.dateProgrammee, user.role)) {
    throw new Error(
      "Le délai de 24h après l'heure programmée est dépassé — l'heure réelle ne peut plus être modifiée."
    );
  }

  const [rapport] = await db
    .select({ id: rapports.id })
    .from(rapports)
    .where(eq(rapports.interventionId, parsed.data.interventionId))
    .limit(1);
  if (!rapport) throw new Error("Aucun rapport à corriger pour cette intervention.");

  await db
    .update(rapports)
    .set({ heureReelle: new Date(parsed.data.heureReelle) })
    .where(eq(rapports.id, rapport.id));

  await journaliser({
    entite: "intervention",
    entiteId: parsed.data.interventionId,
    action: "heure_reelle_modifiee",
    utilisateurId: user.id,
  });

  revalidatePath(`/technicien/interventions/${parsed.data.interventionId}`);
}

const nonConformiteTechnicienSchema = z.object({
  interventionId: z.string().uuid(),
  titre: z.string().min(3, "Merci de préciser un titre."),
  description: z.string().optional(),
  gravite: z.enum(["mineure", "majeure", "critique"]),
});

export async function declarerNonConformite(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const parsed = nonConformiteTechnicienSchema.safeParse({
    interventionId: formData.get("interventionId"),
    titre: formData.get("titre"),
    description: formData.get("description") || undefined,
    gravite: formData.get("gravite"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Formulaire invalide");

  await assertOwnIntervention(parsed.data.interventionId, user.id, user.role);

  const [row] = await db
    .select({ appareilId: interventions.appareilId })
    .from(interventions)
    .where(eq(interventions.id, parsed.data.interventionId))
    .limit(1);
  const [appareil] = row?.appareilId
    ? await db.select().from(appareils).where(eq(appareils.id, row.appareilId)).limit(1)
    : [undefined];
  // Phase 6 : l'Appareil n'est plus nécessairement rattaché à un Site — on
  // ne cherche le Site que s'il existe encore un siteId.
  const [site] = appareil?.siteId
    ? await db.select().from(sites).where(eq(sites.id, appareil.siteId)).limit(1)
    : [undefined];

  await db.insert(nonConformites).values({
    titre: parsed.data.titre,
    description: parsed.data.description ?? null,
    gravite: parsed.data.gravite,
    clientId: site?.clientId ?? null,
    siteId: site?.id ?? null,
    appareilId: appareil?.id ?? null,
    interventionId: parsed.data.interventionId,
    declarantId: user.id,
  });

  revalidatePath(`/technicien/interventions/${parsed.data.interventionId}`);
  redirect(`/technicien/interventions/${parsed.data.interventionId}?nc=1`);
}

// ---------- "Besoin d'aide" (Phase 6) ----------
const demanderAideSchema = z.object({
  interventionId: z.string().uuid(),
  message: z.string().optional(),
});

export async function demanderAide(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const parsed = demanderAideSchema.safeParse({
    interventionId: formData.get("interventionId"),
    message: formData.get("message") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Formulaire invalide");

  await assertOwnIntervention(parsed.data.interventionId, user.id, user.role);

  const [created] = await db
    .insert(demandesAide)
    .values({
      interventionId: parsed.data.interventionId,
      technicienId: user.id,
      message: parsed.data.message ?? null,
    })
    .returning();

  await journaliser({
    entite: "intervention",
    entiteId: parsed.data.interventionId,
    action: "demande_aide",
    utilisateurId: user.id,
    details: parsed.data.message ?? null,
  });

  const [row] = await db
    .select({ appareilId: interventions.appareilId })
    .from(interventions)
    .where(eq(interventions.id, parsed.data.interventionId))
    .limit(1);
  const [appareil] = row?.appareilId
    ? await db
        .select({ numeroInterne: appareils.numeroInterne })
        .from(appareils)
        .where(eq(appareils.id, row.appareilId))
        .limit(1)
    : [undefined];

  await envoyerAlerteAide({
    demandeId: created.id,
    interventionId: parsed.data.interventionId,
    technicienNom: user.name ?? "Technicien",
    numeroInterne: appareil?.numeroInterne ?? "—",
    message: parsed.data.message ?? null,
  });
  // Phase 16 : notification immédiate sur les téléphones du bureau.
  await notifierBureau({
    titre: `🆘 Demande d'aide — ${user.name ?? "Technicien"}`,
    corps: `${appareil?.numeroInterne ?? "Appareil"}${parsed.data.message ? ` : ${parsed.data.message.slice(0, 120)}` : ""}`,
    url: "/responsable/interventions",
    tag: `aide-${created.id}`,
  });

  revalidatePath(`/technicien/interventions/${parsed.data.interventionId}`);
  redirect(`/technicien/interventions/${parsed.data.interventionId}?aide=1`);
}

// ---------- Pièces utilisées par le technicien (Phase 6) ----------
const enregistrerMouvementTechnicienSchema = z.object({
  interventionId: z.string().uuid(),
  pieceId: z.string().uuid("Pièce invalide"),
  quantite: z.coerce.number().int().positive("Quantité invalide"),
});

// Un technicien ne peut déclarer qu'une SORTIE de stock (usage sur une
// mission) — jamais une entrée, réservée au bureau via enregistrerMouvement.
export async function enregistrerMouvementTechnicien(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const parsed = enregistrerMouvementTechnicienSchema.safeParse({
    interventionId: formData.get("interventionId"),
    pieceId: formData.get("pieceId"),
    quantite: formData.get("quantite"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await assertOwnIntervention(parsed.data.interventionId, user.id, user.role);

  const [piece] = await db
    .select({ id: pieces.id, quantiteStock: pieces.quantiteStock })
    .from(pieces)
    .where(eq(pieces.id, parsed.data.pieceId))
    .limit(1);
  if (!piece) throw new Error("Pièce introuvable.");

  if (parsed.data.quantite > piece.quantiteStock) {
    throw new Error(
      `Stock insuffisant : il ne reste que ${piece.quantiteStock} unité(s) en stock pour cette pièce.`
    );
  }

  await db
    .update(pieces)
    .set({ quantiteStock: piece.quantiteStock - parsed.data.quantite })
    .where(eq(pieces.id, piece.id));

  await db.insert(mouvementsStock).values({
    pieceId: piece.id,
    type: "sortie",
    quantite: parsed.data.quantite,
    interventionId: parsed.data.interventionId,
    effectueParId: user.id,
    commentaire: "Déclaré par le technicien",
  });

  await journaliser({
    entite: "intervention",
    entiteId: parsed.data.interventionId,
    action: "piece_utilisee",
    utilisateurId: user.id,
    details: `${parsed.data.quantite} x ${piece.id}`,
  });

  revalidatePath(`/technicien/interventions/${parsed.data.interventionId}`);
}


// ==========================================================================
// Phase 18 — Fil de mission en direct, corrections du rapport (24 h)
// ==========================================================================

async function lireMission(interventionId: string) {
  const [m] = await db
    .select({
      technicienId: interventions.technicienId,
      statut: interventions.statut,
      dateFin: interventions.dateFin,
    })
    .from(interventions)
    .where(eq(interventions.id, interventionId))
    .limit(1);
  if (!m) throw new Error("Mission introuvable.");
  return m;
}

/** Photos et/ou note envoyées pendant la mission : le bureau les voit en direct. */
export async function ajouterAuFil(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const interventionId = String(formData.get("interventionId") ?? "");
  if (!z.string().uuid().safeParse(interventionId).success) throw new Error("Mission introuvable.");
  await assertOwnIntervention(interventionId, user.id, user.role);
  const m = await lireMission(interventionId);
  if (m.statut !== "en_cours") throw new Error("Commencez la mission avant d'envoyer des photos.");
  const texte = String(formData.get("texte") ?? "").trim().slice(0, 1000);
  const retour = `/technicien/interventions/${interventionId}#direct`;
  let photos: string[] = [];
  try {
    photos = await photosRecues(formData, `fil-${interventionId}`, user.id);
  } catch (e) {
    redirect(avecMessage(retour, "erreur", (e as Error).message));
  }
  if (!texte && photos.length === 0) redirect(avecMessage(retour, "erreur", "Écrivez une note avant d'envoyer."));
  await db.insert(missionJournal).values({ interventionId, auteurId: user.id, texte: texte || null, photos });
  revalidatePath(`/technicien/interventions/${interventionId}`);
  redirect(avecMessage(retour, "ok", photos.length ? "Envoyé au bureau ✓" : "Note envoyée au bureau ✓"));
}

/**
 * Phase 25 : une photo du fil « en direct », envoyée dès qu'elle est
 * téléversée (le technicien voit ✓ photo par photo, le bureau la voit tout de suite).
 */
export async function ajouterPhotoAuFil(interventionId: string, ref: string): Promise<{ erreur?: string }> {
  const user = await requireUser(ROLES_TECHNICIEN);
  if (!z.string().uuid().safeParse(interventionId).success) return { erreur: "Mission introuvable." };
  try {
    await assertOwnIntervention(interventionId, user.id, user.role);
    const m = await lireMission(interventionId);
    if (m.statut !== "en_cours") return { erreur: "Commencez la mission avant d'envoyer des photos." };
    const { url } = await lireReference(ref, user.id, ["rapports"]);
    await db.insert(missionJournal).values({ interventionId, auteurId: user.id, texte: null, photos: [url] });
  } catch (e) {
    return { erreur: (e as Error).message };
  }
  revalidatePath(`/technicien/interventions/${interventionId}`);
  return {};
}

const modifierRapportSchema = z.object({
  interventionId: z.string().uuid(),
  travauxRealises: z.string().trim().min(1, "Merci de décrire les travaux réalisés."),
  observations: z.string().optional(),
  tempsPasseMinutes: z.coerce.number().int().min(0).max(100000).optional(),
  heureReelle: z.string().optional(),
});

async function controlerModification(interventionId: string, user: { id: string; role: string }) {
  await assertOwnIntervention(interventionId, user.id, user.role);
  const m = await lireMission(interventionId);
  if (!peutModifierRapport(m, user.role)) {
    throw new Error(
      m.statut === "terminee"
        ? "Le délai de 24 h après la fin de l'intervention est dépassé — le rapport est verrouillé."
        : "Ce rapport a été validé par le bureau — il est verrouillé."
    );
  }
  const [rapport] = await db.select().from(rapports).where(eq(rapports.interventionId, interventionId)).limit(1);
  if (!rapport) throw new Error("Aucun rapport pour cette intervention.");
  return rapport;
}

export async function modifierRapport(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const parsed = modifierRapportSchema.safeParse({
    interventionId: formData.get("interventionId"),
    travauxRealises: formData.get("travauxRealises"),
    observations: formData.get("observations") || undefined,
    tempsPasseMinutes: formData.get("tempsPasseMinutes") || undefined,
    heureReelle: formData.get("heureReelle") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Formulaire invalide");
  const rapport = await controlerModification(parsed.data.interventionId, user);

  const nouveau = {
    travauxRealises: parsed.data.travauxRealises,
    observations: parsed.data.observations?.trim() || null,
    tempsPasseMinutes: parsed.data.tempsPasseMinutes ?? null,
    heureReelle: parsed.data.heureReelle ? new Date(parsed.data.heureReelle) : rapport.heureReelle,
  };
  const changes: string[] = [];
  if (nouveau.travauxRealises !== rapport.travauxRealises) changes.push("travaux réalisés");
  if (nouveau.observations !== rapport.observations) changes.push("observations");
  if (nouveau.tempsPasseMinutes !== rapport.tempsPasseMinutes) changes.push("temps passé");
  if ((nouveau.heureReelle?.getTime() ?? 0) !== (rapport.heureReelle?.getTime() ?? 0)) changes.push("heure réelle");
  if (changes.length) {
    await db
      .update(rapports)
      .set({ ...nouveau, modifieLe: new Date(), nbModifications: sql`${rapports.nbModifications} + 1` })
      .where(eq(rapports.id, rapport.id));
    await journaliser({
      entite: "intervention",
      entiteId: parsed.data.interventionId,
      action: "rapport_modifie",
      utilisateurId: user.id,
      details: `Modifié : ${changes.join(", ")}`,
    });
  }
  revalidatePath(`/technicien/interventions/${parsed.data.interventionId}`);
  redirect(`/technicien/interventions/${parsed.data.interventionId}?modifie=1`);
}

export async function ajouterPhotosRapport(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const interventionId = String(formData.get("interventionId") ?? "");
  if (!z.string().uuid().safeParse(interventionId).success) throw new Error("Mission introuvable.");
  const rapport = await controlerModification(interventionId, user);
  const retour = `/technicien/interventions/${interventionId}#rapport-photos`;
  let urls: string[] = [];
  try {
    urls = await photosRecues(formData, rapport.id, user.id);
  } catch (e) {
    redirect(avecMessage(retour, "erreur", (e as Error).message));
  }
  if (!urls.length) redirect(avecMessage(retour, "erreur", "Choisissez au moins une photo."));
  await db.insert(rapportPhotos).values(urls.map((url) => ({ rapportId: rapport.id, url })));
  await db
    .update(rapports)
    .set({ modifieLe: new Date(), nbModifications: sql`${rapports.nbModifications} + 1` })
    .where(eq(rapports.id, rapport.id));
  await journaliser({
    entite: "intervention",
    entiteId: interventionId,
    action: "rapport_photos_ajoutees",
    utilisateurId: user.id,
    details: `${urls.length} photo(s) ajoutée(s)`,
  });
  revalidatePath(`/technicien/interventions/${interventionId}`);
  redirect(avecMessage(retour, "ok", `${urls.length} photo(s) ajoutée(s) au rapport ✓`));
}

export async function retirerPhotoRapport(formData: FormData) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const interventionId = String(formData.get("interventionId") ?? "");
  const photoId = String(formData.get("photoId") ?? "");
  if (!z.string().uuid().safeParse(interventionId).success || !z.string().uuid().safeParse(photoId).success) {
    throw new Error("Photo introuvable.");
  }
  const rapport = await controlerModification(interventionId, user);
  const retour = `/technicien/interventions/${interventionId}#rapport-photos`;
  const photos = await db.select({ id: rapportPhotos.id, url: rapportPhotos.url }).from(rapportPhotos).where(eq(rapportPhotos.rapportId, rapport.id));
  const photo = photos.find((p) => p.id === photoId);
  if (!photo) redirect(avecMessage(retour, "erreur", "Photo déjà retirée."));
  if (photos.length <= 1) redirect(avecMessage(retour, "erreur", "Le rapport doit garder au moins une photo."));
  // Le fichier reste sur le serveur (traçabilité ISO) : seule la liaison au rapport est retirée.
  await db.delete(rapportPhotos).where(and(eq(rapportPhotos.id, photoId), eq(rapportPhotos.rapportId, rapport.id)));
  await db
    .update(rapports)
    .set({ modifieLe: new Date(), nbModifications: sql`${rapports.nbModifications} + 1` })
    .where(eq(rapports.id, rapport.id));
  await journaliser({
    entite: "intervention",
    entiteId: interventionId,
    action: "rapport_photo_retiree",
    utilisateurId: user.id,
  });
  revalidatePath(`/technicien/interventions/${interventionId}`);
  const jeton = signerAnnulation(user.id, { k: "photo_rapport", rapportId: rapport.id, url: photo!.url, interventionId });
  redirect(avecAnnulation(avecMessage(retour, "ok", "Photo retirée ✓"), jeton));
}
