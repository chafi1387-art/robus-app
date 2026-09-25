"use server";

import { z } from "zod";
import { db } from "@/db";
import {
  appareils,
  clients,
  garantieFormules,
  prestations,
  prestationsCatalogue,
  projetAppareils,
  projets,
  projetTechniciens,
  users,
} from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { appliquerGarantie } from "@/lib/projet-garantie";
import { envoyerEtJournaliserOrdreMission } from "../actions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// Assistant « Nouveau projet » (Phase 13) : tout est créé en une fois
// (projet, appareils, équipe, garantie, prestations), puis les ordres de
// mission partent — dans cet ordre pour que l'email contienne tout.

const TYPES_PROJET = ["installation", "maintenance", "modernisation", "reparation"] as const;

const payloadSchema = z.object({
  titre: z.string().trim().min(2, "Donnez un nom au projet."),
  typeProjet: z.enum(TYPES_PROJET).optional(),
  description: z.string().trim().max(2000).optional(),
  dateDebutPrevue: z.string().optional(),
  dateFinPrevue: z.string().optional(),
  adresse: z.string().trim().min(3, "L'adresse d'intervention est obligatoire."),
  instructionsAcces: z.string().trim().optional(),
  contactNom: z.string().trim().optional(),
  contactTelephone: z.string().trim().optional(),
  clientId: z.string().uuid("Choisissez un client."),
  appareilIds: z.array(z.string().uuid()).max(100),
  techniciens: z.array(z.object({ id: z.string().uuid(), role: z.string().trim().max(80).optional() })).max(50),
  envoyerOrdre: z.boolean(),
  formuleId: z.string().uuid().nullable(),
  prestations: z.array(z.object({ catalogueId: z.string().uuid(), quantite: z.number().int().min(1).max(999) })).max(100),
});

export type ResultatCreation = { ok: true; id: string } | { ok: false; erreur: string };

async function genererReference() {
  const annee = new Date().getFullYear();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(projets)
    .where(sql`${projets.reference} like ${`PRJ-${annee}-%`}`);
  return `PRJ-${annee}-${String(Number(n) + 1).padStart(4, "0")}`;
}

const dateOuNull = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T08:00:00`) : null);

export async function creerProjetComplet(payload: unknown): Promise<ResultatCreation> {
  const user = await requireUser(ROLES_BUREAU);
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, erreur: parsed.error.issues[0]?.message ?? "Données invalides." };
  const d = parsed.data;

  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, d.clientId)).limit(1);
  if (!client) return { ok: false, erreur: "Client introuvable." };

  const appareilIds = [...new Set(d.appareilIds)];
  if (appareilIds.length) {
    const ok = await db.select({ id: appareils.id }).from(appareils).where(inArray(appareils.id, appareilIds));
    if (ok.length !== appareilIds.length) return { ok: false, erreur: "Un appareil sélectionné n'existe plus." };
  }
  const techIds = [...new Set(d.techniciens.map((t) => t.id))];
  if (techIds.length) {
    const ok = await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, techIds), eq(users.role, "technicien")));
    if (ok.length !== techIds.length) return { ok: false, erreur: "Un technicien sélectionné n'existe plus." };
  }
  if (d.formuleId) {
    const [f] = await db.select({ id: garantieFormules.id }).from(garantieFormules).where(eq(garantieFormules.id, d.formuleId)).limit(1);
    if (!f) return { ok: false, erreur: "Formule de garantie introuvable." };
  }
  const catIds = [...new Set(d.prestations.map((p) => p.catalogueId))];
  const catalogue = catIds.length
    ? await db.select().from(prestationsCatalogue).where(inArray(prestationsCatalogue.id, catIds))
    : [];
  if (catalogue.length !== catIds.length) return { ok: false, erreur: "Une prestation du catalogue n'existe plus." };
  if (catalogue.some((c) => c.categorie === "vente_piece"))
    return { ok: false, erreur: "Les ventes de pièces s'ajoutent depuis la fiche projet (stock)." };

  let reference = await genererReference();
  let projetId = "";
  for (let essai = 0; essai < 3 && !projetId; essai++) {
    try {
      const [created] = await db
        .insert(projets)
        .values({
          reference,
          clientId: d.clientId,
          titre: d.titre,
          typeProjet: d.typeProjet ?? null,
          description: d.description || null,
          responsableId: user.id,
          dateDebutPrevue: dateOuNull(d.dateDebutPrevue),
          dateFinPrevue: dateOuNull(d.dateFinPrevue),
          adresse: d.adresse,
          instructionsAcces: d.instructionsAcces || null,
          contactNom: d.contactNom || null,
          contactTelephone: d.contactTelephone || null,
        })
        .returning({ id: projets.id });
      projetId = created.id;
    } catch {
      // Référence déjà prise (création simultanée) : on prend la suivante.
      const n = Number(reference.slice(-4)) + 1;
      reference = `${reference.slice(0, -4)}${String(n).padStart(4, "0")}`;
    }
  }
  if (!projetId) return { ok: false, erreur: "Impossible de générer la référence du projet, réessayez." };

  if (appareilIds.length) await db.insert(projetAppareils).values(appareilIds.map((appareilId) => ({ projetId, appareilId })));
  if (d.techniciens.length)
    await db.insert(projetTechniciens).values(
      d.techniciens.filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i).map((t) => ({ projetId, technicienId: t.id, role: t.role || null }))
    );
  if (d.formuleId) await appliquerGarantie(projetId, d.formuleId);
  for (const p of d.prestations) {
    const c = catalogue.find((x) => x.id === p.catalogueId)!;
    const prixUnitaire = c.prixIndicatif != null ? Number(c.prixIndicatif) : null;
    await db.insert(prestations).values({
      projetId,
      catalogueId: c.id,
      description: p.quantite > 1 ? `${c.nom} × ${p.quantite}` : c.nom,
      prixEstime: prixUnitaire != null ? String(prixUnitaire * p.quantite) : null,
    });
  }

  await journaliser({
    entite: "projet",
    entiteId: projetId,
    action: "creation_assistant",
    utilisateurId: user.id,
    details: `${reference} — ${appareilIds.length} appareil(s), ${techIds.length} technicien(s)${d.formuleId ? ", garantie" : ""}, ${d.prestations.length} prestation(s)`,
  });

  if (d.envoyerOrdre) {
    for (const t of techIds) {
      try {
        await envoyerEtJournaliserOrdreMission({ projetId, technicienId: t, envoyeParId: user.id });
      } catch {
        // Un échec d'email ne doit pas annuler le projet déjà créé.
      }
    }
  }

  revalidatePath("/responsable/projets");
  return { ok: true, id: projetId };
}

const clientRapideSchema = z.object({
  raisonSociale: z.string().trim().min(2, "Nom du client trop court."),
  type: z.enum(["copropriete", "entreprise", "particulier", "syndicat", "sous_traitance"]),
});

export async function creerClientRapide(input: unknown) {
  await requireUser(ROLES_BUREAU);
  const parsed = clientRapideSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, erreur: parsed.error.issues[0]?.message ?? "Données invalides." };
  const [c] = await db.insert(clients).values(parsed.data).returning({ id: clients.id, raisonSociale: clients.raisonSociale, type: clients.type });
  revalidatePath("/responsable/clients");
  return { ok: true as const, client: c };
}

const appareilRapideSchema = z.object({
  numeroInterne: z.string().trim().min(1, "Numéro interne requis.").max(40),
  marque: z.string().trim().max(80).optional(),
  modele: z.string().trim().max(80).optional(),
  typeAppareil: z.string().trim().max(80).optional(),
});

export async function creerAppareilRapide(input: unknown) {
  await requireUser(ROLES_BUREAU);
  const parsed = appareilRapideSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, erreur: parsed.error.issues[0]?.message ?? "Données invalides." };
  const [existe] = await db.select({ id: appareils.id }).from(appareils).where(eq(appareils.numeroInterne, parsed.data.numeroInterne)).limit(1);
  if (existe) return { ok: false as const, erreur: "Ce numéro interne existe déjà." };
  const [a] = await db
    .insert(appareils)
    .values({
      numeroInterne: parsed.data.numeroInterne,
      marque: parsed.data.marque || null,
      modele: parsed.data.modele || null,
      typeAppareil: parsed.data.typeAppareil || null,
    })
    .returning({ id: appareils.id, numeroInterne: appareils.numeroInterne, marque: appareils.marque, modele: appareils.modele });
  revalidatePath("/responsable/appareils");
  return { ok: true as const, appareil: a };
}
