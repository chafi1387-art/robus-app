"use server";

import { z } from "zod";
import { db } from "@/db";
import {
  appareils,
  clients,
  contactsClient,
  demandesAide,
  interventions,
  projets,
  sites,
  users,
} from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { envoyerEtJournaliserOrdreMission } from "./projets/actions";

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

const appareilSchema = z.object({
  numeroInterne: z.string().min(1, "Numéro interne requis"),
  numeroSerie: z.string().optional(),
  marque: z.string().optional(),
  modele: z.string().optional(),
  typeAppareil: z.string().optional(),
  anneeInstallation: z.coerce.number().int().optional(),
  charge: z.coerce.number().optional(),
  vitesse: z.coerce.number().optional(),
  niveaux: z.coerce.number().int().optional(),
  typePortes: z.string().optional(),
  statut: z.enum(STATUTS_APPAREIL),
});

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
  const parsed = appareilSchema.safeParse(readAppareilForm(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [created] = await db
    .insert(appareils)
    .values({
      ...parsed.data,
      anneeInstallation: parsed.data.anneeInstallation ?? null,
      charge: parsed.data.charge != null ? String(parsed.data.charge) : null,
      vitesse: parsed.data.vitesse != null ? String(parsed.data.vitesse) : null,
      niveaux: parsed.data.niveaux ?? null,
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
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [existing] = await db
    .select({ siteId: appareils.siteId })
    .from(appareils)
    .where(eq(appareils.id, parsed.data.appareilId))
    .limit(1);
  if (!existing) throw new Error("Appareil introuvable.");

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

const interventionSchema = z.object({
  appareilId: z.string().uuid(),
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
  const parsed = interventionSchema.safeParse({
    appareilId: formData.get("appareilId"),
    projetId: formData.get("projetId"),
    type: formData.get("type"),
    priorite: formData.get("priorite"),
    description: formData.get("description") || undefined,
    technicienId: technicienId && technicienId !== "" ? technicienId : undefined,
    dateProgrammee: formData.get("dateProgrammee") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [appareilExists] = await db
    .select({ id: appareils.id })
    .from(appareils)
    .where(eq(appareils.id, parsed.data.appareilId))
    .limit(1);
  if (!appareilExists) throw new Error("Appareil introuvable — impossible de créer l'intervention.");

  const [projetExists] = await db
    .select({ id: projets.id })
    .from(projets)
    .where(eq(projets.id, parsed.data.projetId))
    .limit(1);
  if (!projetExists) throw new Error("Projet introuvable — impossible de créer l'intervention.");

  await db.insert(interventions).values({
    appareilId: parsed.data.appareilId,
    projetId: parsed.data.projetId,
    type: parsed.data.type,
    priorite: parsed.data.priorite,
    description: parsed.data.description ?? null,
    technicienId: parsed.data.technicienId ?? null,
    statut: parsed.data.technicienId ? "affectee" : "creee",
    dateProgrammee: parsed.data.dateProgrammee ? new Date(parsed.data.dateProgrammee) : null,
  });

  // Phase 10 : même règle que assignerIntervention — si un technicien est
  // choisi dès la création, l'ordre de mission part immédiatement.
  if (parsed.data.technicienId) {
    await envoyerEtJournaliserOrdreMission({
      projetId: parsed.data.projetId,
      technicienId: parsed.data.technicienId,
      envoyeParId: user.id,
    });
  }

  revalidatePath(`/responsable/appareils/${parsed.data.appareilId}`);
  revalidatePath(`/responsable/projets/${parsed.data.projetId}`);
  revalidatePath("/responsable/interventions");
  redirect(`/responsable/appareils/${parsed.data.appareilId}`);
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
  const technicienId = formData.get("technicienId");
  const parsed = assignerInterventionSchema.safeParse({
    interventionId: formData.get("interventionId"),
    technicienId: technicienId && technicienId !== "" ? technicienId : undefined,
    dateProgrammee: formData.get("dateProgrammee") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Données invalides");

  const [existing] = await db
    .select({
      statut: interventions.statut,
      technicienId: interventions.technicienId,
      projetId: interventions.projetId,
    })
    .from(interventions)
    .where(eq(interventions.id, parsed.data.interventionId))
    .limit(1);
  if (!existing) throw new Error("Intervention introuvable.");
  if (STATUTS_INTERVENTION_VERROUILLES.has(existing.statut)) {
    throw new Error("Cette intervention est déjà engagée — le technicien ne peut plus être changé.");
  }

  await db
    .update(interventions)
    .set({
      technicienId: parsed.data.technicienId ?? null,
      statut: parsed.data.technicienId ? "affectee" : "creee",
      ...(parsed.data.dateProgrammee ? { dateProgrammee: new Date(parsed.data.dateProgrammee) } : {}),
    })
    .where(eq(interventions.id, parsed.data.interventionId));

  // Phase 10 : même comportement que l'affectation depuis la fiche Projet —
  // dès qu'un technicien est affecté (ou changé) ici, l'ordre de mission est
  // envoyé. On ne renvoie pas le mail si le technicien n'a pas changé (évite
  // les doublons si on reclique sur "OK" sans rien modifier), ni si
  // l'intervention n'est rattachée à aucun Projet (pas de contexte à
  // envoyer — cas des anciennes interventions "Sans projet").
  if (
    parsed.data.technicienId &&
    parsed.data.technicienId !== existing.technicienId &&
    existing.projetId
  ) {
    await envoyerEtJournaliserOrdreMission({
      projetId: existing.projetId,
      technicienId: parsed.data.technicienId,
      envoyeParId: user.id,
    });
  }

  revalidatePath("/responsable/interventions");
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
    .where(eq(users.role, "technicien"));
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
