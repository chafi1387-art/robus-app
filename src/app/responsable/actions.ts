"use server";
import { REINIT_ENVOI } from "@/lib/missions";
import { attribuerChecklists, attribuerParDefaut } from "@/lib/checklists";

import { z } from "zod";
import { db } from "@/db";
import {
  appareils,
  clients,
  contactsClient,
  demandesAide,
  interventions,
  prestations,
  prestationsCatalogue,
  projets,
  sites,
  users,
} from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { envoyerEtJournaliserOrdreMission } from "./projets/actions";
import { controlerHabilitations, controlerHabilitationsSpecs, messageManques, nomUtilisateur } from "@/lib/habilitations";
import { avecMessage } from "@/lib/url";

const clientSchema = z.object({
  raisonSociale: z.string().min(2, "Raison sociale requise"),
  type: z.enum(["copropriete", "entreprise", "particulier", "syndicat", "sous_traitance"]),
});

export async function createClient(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = clientSchema.safeParse({
    raisonSociale: formData.get("raisonSociale"),
    type: formData.get("type"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [created] = await db.insert(clients).values(parsed.data).returning();
  revalidatePath("/responsable/clients");
  redirect(`/responsable/clients/${created.id}`);
}

export async function updateClientType(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = z.string().uuid().parse(formData.get("clientId"));
  const type = clientSchema.shape.type.parse(formData.get("type"));
  const [avant] = await db.select({ type: clients.type }).from(clients).where(eq(clients.id, id)).limit(1);
  if (!avant) throw new Error("Client introuvable");
  if (avant.type !== type) {
    await db.update(clients).set({ type }).where(eq(clients.id, id));
    await journaliser({
      entite: "client",
      entiteId: id,
      action: "changement_type",
      utilisateurId: user.id,
      details: `${avant.type} -> ${type}`,
    });
  }
  revalidatePath(`/responsable/clients/${id}`);
  revalidatePath("/responsable/clients");
}

const siteSchema = z.object({
  clientId: z.string().uuid(),
  adresse: z.string().min(3, "Adresse requise"),
  instructionsAcces: z.string().optional(),
});

export async function createSite(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = siteSchema.safeParse({
    clientId: formData.get("clientId"),
    adresse: formData.get("adresse"),
    instructionsAcces: formData.get("instructionsAcces") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  // Règle d'intégrité : le client doit exister (contrainte FK en base également).
  const [clientExists] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, parsed.data.clientId))
    .limit(1);
  if (!clientExists) throw new Error("Client introuvable — impossible de créer le site.");

  const [created] = await db.insert(sites).values(parsed.data).returning();
  revalidatePath(`/responsable/clients/${parsed.data.clientId}`);
  revalidatePath("/responsable/sites");
  redirect(`/responsable/sites/${created.id}`);
}

const STATUTS_APPAREIL = [
  "en_service",
  "sous_surveillance",
  "en_panne",
  "hors_service",
  "en_travaux",
  "installation",
] as const;

// Phase 30 : longueurs alignées sur la base (80 caractères) + messages clairs
// (avant : un n° interne trop long faisait planter l'enregistrement).
const texteCourt = (champ: string) => z.string().trim().max(80, `${champ} : 80 caractères maximum.`).optional();
const appareilSchema = z.object({
  numeroInterne: z.string().trim().min(1, "Numéro interne requis.").max(80, "Le n° interne ne doit pas dépasser 80 caractères."),
  numeroSerie: texteCourt("N° de série"),
  marque: texteCourt("Marque"),
  modele: texteCourt("Modèle"),
  typeAppareil: texteCourt("Type d'appareil"),
  anneeInstallation: z.coerce.number({ message: "Année d'installation invalide." }).int("Année d'installation invalide.").min(1900, "Année d'installation invalide.").max(2100, "Année d'installation invalide.").optional(),
  charge: z.coerce.number({ message: "Charge invalide (nombre en kg)." }).min(0, "Charge invalide.").max(100000, "Charge invalide.").optional(),
  vitesse: z.coerce.number({ message: "Vitesse invalide (nombre en m/s)." }).min(0, "Vitesse invalide.").max(100, "Vitesse invalide.").optional(),
  niveaux: z.coerce.number({ message: "Nombre de niveaux invalide." }).int("Nombre de niveaux invalide.").min(0, "Nombre de niveaux invalide.").max(500, "Nombre de niveaux invalide.").optional(),
  typePortes: texteCourt("Type de portes"),
  statut: z.enum(STATUTS_APPAREIL),
});

/** Phase 30 : un n° interne déjà pris par un autre appareil ? */
async function numeroDejaPris(numero: string, saufId?: string) {
  const [a] = await db
    .select({ id: appareils.id })
    .from(appareils)
    .where(saufId ? and(eq(appareils.numeroInterne, numero), ne(appareils.id, saufId)) : eq(appareils.numeroInterne, numero))
    .limit(1);
  return !!a;
}

function readAppareilForm(formData: FormData) {
  return {
    numeroInterne: formData.get("numeroInterne"),
    numeroSerie: formData.get("numeroSerie") || undefined,
    marque: formData.get("marque") || undefined,
    modele: formData.get("modele") || undefined,
    typeAppareil: formData.get("typeAppareil") || undefined,
    anneeInstallation: formData.get("anneeInstallation") || undefined,
    charge: formData.get("charge") || undefined,
    vitesse: formData.get("vitesse") || undefined,
    niveaux: formData.get("niveaux") || undefined,
    typePortes: formData.get("typePortes") || undefined,
    statut: formData.get("statut") || "en_service",
  };
}

// Phase 6 : l'Appareil se crée désormais seul, sans Site — son rattachement
// à un Client se fait ensuite via un Projet (voir projet_appareils).
export async function createAppareil(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const retourForm = String(formData.get("retour") ?? "");
  const retour = retourForm.startsWith("/responsable/") ? retourForm : "/responsable/appareils";
  const parsed = appareilSchema.safeParse(readAppareilForm(formData));
  if (!parsed.success) redirect(avecMessage(retour, "erreur", parsed.error.issues[0]?.message ?? "Données invalides."));
  if (await numeroDejaPris(parsed.data!.numeroInterne)) {
    redirect(avecMessage(retour, "erreur", `Le n° interne « ${parsed.data!.numeroInterne} » est déjà utilisé par un autre appareil.`));
  }

  const [created] = await db
    .insert(appareils)
    .values({
      ...parsed.data!,
      anneeInstallation: parsed.data!.anneeInstallation ?? null,
      charge: parsed.data!.charge != null ? String(parsed.data!.charge) : null,
      vitesse: parsed.data!.vitesse != null ? String(parsed.data!.vitesse) : null,
      niveaux: parsed.data!.niveaux ?? null,
    })
    .returning();
  revalidatePath("/responsable/appareils");
  redirect(`/responsable/appareils/${created.id}`);
}

const updateAppareilSchema = appareilSchema.extend({
  appareilId: z.string().uuid(),
});

export async function updateAppareil(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const raw = readAppareilForm(formData);
  const parsed = updateAppareilSchema.safeParse({
    ...raw,
    appareilId: formData.get("appareilId"),
  });
  const idForm = String(formData.get("appareilId") ?? "");
  const retourModif = `/responsable/appareils/${idForm}?tab=modifier`;
  if (!parsed.success) {
    if (!z.string().uuid().safeParse(idForm).success) redirect("/responsable/appareils");
    redirect(avecMessage(retourModif, "erreur", parsed.error.issues[0]?.message ?? "Données invalides."));
  }

  const [existing] = await db
    .select({ siteId: appareils.siteId })
    .from(appareils)
    .where(eq(appareils.id, parsed.data.appareilId))
    .limit(1);
  if (!existing) throw new Error("Appareil introuvable.");
  if (await numeroDejaPris(parsed.data.numeroInterne, parsed.data.appareilId)) {
    redirect(avecMessage(retourModif, "erreur", `Le n° interne « ${parsed.data.numeroInterne} » est déjà utilisé par un autre appareil.`));
  }

  await db
    .update(appareils)
    .set({
      numeroInterne: parsed.data.numeroInterne,
      numeroSerie: parsed.data.numeroSerie ?? null,
      marque: parsed.data.marque ?? null,
      modele: parsed.data.modele ?? null,
      typeAppareil: parsed.data.typeAppareil ?? null,
      anneeInstallation: parsed.data.anneeInstallation ?? null,
      charge: parsed.data.charge != null ? String(parsed.data.charge) : null,
      vitesse: parsed.data.vitesse != null ? String(parsed.data.vitesse) : null,
      niveaux: parsed.data.niveaux ?? null,
      typePortes: parsed.data.typePortes ?? null,
      statut: parsed.data.statut,
    })
    .where(eq(appareils.id, parsed.data.appareilId));

  await journaliser({
    entite: "appareil",
    entiteId: parsed.data.appareilId,
    action: "modification_fiche",
    utilisateurId: user.id,
  });

  revalidatePath(`/responsable/appareils/${parsed.data.appareilId}`);
  revalidatePath("/responsable/appareils");
  if (existing.siteId) revalidatePath(`/responsable/sites/${existing.siteId}`);
  redirect(avecMessage(`/responsable/appareils/${parsed.data.appareilId}?tab=modifier`, "ok", "Fiche enregistrée ✓"));
}

const ETATS_APPAREIL = ["en_service", "sous_surveillance", "en_panne", "hors_service", "en_travaux", "installation"] as const;
const LIBELLE_ETAT: Record<string, string> = {
  en_service: "En service",
  sous_surveillance: "Sous surveillance",
  en_panne: "En panne",
  hors_service: "Hors service",
  en_travaux: "En travaux",
  installation: "Installation",
};

/** Phase 26 : changer l'état d'un appareil en un clic (fiche appareil). L'heure du changement est gardée par la base. */
export async function changerEtatAppareilBureau(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("appareilId") ?? "");
  const statut = String(formData.get("statut") ?? "");
  if (!z.string().uuid().safeParse(id).success) redirect("/responsable/appareils");
  const retour = `/responsable/appareils/${id}`;
  if (!(ETATS_APPAREIL as readonly string[]).includes(statut)) redirect(avecMessage(retour, "erreur", "État inconnu."));
  const [a] = await db.select({ statut: appareils.statut }).from(appareils).where(eq(appareils.id, id)).limit(1);
  if (!a) redirect("/responsable/appareils");
  if (a!.statut === statut) redirect(retour);
  await db.update(appareils).set({ statut: statut as (typeof ETATS_APPAREIL)[number] }).where(eq(appareils.id, id));
  await journaliser({ entite: "appareil", entiteId: id, action: "etat_modifie", utilisateurId: user.id, details: `${a!.statut} → ${statut} (bureau)` });
  revalidatePath(retour);
  redirect(avecMessage(retour, "ok", `État : ${LIBELLE_ETAT[statut]} ✓`));
}

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export async function uploadAppareilPhoto(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const appareilId = String(formData.get("appareilId") ?? "");
  if (!appareilId) throw new Error("Appareil invalide.");

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Merci de choisir une photo.");
  }
  if (file.size > PHOTO_MAX_BYTES) {
    throw new Error("La photo dépasse la taille maximale de 8 Mo.");
  }
  const ext = PHOTO_TYPES[file.type];
  if (!ext) {
    throw new Error("Format non supporté — utilisez JPEG, PNG ou WEBP.");
  }

  const [existing] = await db
    .select({ photoUrl: appareils.photoUrl })
    .from(appareils)
    .where(eq(appareils.id, appareilId))
    .limit(1);
  if (!existing) throw new Error("Appareil introuvable.");

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "appareils");
  await mkdir(uploadsDir, { recursive: true });

  const filename = `${appareilId}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadsDir, filename), buffer);

  // Remplacement : on efface l'ancienne photo (une seule photo par appareil).
  if (existing.photoUrl) {
    const oldPath = path.join(process.cwd(), "public", existing.photoUrl.replace(/^\//, ""));
    await unlink(oldPath).catch(() => {});
  }

  await db
    .update(appareils)
    .set({ photoUrl: `/uploads/appareils/${filename}` })
    .where(eq(appareils.id, appareilId));

  revalidatePath(`/responsable/appareils/${appareilId}`);
}

// Phase 29 : nom affiché d'une prestation (description, sinon nom du catalogue).
const NOM_PRESTATION_PAR_ID = sql<string>`coalesce(nullif(${prestations.description}, ''), ${prestationsCatalogue.nom}, 'Prestation')`;

const interventionSchema = z.object({
  // Phase 29 : appareil OU prestation (mission « à la carte »).
  appareilId: z.string().uuid().optional(),
  // Phase 5 : le Projet devient obligatoire pour toute nouvelle intervention
  // (les interventions déjà en base, créées avant, restent avec projetId
  // null et continuent de fonctionner comme avant — voir schema.ts).
  projetId: z.string().uuid("Le projet est obligatoire pour créer une intervention."),
  type: z.enum(["preventive", "corrective", "systematique"]),
  priorite: z.enum(["basse", "normale", "haute", "critique"]),
  description: z.string().optional(),
  technicienId: z.string().uuid().optional(),
  dateProgrammee: z.string().optional(),
});

export async function createIntervention(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const technicienId = formData.get("technicienId");
  // Phase 29 : « Mission pour : un appareil | une prestation ».
  const cible = formData.get("cible") === "prestation" ? "prestation" : "appareil";
  const retourForm = String(formData.get("retour") ?? "");
  const parsed = interventionSchema.safeParse({
    appareilId: cible === "appareil" ? formData.get("appareilId") || undefined : undefined,
    projetId: formData.get("projetId"),
    // Mission « à la carte » : pas de type à choisir (enregistrée comme « systématique »).
    type: cible === "prestation" ? "systematique" : formData.get("type"),
    priorite: formData.get("priorite"),
    description: formData.get("description") || undefined,
    technicienId: technicienId && technicienId !== "" ? technicienId : undefined,
    dateProgrammee: formData.get("dateProgrammee") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");
  const retourProjet = `/responsable/projets/${parsed.data.projetId}?tab=missions`;
  const retourErreur = retourForm.startsWith("/responsable/") ? retourForm : retourProjet;

  const [projetExists] = await db
    .select({ id: projets.id, typeProjet: projets.typeProjet, reference: projets.reference })
    .from(projets)
    .where(eq(projets.id, parsed.data.projetId))
    .limit(1);
  if (!projetExists) throw new Error("Projet introuvable — impossible de créer l'intervention.");

  // Cible : un appareil existant, ou une prestation ponctuelle de CE projet
  // (existante, ou créée ici depuis le catalogue / avec un nom libre).
  let appareilExists: { id: string; numero: string; marque: string | null } | null = null;
  let prestationCible: { id: string; nom: string } | null = null;
  let nouvellePrestation: { catalogueId: string | null; description: string; prix: string | null } | null = null;
  if (cible === "appareil") {
    if (!parsed.data.appareilId) redirect(avecMessage(retourErreur, "erreur", "Choisissez l'appareil de la mission."));
    const [a] = await db
      .select({ id: appareils.id, numero: appareils.numeroInterne, marque: appareils.marque })
      .from(appareils)
      .where(eq(appareils.id, parsed.data.appareilId!))
      .limit(1);
    if (!a) throw new Error("Appareil introuvable — impossible de créer l'intervention.");
    appareilExists = a;
  } else {
    const prestationId = String(formData.get("prestationId") ?? "");
    if (prestationId === "nouvelle") {
      const catalogueId = String(formData.get("nouveauCatalogueId") ?? "");
      const nom = String(formData.get("nouvellePrestationNom") ?? "").trim().slice(0, 200);
      if (catalogueId === "libre" || catalogueId === "") {
        if (!nom) redirect(avecMessage(retourErreur, "erreur", "Indiquez le nom de la prestation (ex. Nettoyage, Démolition…)."));
        nouvellePrestation = { catalogueId: null, description: nom, prix: null };
      } else {
        if (!z.string().uuid().safeParse(catalogueId).success) redirect(avecMessage(retourErreur, "erreur", "Prestation du catalogue invalide."));
        const [c] = await db.select().from(prestationsCatalogue).where(eq(prestationsCatalogue.id, catalogueId)).limit(1);
        if (!c || !c.actif) redirect(avecMessage(retourErreur, "erreur", "Prestation du catalogue introuvable."));
        if (c!.mode === "contrat" || c!.categorie === "vente_piece") {
          redirect(avecMessage(retourErreur, "erreur", "Un contrat ou une vente de pièce ne peut pas être une mission à la carte."));
        }
        nouvellePrestation = { catalogueId: c!.id, description: nom || c!.nom, prix: c!.prixIndicatif };
      }
      prestationCible = { id: "", nom: nouvellePrestation!.description };
    } else {
      if (!z.string().uuid().safeParse(prestationId).success) redirect(avecMessage(retourErreur, "erreur", "Choisissez la prestation de la mission."));
      const [p] = await db
        .select({ id: prestations.id, projetId: prestations.projetId, mode: prestations.mode, nom: NOM_PRESTATION_PAR_ID })
        .from(prestations)
        .leftJoin(prestationsCatalogue, eq(prestations.catalogueId, prestationsCatalogue.id))
        .where(eq(prestations.id, prestationId))
        .limit(1);
      if (!p || p.projetId !== parsed.data.projetId) redirect(avecMessage(retourErreur, "erreur", "Cette prestation n'appartient pas au projet."));
      if (p!.mode === "contrat") redirect(avecMessage(retourErreur, "erreur", "Un contrat à passages se planifie par appareil, pas en mission à la carte."));
      prestationCible = { id: p!.id, nom: p!.nom };
    }
  }

  // Phase 17 : une mission envoyée a toujours un technicien ET une date.
  if (parsed.data.technicienId && !parsed.data.dateProgrammee) {
    throw new Error("Choisissez la date et l'heure de la mission avant de l'envoyer au technicien.");
  }
  // Phase 19 : contrôle de sécurité — habilitations obligatoires en règle.
  if (parsed.data.technicienId) {
    const manques = await controlerHabilitationsSpecs(parsed.data.technicienId, [
      {
        type: parsed.data.type,
        numero: appareilExists?.numero ?? prestationCible!.nom,
        marque: appareilExists?.marque ?? null,
        typeProjet: projetExists.typeProjet ?? null,
      },
    ]);
    if (manques.length) {
      const base = retourForm.startsWith("/responsable/")
        ? retourForm
        : appareilExists
          ? `/responsable/appareils/${appareilExists.id}`
          : retourProjet;
      redirect(avecMessage(base, "erreur", messageManques(await nomUtilisateur(parsed.data.technicienId), manques)));
    }
  }

  // Phase 29 : prestation créée depuis le formulaire de mission.
  if (nouvellePrestation) {
    const [p] = await db
      .insert(prestations)
      .values({
        projetId: parsed.data.projetId,
        catalogueId: nouvellePrestation.catalogueId,
        description: nouvellePrestation.description,
        prixEstime: nouvellePrestation.prix,
      })
      .returning({ id: prestations.id });
    prestationCible = { id: p.id, nom: nouvellePrestation.description };
    await journaliser({
      entite: "prestation",
      entiteId: p.id,
      action: "prestation_ajoutee",
      utilisateurId: user.id,
      details: `${projetExists.reference} — ${nouvellePrestation.description} (depuis une nouvelle mission)`,
    });
  }

  const [creee] = await db.insert(interventions).values({
    appareilId: appareilExists?.id ?? null,
    prestationId: appareilExists ? null : prestationCible!.id,
    projetId: parsed.data.projetId,
    type: parsed.data.type,
    priorite: parsed.data.priorite,
    description: parsed.data.description ?? null,
    technicienId: parsed.data.technicienId ?? null,
    statut: parsed.data.technicienId ? "affectee" : "creee",
    dateProgrammee: parsed.data.dateProgrammee ? new Date(parsed.data.dateProgrammee) : null,
  }).returning({ id: interventions.id });

  // Phase 23 : checklists choisies (ou la plus adaptée si aucune case cochée).
  // Phase 29 : mission à la carte -> seulement les checklists cochées.
  if (formData.get("sansChecklist") !== "on") {
    const choisies = formData.getAll("checklistIds").map(String).filter((x) => z.string().uuid().safeParse(x).success);
    if (choisies.length) await attribuerChecklists(creee.id, choisies, user.id);
    else if (appareilExists) await attribuerParDefaut(creee.id);
  }

  // Phase 10 : même règle que assignerIntervention — si un technicien est
  // choisi dès la création, l'ordre de mission part immédiatement.
  if (parsed.data.technicienId) {
    await envoyerEtJournaliserOrdreMission({
      projetId: parsed.data.projetId,
      technicienId: parsed.data.technicienId,
      interventionIds: [creee.id],
      envoyeParId: user.id,
    });
  }

  if (appareilExists) revalidatePath(`/responsable/appareils/${appareilExists.id}`);
  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
  revalidatePath("/responsable/interventions");
  // Phase 13 : création depuis l'onglet Missions d'un Projet -> on y revient.
  if (retourForm.startsWith(`/responsable/projets/${parsed.data.projetId}`)) redirect(retourForm);
  redirect(appareilExists ? `/responsable/appareils/${appareilExists.id}` : retourProjet);
}

// Statuts d'intervention à partir desquels on considère le travail engagé :
// changer le technicien affecté à ce stade fausserait l'historique/le
// rapport déjà produit ou en cours, donc on l'interdit (cf. plan validé).
const STATUTS_INTERVENTION_VERROUILLES = new Set(["en_cours", "terminee", "validee", "cloturee"]);

const assignerInterventionSchema = z.object({
  interventionId: z.string().uuid(),
  technicienId: z.string().uuid().optional(),
  dateProgrammee: z.string().optional(),
});

export async function assignerIntervention(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  // Phase 27 : retour sur la page d'origine (planning, vue, jour) avec un message.
  const retour = retourPlanning(formData.get("retour"));
  const technicienId = formData.get("technicienId");
  const parsed = assignerInterventionSchema.safeParse({
    interventionId: formData.get("interventionId"),
    technicienId: technicienId && technicienId !== "" ? technicienId : undefined,
    dateProgrammee: formData.get("dateProgrammee") || undefined,
  });
  if (!parsed.success) redirect(avecMessage(retour, "erreur", parsed.error.issues[0]?.message ?? "Données invalides"));

  const [existing] = await db
    .select({
      statut: interventions.statut,
      technicienId: interventions.technicienId,
      projetId: interventions.projetId,
      dateProgrammee: interventions.dateProgrammee,
    })
    .from(interventions)
    .where(eq(interventions.id, parsed.data.interventionId))
    .limit(1);
  if (!existing) redirect(avecMessage(retour, "erreur", "Mission introuvable."));
  // Phase 19 : contrôle des habilitations obligatoires avant l'envoi.
  if (parsed.data.technicienId && parsed.data.technicienId !== existing.technicienId) {
    const manques = await controlerHabilitations(parsed.data.technicienId, [parsed.data.interventionId]);
    if (manques.length) {
      redirect(avecMessage(retour, "erreur", messageManques(await nomUtilisateur(parsed.data.technicienId), manques)));
    }
  }
  // Phase 17 : pas d'envoi sans date.
  if (parsed.data.technicienId && !parsed.data.dateProgrammee && !existing.dateProgrammee) {
    redirect(avecMessage(retour, "erreur", "Cette mission n'a pas de date : choisissez la date et l'heure avant de l'affecter."));
  }
  if (STATUTS_INTERVENTION_VERROUILLES.has(existing.statut)) {
    redirect(avecMessage(retour, "erreur", "Cette mission est déjà commencée — le technicien ne peut plus être changé."));
  }

  await db
    .update(interventions)
    .set({
      technicienId: parsed.data.technicienId ?? null,
      statut: parsed.data.technicienId ? "affectee" : "creee",
      // Phase 21 : désaffectée -> plus de suivi d'envoi ni de refus en attente.
      ...(parsed.data.technicienId ? {} : REINIT_ENVOI),
      // Phase 16 : une mission reprogrammée pourra de nouveau être signalée en retard.
      ...(parsed.data.dateProgrammee ? { dateProgrammee: new Date(parsed.data.dateProgrammee), retardNotifieLe: null } : {}),
    })
    .where(eq(interventions.id, parsed.data.interventionId));

  // Phase 10 : même comportement que l'affectation depuis la fiche Projet —
  // dès qu'un technicien est affecté (ou changé) ici, l'ordre de mission est
  // envoyé. On ne renvoie pas le mail si le technicien n'a pas changé (évite
  // les doublons si on reclique sur "OK" sans rien modifier), ni si
  // l'intervention n'est rattachée à aucun Projet (pas de contexte à
  // envoyer — cas des anciennes interventions "Sans projet").
  // Phase 17 : on renvoie aussi si la date change (le technicien doit le savoir).
  const dateChangee =
    !!parsed.data.dateProgrammee &&
    new Date(parsed.data.dateProgrammee).getTime() !== (existing.dateProgrammee?.getTime() ?? 0);
  if (
    parsed.data.technicienId &&
    (parsed.data.technicienId !== existing.technicienId || dateChangee) &&
    existing.projetId
  ) {
    await envoyerEtJournaliserOrdreMission({
      projetId: existing.projetId,
      technicienId: parsed.data.technicienId,
      interventionIds: [parsed.data.interventionId],
      envoyeParId: user.id,
    });
  }

  revalidatePath("/", "layout");
  const nom = parsed.data.technicienId ? await nomUtilisateur(parsed.data.technicienId) : null;
  redirect(
    avecMessage(
      retour,
      "ok",
      nom
        ? existing.projetId
          ? `Mission affectée à ${nom} et envoyée (application, téléphone, email).`
          : `Mission affectée à ${nom}.`
        : "Mission remise « à affecter »."
    )
  );
}

function retourPlanning(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/responsable/") && !s.startsWith("//") ? s : "/responsable/interventions";
}

// Phase 27 : « Relancer » depuis le planning — renvoie la mission au même
// technicien (application + téléphone + email) ; nouvel accusé de réception.
export async function relancerMission(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const retour = retourPlanning(formData.get("retour"));
  const id = String(formData.get("interventionId") ?? "");
  if (!z.string().uuid().safeParse(id).success) redirect(avecMessage(retour, "erreur", "Mission introuvable."));
  const [m] = await db
    .select({ statut: interventions.statut, technicienId: interventions.technicienId, projetId: interventions.projetId })
    .from(interventions)
    .where(eq(interventions.id, id))
    .limit(1);
  if (!m || !m.technicienId || !m.projetId) redirect(avecMessage(retour, "erreur", "Cette mission n'a pas de technicien à relancer."));
  if (STATUTS_INTERVENTION_VERROUILLES.has(m.statut)) redirect(avecMessage(retour, "erreur", "Cette mission est déjà commencée."));
  await envoyerEtJournaliserOrdreMission({ projetId: m.projetId, technicienId: m.technicienId, interventionIds: [id], envoyeParId: user.id });
  await journaliser({ utilisateurId: user.id, action: "mission_relancee", entite: "intervention", entiteId: id, details: "Mission relancée depuis le planning" });
  revalidatePath("/", "layout");
  redirect(avecMessage(retour, "ok", `Mission renvoyée à ${await nomUtilisateur(m.technicienId)} (application, téléphone, email).`));
}



const contactSchema = z.object({
  clientId: z.string().uuid(),
  nom: z.string().min(2, "Nom requis"),
  fonction: z.string().optional(),
  telephone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
});

export async function createContact(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = contactSchema.safeParse({
    clientId: formData.get("clientId"),
    nom: formData.get("nom"),
    fonction: formData.get("fonction") || undefined,
    telephone: formData.get("telephone") || undefined,
    email: formData.get("email") || "",
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db.insert(contactsClient).values({
    clientId: parsed.data.clientId,
    nom: parsed.data.nom,
    fonction: parsed.data.fonction ?? null,
    telephone: parsed.data.telephone ?? null,
    email: parsed.data.email ? parsed.data.email : null,
  });

  revalidatePath(`/responsable/clients/${parsed.data.clientId}`);
}

export async function getTechniciens() {
  await requireUser(ROLES_BUREAU);
  return db
    .select({ id: users.id, nom: users.nom })
    .from(users)
    // Phase 13b : les anciens techniciens (compte désactivé) ne sont plus proposés.
    .where(and(eq(users.role, "technicien"), eq(users.actif, 1)))
    .orderBy(users.nom);
}

export async function getClientsForSelect() {
  await requireUser(ROLES_BUREAU);
  return db
    .select({ id: clients.id, raisonSociale: clients.raisonSociale })
    .from(clients)
    .orderBy(clients.raisonSociale);
}

export async function getSitesForSelect() {
  await requireUser(ROLES_BUREAU);
  return db
    .select({ id: sites.id, adresse: sites.adresse, raisonSociale: clients.raisonSociale })
    .from(sites)
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .orderBy(clients.raisonSociale, sites.adresse);
}

// ---------- "Besoin d'aide" (Phase 6) ----------
export async function getDemandesAideOuvertes() {
  await requireUser(ROLES_BUREAU);
  return db
    .select({
      id: demandesAide.id,
      message: demandesAide.message,
      createdAt: demandesAide.createdAt,
      interventionId: demandesAide.interventionId,
      technicienNom: users.nom,
      numeroInterne: appareils.numeroInterne,
    })
    .from(demandesAide)
    .innerJoin(users, eq(demandesAide.technicienId, users.id))
    .innerJoin(interventions, eq(demandesAide.interventionId, interventions.id))
    .leftJoin(appareils, eq(interventions.appareilId, appareils.id))
    .where(eq(demandesAide.resolue, 0))
    .orderBy(desc(demandesAide.createdAt));
}

export async function resoudreDemandeAide(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Demande introuvable.");

  await db
    .update(demandesAide)
    .set({ resolue: 1, resolvedAt: new Date() })
    .where(eq(demandesAide.id, id));

  await journaliser({
    entite: "demande_aide",
    entiteId: id,
    action: "resolue",
    utilisateurId: user.id,
  });

  revalidatePath("/responsable/interventions");
}
