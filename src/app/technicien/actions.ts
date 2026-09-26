"use server";

import { z } from "zod";
import { db } from "@/db";
import {
  appareils,
  demandesAide,
  interventions,
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
import { envoyerAlerteAide } from "@/lib/mail";
import { notifierBureau } from "@/lib/push";
import { peutModifierHeureReelle } from "@/lib/rapport-rules";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

  await db
    .update(interventions)
    .set({ statut: "en_cours", dateDebut: new Date() })
    .where(eq(interventions.id, interventionId));

  revalidatePath("/technicien");
  revalidatePath(`/technicien/interventions/${interventionId}`);
  // Pas de redirect() : on reste sur la même page, Next rafraîchit
  // automatiquement les données du Server Component après l'action.
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

// Phase 5 : "un vrai suivi de fin de mission" — au moins une photo est
// obligatoire en plus du commentaire (travauxRealises, déjà obligatoire).
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

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

  const fichiers = formData
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length === 0) {
    throw new Error("Merci d'ajouter au moins une photo pour clôturer la mission.");
  }
  for (const f of fichiers) {
    if (f.size > PHOTO_MAX_BYTES) {
      throw new Error(`La photo "${f.name}" dépasse la taille maximale de 8 Mo.`);
    }
    if (!PHOTO_TYPES[f.type]) {
      throw new Error("Format de photo non supporté — utilisez JPEG, PNG ou WEBP.");
    }
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

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "rapports");
  await mkdir(uploadsDir, { recursive: true });
  const urls: string[] = [];
  for (const f of fichiers) {
    const ext = PHOTO_TYPES[f.type];
    const filename = `${rapport.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
    const buffer = Buffer.from(await f.arrayBuffer());
    await writeFile(path.join(uploadsDir, filename), buffer);
    urls.push(`/uploads/rapports/${filename}`);
  }
  await db.insert(rapportPhotos).values(urls.map((url) => ({ rapportId: rapport.id, url })));

  await db
    .update(interventions)
    .set({ statut: "terminee", dateFin: new Date() })
    .where(eq(interventions.id, parsed.data.interventionId));

  revalidatePath("/technicien");
  revalidatePath(`/technicien/interventions/${parsed.data.interventionId}`);
  redirect(`/technicien`);
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
