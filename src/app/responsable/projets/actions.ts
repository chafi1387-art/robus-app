"use server";

import { z } from "zod";
import { db } from "@/db";
import {
  appareils,
  clients,
  documentsFormations,
  garantieFormules,
  garanties,
  habilitationsTechnicien,
  mouvementsStock,
  ordresMissionEnvois,
  pieces,
  prestations,
  prestationsCatalogue,
  projetAppareils,
  projets,
  projetTechniciens,
  users,
} from "@/db/schema";
import { requireUser, Role, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { envoyerOrdreDeMission } from "@/lib/mail";
import { appliquerGarantie } from "@/lib/projet-garantie";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";

// Statuts à partir desquels le Projet est considéré engagé : on ne remonte
// jamais en arrière (même logique que STATUTS_INTERVENTION_VERROUILLES).
const ORDRE_STATUTS_PROJET = ["cree", "planifie", "en_cours", "termine", "valide_iso"] as const;

async function genererReference() {
  const annee = new Date().getFullYear();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(projets)
    .where(sql`extract(year from ${projets.createdAt}) = ${annee}`);
  const seq = Number(n) + 1;
  return `PRJ-${annee}-${String(seq).padStart(4, "0")}`;
}

const createProjetSchema = z.object({
  clientId: z.string().uuid(),
  titre: z.string().min(2, "Titre requis"),
  description: z.string().optional(),
  dateDebutPrevue: z.string().optional(),
  dateFinPrevue: z.string().optional(),
  // Phase 6 : l'Appareil n'étant plus rattaché à un Site, l'adresse
  // d'intervention est désormais obligatoirement portée par le Projet.
  adresse: z.string().min(1, "Adresse requise"),
  instructionsAcces: z.string().optional(),
  contactNom: z.string().optional(),
  contactTelephone: z.string().optional(),
});

export async function createProjet(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = createProjetSchema.safeParse({
    clientId: formData.get("clientId"),
    titre: formData.get("titre"),
    description: formData.get("description") || undefined,
    dateDebutPrevue: formData.get("dateDebutPrevue") || undefined,
    dateFinPrevue: formData.get("dateFinPrevue") || undefined,
    adresse: formData.get("adresse"),
    instructionsAcces: formData.get("instructionsAcces") || undefined,
    contactNom: formData.get("contactNom") || undefined,
    contactTelephone: formData.get("contactTelephone") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [clientExists] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, parsed.data.clientId))
    .limit(1);
  if (!clientExists) throw new Error("Client introuvable — impossible de créer le projet.");

  const reference = await genererReference();

  const [created] = await db
    .insert(projets)
    .values({
      reference,
      clientId: parsed.data.clientId,
      titre: parsed.data.titre,
      description: parsed.data.description ?? null,
      responsableId: user.id,
      dateDebutPrevue: parsed.data.dateDebutPrevue ? new Date(parsed.data.dateDebutPrevue) : null,
      dateFinPrevue: parsed.data.dateFinPrevue ? new Date(parsed.data.dateFinPrevue) : null,
      adresse: parsed.data.adresse,
      instructionsAcces: parsed.data.instructionsAcces ?? null,
      contactNom: parsed.data.contactNom ?? null,
      contactTelephone: parsed.data.contactTelephone ?? null,
    })
    .returning();

  revalidatePath("/responsable/projets");
  redirect(`/responsable/projets/${created.id}`);
}

const updateProjetInfosSchema = z.object({
  projetId: z.string().uuid(),
  adresse: z.string().min(1, "Adresse requise"),
  instructionsAcces: z.string().optional(),
  contactNom: z.string().optional(),
  contactTelephone: z.string().optional(),
});

// Phase 6 : édition des informations propres au Projet (adresse, accès,
// contact sur place) après sa création — n'existait pas jusqu'ici.
export async function updateProjetInfos(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = updateProjetInfosSchema.safeParse({
    projetId: formData.get("projetId"),
    adresse: formData.get("adresse"),
    instructionsAcces: formData.get("instructionsAcces") || undefined,
    contactNom: formData.get("contactNom") || undefined,
    contactTelephone: formData.get("contactTelephone") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db
    .update(projets)
    .set({
      adresse: parsed.data.adresse,
      instructionsAcces: parsed.data.instructionsAcces ?? null,
      contactNom: parsed.data.contactNom ?? null,
      contactTelephone: parsed.data.contactTelephone ?? null,
    })
    .where(eq(projets.id, parsed.data.projetId));

  await journaliser({
    entite: "projet",
    entiteId: parsed.data.projetId,
    action: "modification_infos",
    utilisateurId: user.id,
  });

  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
}

const ajouterAppareilSchema = z.object({
  projetId: z.string().uuid(),
  appareilId: z.string().uuid(),
});

export async function ajouterAppareilProjet(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = ajouterAppareilSchema.safeParse({
    projetId: formData.get("projetId"),
    appareilId: formData.get("appareilId"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [appareilExists] = await db
    .select({ id: appareils.id })
    .from(appareils)
    .where(eq(appareils.id, parsed.data.appareilId))
    .limit(1);
  if (!appareilExists) throw new Error("Appareil introuvable.");

  const [dejaLie] = await db
    .select({ id: projetAppareils.id })
    .from(projetAppareils)
    .where(
      and(
        eq(projetAppareils.projetId, parsed.data.projetId),
        eq(projetAppareils.appareilId, parsed.data.appareilId)
      )
    )
    .limit(1);
  if (dejaLie) throw new Error("Cet appareil est déjà attaché à ce projet.");

  await db.insert(projetAppareils).values(parsed.data);
  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
}

const ajouterTechnicienSchema = z.object({
  projetId: z.string().uuid(),
  technicienId: z.string().uuid(),
  role: z.string().optional(),
  message: z.string().optional(),
});

// Phase 7 : logique commune à l'affectation initiale (ajouterTechnicienProjet)
// et au renvoi manuel d'un ordre de mission (envoyerOrdreMissionAvecMessage) —
// rassemble le contexte du Projet, résout les documents à joindre, envoie
// l'email puis journalise l'envoi dans ordresMissionEnvois (historique
// consultable depuis la fiche Projet).
// Phase 10 : exportée pour être réutilisée par l'affectation rapide d'un
// technicien depuis la liste des Interventions (assignerIntervention dans
// responsable/actions.ts) — même comportement partout où on affecte un
// technicien à une intervention rattachée à un Projet.
export async function envoyerEtJournaliserOrdreMission(params: {
  projetId: string;
  technicienId: string;
  message?: string;
  documentsIds?: string[];
  envoyeParId: string;
}) {
  // Phase 13 : fonction exportée d'un fichier "use server" = appelable
  // directement depuis le navigateur -> on vérifie la session ici aussi.
  await requireUser(ROLES_BUREAU);
  // Phase 6 : l'adresse d'intervention est désormais celle portée par le
  // Projet lui-même (l'Appareil n'étant plus nécessairement rattaché à un
  // Site).
  const [contexte] = await db
    .select({
      reference: projets.reference,
      titre: projets.titre,
      dateDebutPrevue: projets.dateDebutPrevue,
      adresse: projets.adresse,
      clientNom: clients.raisonSociale,
    })
    .from(projets)
    .innerJoin(clients, eq(projets.clientId, clients.id))
    .where(eq(projets.id, params.projetId))
    .limit(1);

  const [technicien] = await db
    .select({ nom: users.nom, email: users.email })
    .from(users)
    .where(eq(users.id, params.technicienId))
    .limit(1);

  const [appareilsAttaches, prestationsAttachees] = await Promise.all([
    db
      .select({ numeroInterne: appareils.numeroInterne })
      .from(projetAppareils)
      .innerJoin(appareils, eq(projetAppareils.appareilId, appareils.id))
      .where(eq(projetAppareils.projetId, params.projetId)),
    db
      .select({ type: prestations.type, description: prestations.description })
      .from(prestations)
      .where(eq(prestations.projetId, params.projetId)),
  ]);

  const documentsIdsDemandes = [...new Set((params.documentsIds ?? []).filter(Boolean))];
  let documentsResolus: { id: string; titre: string; urlFichier: string }[] = [];
  if (documentsIdsDemandes.length > 0) {
    const rows = await db
      .select({
        id: documentsFormations.id,
        titre: documentsFormations.titre,
        urlFichier: documentsFormations.urlFichier,
      })
      .from(documentsFormations)
      .where(inArray(documentsFormations.id, documentsIdsDemandes));
    documentsResolus = rows
      .filter((d): d is { id: string; titre: string; urlFichier: string } => !!d.urlFichier)
      .map((d) => ({ id: d.id, titre: d.titre, urlFichier: d.urlFichier as string }));
  }

  if (contexte && technicien) {
    await envoyerOrdreDeMission({
      projetId: params.projetId,
      destinataireEmail: technicien.email,
      destinataireNom: technicien.nom,
      projetReference: contexte.reference,
      projetTitre: contexte.titre,
      clientNom: contexte.clientNom,
      adresses: contexte.adresse ? [contexte.adresse] : [],
      appareils: appareilsAttaches.map((a) => a.numeroInterne),
      prestations: prestationsAttachees.map((p) => p.description || p.type || "Prestation"),
      dateDebutPrevue: contexte.dateDebutPrevue,
      message: params.message,
      documents: documentsResolus.map((d) => ({ titre: d.titre, url: d.urlFichier })),
    });
  }

  await db.insert(ordresMissionEnvois).values({
    projetId: params.projetId,
    technicienId: params.technicienId,
    message: params.message?.trim() ? params.message.trim() : null,
    documentsJointIds: documentsResolus.map((d) => d.id),
    envoyeParId: params.envoyeParId,
  });
}

export async function ajouterTechnicienProjet(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = ajouterTechnicienSchema.safeParse({
    projetId: formData.get("projetId"),
    technicienId: formData.get("technicienId"),
    role: formData.get("role") || undefined,
    message: formData.get("message") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const documentsIds = formData
    .getAll("documentsIds")
    .map((v) => String(v))
    .filter((v) => v.length > 0);

  const [dejaLie] = await db
    .select({ id: projetTechniciens.id })
    .from(projetTechniciens)
    .where(
      and(
        eq(projetTechniciens.projetId, parsed.data.projetId),
        eq(projetTechniciens.technicienId, parsed.data.technicienId)
      )
    )
    .limit(1);
  if (dejaLie) throw new Error("Ce technicien est déjà affecté à ce projet.");

  await db.insert(projetTechniciens).values({
    projetId: parsed.data.projetId,
    technicienId: parsed.data.technicienId,
    role: parsed.data.role,
  });

  await envoyerEtJournaliserOrdreMission({
    projetId: parsed.data.projetId,
    technicienId: parsed.data.technicienId,
    message: parsed.data.message,
    documentsIds,
    envoyeParId: user.id,
  });

  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
}

const envoyerOrdreMissionSchema = z.object({
  projetId: z.string().uuid(),
  technicienId: z.string().uuid(),
  message: z.string().optional(),
});

// Phase 7 : renvoi manuel d'un ordre de mission (avec message libre et/ou
// documents joints) à un technicien déjà affecté au Projet — bouton
// "Renvoyer un message" sur la fiche Projet.
export async function envoyerOrdreMissionAvecMessage(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = envoyerOrdreMissionSchema.safeParse({
    projetId: formData.get("projetId"),
    technicienId: formData.get("technicienId"),
    message: formData.get("message") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const documentsIds = formData
    .getAll("documentsIds")
    .map((v) => String(v))
    .filter((v) => v.length > 0);

  const [dejaLie] = await db
    .select({ id: projetTechniciens.id })
    .from(projetTechniciens)
    .where(
      and(
        eq(projetTechniciens.projetId, parsed.data.projetId),
        eq(projetTechniciens.technicienId, parsed.data.technicienId)
      )
    )
    .limit(1);
  if (!dejaLie) throw new Error("Ce technicien n'est pas affecté à ce projet.");

  await envoyerEtJournaliserOrdreMission({
    projetId: parsed.data.projetId,
    technicienId: parsed.data.technicienId,
    message: parsed.data.message,
    documentsIds,
    envoyeParId: user.id,
  });

  await journaliser({
    entite: "projet",
    entiteId: parsed.data.projetId,
    action: "ordre_mission_renvoye",
    utilisateurId: user.id,
    details: `Renvoyé à un technicien${parsed.data.message ? " avec message" : ""}`,
  });

  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
}

const retirerTechnicienSchema = z.object({
  projetId: z.string().uuid(),
  technicienId: z.string().uuid(),
});

export async function retirerTechnicienProjet(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = retirerTechnicienSchema.safeParse({
    projetId: formData.get("projetId"),
    technicienId: formData.get("technicienId"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db
    .delete(projetTechniciens)
    .where(
      and(
        eq(projetTechniciens.projetId, parsed.data.projetId),
        eq(projetTechniciens.technicienId, parsed.data.technicienId)
      )
    );

  await journaliser({
    entite: "projet",
    entiteId: parsed.data.projetId,
    action: "technicien_retire",
    utilisateurId: user.id,
  });

  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
}

const modifierRoleTechnicienSchema = z.object({
  projetId: z.string().uuid(),
  technicienId: z.string().uuid(),
  role: z.string().optional(),
});

export async function modifierRoleTechnicienProjet(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = modifierRoleTechnicienSchema.safeParse({
    projetId: formData.get("projetId"),
    technicienId: formData.get("technicienId"),
    role: formData.get("role") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db
    .update(projetTechniciens)
    .set({ role: parsed.data.role ?? null })
    .where(
      and(
        eq(projetTechniciens.projetId, parsed.data.projetId),
        eq(projetTechniciens.technicienId, parsed.data.technicienId)
      )
    );

  await journaliser({
    entite: "projet",
    entiteId: parsed.data.projetId,
    action: "technicien_role_modifie",
    utilisateurId: user.id,
    details: parsed.data.role ? `Nouveau rôle : ${parsed.data.role}` : "Rôle effacé",
  });

  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
}

// Phase 6 : la prestation instanciée sur un Projet est désormais pilotée par
// le catalogue (prestationsCatalogue) plutôt qu'un simple type texte libre.
const createPrestationSchema = z.object({
  projetId: z.string().uuid(),
  catalogueId: z.string().uuid("Merci de choisir une prestation du catalogue."),
  description: z.string().optional(),
  prixEstime: z.coerce.number().optional(),
  pieceId: z.string().uuid().optional(),
  quantitePieces: z.coerce.number().int().positive().optional(),
});

export async function createPrestation(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const pieceIdRaw = formData.get("pieceId");
  const parsed = createPrestationSchema.safeParse({
    projetId: formData.get("projetId"),
    catalogueId: formData.get("catalogueId"),
    description: formData.get("description") || undefined,
    prixEstime: formData.get("prixEstime") || undefined,
    pieceId: pieceIdRaw && pieceIdRaw !== "" ? pieceIdRaw : undefined,
    quantitePieces: formData.get("quantitePieces") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [catalogue] = await db
    .select()
    .from(prestationsCatalogue)
    .where(eq(prestationsCatalogue.id, parsed.data.catalogueId))
    .limit(1);
  if (!catalogue) throw new Error("Prestation du catalogue introuvable.");

  const [projet] = await db
    .select({ reference: projets.reference })
    .from(projets)
    .where(eq(projets.id, parsed.data.projetId))
    .limit(1);
  if (!projet) throw new Error("Projet introuvable.");

  if (catalogue.categorie === "vente_piece") {
    if (!parsed.data.pieceId || !parsed.data.quantitePieces) {
      throw new Error("Merci de choisir une pièce et une quantité pour une vente de pièce.");
    }

    const [piece] = await db
      .select({ id: pieces.id, quantiteStock: pieces.quantiteStock })
      .from(pieces)
      .where(eq(pieces.id, parsed.data.pieceId))
      .limit(1);
    if (!piece) throw new Error("Pièce introuvable.");
    if (parsed.data.quantitePieces > piece.quantiteStock) {
      throw new Error(
        `Stock insuffisant : il ne reste que ${piece.quantiteStock} unité(s) en stock pour cette pièce.`
      );
    }

    await db
      .update(pieces)
      .set({ quantiteStock: piece.quantiteStock - parsed.data.quantitePieces })
      .where(eq(pieces.id, piece.id));

    await db.insert(mouvementsStock).values({
      pieceId: piece.id,
      type: "sortie",
      quantite: parsed.data.quantitePieces,
      projetId: parsed.data.projetId,
      interventionId: null,
      effectueParId: user.id,
      commentaire: `Vente de pièce — Projet ${projet.reference}`,
    });
  }

  await db.insert(prestations).values({
    projetId: parsed.data.projetId,
    catalogueId: catalogue.id,
    pieceId: parsed.data.pieceId ?? null,
    description: parsed.data.description || catalogue.nom,
    quantitePieces: parsed.data.quantitePieces ?? null,
    prixEstime:
      parsed.data.prixEstime != null
        ? String(parsed.data.prixEstime)
        : catalogue.prixIndicatif,
  });

  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
  revalidatePath("/responsable/stock");
}

const choisirGarantieSchema = z.object({
  projetId: z.string().uuid(),
  formuleId: z.string().uuid(),
});

export async function choisirGarantieProjet(formData: FormData) {
  await requireUser(ROLES_BUREAU);
  const parsed = choisirGarantieSchema.safeParse({
    projetId: formData.get("projetId"),
    formuleId: formData.get("formuleId"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [dejaGarantie] = await db
    .select({ id: garanties.id })
    .from(garanties)
    .where(eq(garanties.projetId, parsed.data.projetId))
    .limit(1);
  if (dejaGarantie) throw new Error("Ce projet a déjà une garantie.");

  await appliquerGarantie(parsed.data.projetId, parsed.data.formuleId);

  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
}

const activerExtensionSchema = z.object({
  projetId: z.string().uuid(),
  garantieId: z.string().uuid(),
});

export async function activerExtensionGarantie(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = activerExtensionSchema.safeParse({
    projetId: formData.get("projetId"),
    garantieId: formData.get("garantieId"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  await db
    .update(garanties)
    .set({ extensionActivee: 1, dateExtensionAppliquee: new Date() })
    .where(eq(garanties.id, parsed.data.garantieId));

  await journaliser({
    entite: "garantie",
    entiteId: parsed.data.garantieId,
    action: "extension_activee",
    utilisateurId: user.id,
  });

  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
}

const avancerStatutSchema = z.object({
  projetId: z.string().uuid(),
  nouveauStatut: z.enum(ORDRE_STATUTS_PROJET),
});

export async function avancerStatutProjet(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = avancerStatutSchema.safeParse({
    projetId: formData.get("projetId"),
    nouveauStatut: formData.get("nouveauStatut"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [existing] = await db
    .select({ statut: projets.statut })
    .from(projets)
    .where(eq(projets.id, parsed.data.projetId))
    .limit(1);
  if (!existing) throw new Error("Projet introuvable.");

  const indexActuel = ORDRE_STATUTS_PROJET.indexOf(existing.statut);
  const indexNouveau = ORDRE_STATUTS_PROJET.indexOf(parsed.data.nouveauStatut);
  if (indexNouveau !== indexActuel + 1) {
    throw new Error("Les étapes du suivi ISO doivent être validées dans l'ordre, une par une.");
  }

  await db
    .update(projets)
    .set({ statut: parsed.data.nouveauStatut })
    .where(eq(projets.id, parsed.data.projetId));

  await journaliser({
    entite: "projet",
    entiteId: parsed.data.projetId,
    action: "changement_statut",
    utilisateurId: user.id,
    details: `${existing.statut} → ${parsed.data.nouveauStatut}`,
  });

  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
}

const ROLES_ADMIN_ONLY: Role[] = ["administrateur"];

const changerStatutAdminSchema = z.object({
  projetId: z.string().uuid(),
  nouveauStatut: z.enum(ORDRE_STATUTS_PROJET),
});

// Phase 6 : l'Administrateur peut, lui, faire des allers-retours libres entre
// les 5 statuts (choix explicite du client — pas de champ de confirmation ni
// de motif requis). Les autres rôles bureau restent limités à
// avancerStatutProjet (une étape à la fois, jamais en arrière).
export async function changerStatutProjetAdmin(formData: FormData) {
  const admin = await requireUser(ROLES_ADMIN_ONLY);
  const parsed = changerStatutAdminSchema.safeParse({
    projetId: formData.get("projetId"),
    nouveauStatut: formData.get("nouveauStatut"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [existing] = await db
    .select({ statut: projets.statut })
    .from(projets)
    .where(eq(projets.id, parsed.data.projetId))
    .limit(1);
  if (!existing) throw new Error("Projet introuvable.");

  await db
    .update(projets)
    .set({ statut: parsed.data.nouveauStatut })
    .where(eq(projets.id, parsed.data.projetId));

  await journaliser({
    entite: "projet",
    entiteId: parsed.data.projetId,
    action: "changement_statut",
    utilisateurId: admin.id,
    details: `${existing.statut} -> ${parsed.data.nouveauStatut}`,
  });

  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
}

const supprimerDocumentSchema = z.object({
  documentId: z.string().uuid(),
  projetId: z.string().uuid(),
});

// Suppression d'un document depuis la fiche Projet : uniquement la ligne en
// base, jamais le fichier sous public/uploads (règle du projet — on ne touche
// jamais aux fichiers déjà déposés). Bloquée si une habilitation technicien
// référence ce document (contrainte FK onDelete: "restrict" sur
// habilitationsTechnicien.documentId — voir src/db/schema.ts) : on vérifie
// nous-mêmes en amont pour renvoyer un message clair plutôt que de laisser
// remonter une erreur SQL brute.
export async function supprimerDocument(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = supprimerDocumentSchema.safeParse({
    documentId: formData.get("documentId"),
    projetId: formData.get("projetId"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [document] = await db
    .select({ id: documentsFormations.id })
    .from(documentsFormations)
    .where(eq(documentsFormations.id, parsed.data.documentId))
    .limit(1);
  if (!document) throw new Error("Document introuvable.");

  const [habilitation] = await db
    .select({ id: habilitationsTechnicien.id })
    .from(habilitationsTechnicien)
    .where(eq(habilitationsTechnicien.documentId, parsed.data.documentId))
    .limit(1);
  if (habilitation) {
    throw new Error(
      "Impossible de supprimer ce document : il est utilisé par une habilitation technicien."
    );
  }

  await db.delete(documentsFormations).where(eq(documentsFormations.id, parsed.data.documentId));

  await journaliser({
    entite: "document",
    entiteId: parsed.data.documentId,
    action: "suppression",
    utilisateurId: user.id,
  });

  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
  revalidatePath("/responsable/documents");
}

export async function getProjetsForSelect() {
  await requireUser(ROLES_BUREAU);
  return db
    .select({ id: projets.id, reference: projets.reference, titre: projets.titre })
    .from(projets)
    .orderBy(projets.reference);
}

// Projets contenant un appareil donné — utilisé pour exiger un Projet lors
// de la création d'une intervention depuis la fiche appareil.
export async function getProjetsPourAppareil(appareilId: string) {
  await requireUser(ROLES_BUREAU);
  return db
    .select({ id: projets.id, reference: projets.reference, titre: projets.titre })
    .from(projetAppareils)
    .innerJoin(projets, eq(projetAppareils.projetId, projets.id))
    .where(eq(projetAppareils.appareilId, appareilId))
    .orderBy(projets.reference);
}

export async function getGarantieFormulesActives() {
  await requireUser(ROLES_BUREAU);
  return db
    .select()
    .from(garantieFormules)
    .where(eq(garantieFormules.actif, 1))
    .orderBy(garantieFormules.nom);
}

export async function getPrestationsCatalogueActives() {
  await requireUser(ROLES_BUREAU);
  return db
    .select()
    .from(prestationsCatalogue)
    .where(eq(prestationsCatalogue.actif, 1))
    .orderBy(prestationsCatalogue.categorie, prestationsCatalogue.nom);
}

export async function getPiecesForSelect() {
  await requireUser(ROLES_BUREAU);
  return db
    .select({
      id: pieces.id,
      reference: pieces.reference,
      nom: pieces.nom,
      quantiteStock: pieces.quantiteStock,
      unite: pieces.unite,
    })
    .from(pieces)
    .orderBy(pieces.nom);
}
