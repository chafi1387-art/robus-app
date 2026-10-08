"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, devis, devisDestinataires, devisLignes, sites, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { journaliser } from "@/lib/journal";
import { avecMessage } from "@/lib/url";
import { fichiersRecus } from "@/lib/fichiers";
import {
  creerDevisClient,
  deciderDevis,
  destinatairesPossibles,
  devisPourMission,
  envoyerDevisAuxDestinataires,
  lireDevis,
  planifierTravauxDevis,
} from "@/lib/devis";

const uuid = z.string().uuid();
const page = (id: string, ancre = "") => `/responsable/devis/${id}${ancre}`;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ---------- Création ----------

/** Nouveau devis pour un client (module Devis). */
export async function createDevis(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const clientId = String(formData.get("clientId") ?? "");
  const siteId = String(formData.get("siteId") ?? "") || null;
  if (!uuid.safeParse(clientId).success) redirect(avecMessage("/responsable/devis", "erreur", "Choisissez un client."));
  const [c] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!c) redirect(avecMessage("/responsable/devis", "erreur", "Client introuvable."));
  if (siteId) {
    const [s] = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.id, siteId), eq(sites.clientId, clientId))).limit(1);
    if (!s) redirect(avecMessage("/responsable/devis", "erreur", "Ce site n'appartient pas au client choisi."));
  }
  const titre = String(formData.get("description") ?? "").trim().slice(0, 200) || null;
  const id = await creerDevisClient(clientId, user.id, titre, siteId);
  revalidatePath("/responsable/devis");
  redirect(page(id));
}

/** Depuis la page mission : ouvre (ou crée) le devis de la mission. */
export async function ouvrirDevisMission(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const interventionId = String(formData.get("interventionId") ?? "");
  if (!uuid.safeParse(interventionId).success) redirect("/responsable/interventions");
  let id = "";
  try {
    id = await devisPourMission(interventionId, user.id);
  } catch (e) {
    redirect(avecMessage(`/responsable/missions/${interventionId}#devis`, "erreur", (e as Error).message));
  }
  redirect(page(id));
}

// ---------- Contenu + destinataires (brouillon) ----------

function lireLignes(formData: FormData) {
  const designations = formData.getAll("designation").map((v) => String(v).trim());
  const quantites = formData.getAll("quantite").map((v) => String(v).trim().replace(",", "."));
  const prix = formData.getAll("pu").map((v) => String(v).trim().replace(",", "."));
  const lignes: { designation: string; quantite: string; prixUnitaireHt: string | null }[] = [];
  designations.forEach((d, i) => {
    if (!d) return;
    const q = Number(quantites[i] || "1");
    const pu = prix[i] === "" || prix[i] === undefined ? null : Number(prix[i]);
    if (!Number.isFinite(q) || q <= 0 || q > 100000) throw new Error(`Quantité invalide à la ligne ${i + 1}.`);
    if (pu !== null && (!Number.isFinite(pu) || pu < 0 || pu > 10_000_000)) throw new Error(`Prix invalide à la ligne ${i + 1}.`);
    lignes.push({ designation: d.slice(0, 1000), quantite: String(q), prixUnitaireHt: pu === null ? null : String(Math.round(pu * 100) / 100) });
  });
  if (lignes.length > 100) throw new Error("100 lignes maximum.");
  return lignes;
}

type Dest = { canal: "observateur" | "email"; userId: string | null; email: string | null; nom: string | null; prixVisible: number; peutDecider: number };

async function lireDestinataires(formData: FormData, appareilId: string | null, clientId: string) {
  const possibles = await destinatairesPossibles(appareilId, clientId);
  const choisis: Dest[] = [];
  for (const o of possibles.observateurs) {
    if (formData.get(`obs_${o.userId}`) !== "on") continue;
    choisis.push({ canal: "observateur", userId: o.userId, email: null, nom: o.nom, prixVisible: formData.get(`obsprix_${o.userId}`) === "on" ? 1 : 0, peutDecider: formData.get(`obsdecide_${o.userId}`) === "on" ? 1 : 0 });
  }
  possibles.contacts.forEach((c, i) => {
    if (formData.get(`contact_${i}`) !== "on") return;
    choisis.push({ canal: "email", userId: null, email: c.email.toLowerCase(), nom: c.nom, prixVisible: formData.get(`contactprix_${i}`) === "on" ? 1 : 0, peutDecider: formData.get(`contactdecide_${i}`) === "on" ? 1 : 0 });
  });
  for (let i = 0; i < 3; i++) {
    const email = String(formData.get(`libre_email_${i}`) ?? "").trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL.test(email)) throw new Error(`Adresse email invalide : ${email}`);
    choisis.push({ canal: "email", userId: null, email, nom: String(formData.get(`libre_nom_${i}`) ?? "").trim().slice(0, 150) || null, prixVisible: formData.get(`libreprix_${i}`) === "on" ? 1 : 0, peutDecider: formData.get(`libredecide_${i}`) === "on" ? 1 : 0 });
  }
  // Une même personne / adresse une seule fois.
  return choisis.filter((c, i) => choisis.findIndex((x) => (c.userId && x.userId === c.userId) || (c.email && x.email === c.email)) === i);
}

export async function enregistrerDevis(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("devisId") ?? "");
  if (!uuid.safeParse(id).success) redirect("/responsable/devis");
  const dv = await lireDevis(id);
  if (!dv) redirect("/responsable/devis");
  const d = dv!.d;
  const intention = String(formData.get("intention") ?? "enregistrer");
  const modifiable = d.statut === "a_preparer" || d.statut === "brouillon";
  const retour = page(id);
  if (!modifiable && d.statut !== "envoye") redirect(avecMessage(retour, "erreur", "Ce devis n'est plus modifiable."));

  let message = "Devis enregistré ✓";
  try {
    if (modifiable) {
      const titre = String(formData.get("titre") ?? "").trim().slice(0, 200) || null;
      const texte = String(formData.get("message") ?? "").trim().slice(0, 4000) || null;
      const validite = Math.round(Number(formData.get("validiteJours") ?? 30));
      if (!Number.isFinite(validite) || validite < 1 || validite > 365) throw new Error("Validité : entre 1 et 365 jours.");
      const mode = formData.get("mode") === "document" ? "document" : "lignes";
      let documentUrl = d.documentUrl;
      let documentNom = d.documentNom;
      let montantDoc: string | null = d.mode === "document" ? d.montantHt : null;
      let lignes: ReturnType<typeof lireLignes> = [];
      if (mode === "document") {
        const [doc] = await fichiersRecus(formData, "devis", `devis-${d.numero}`, user.id, "document", 1);
        if (doc) {
          documentUrl = doc.url;
          documentNom = doc.nom;
        }
        const brut = String(formData.get("montantDocument") ?? "").trim().replace(",", ".");
        if (brut) {
          const n = Number(brut);
          if (!Number.isFinite(n) || n < 0) throw new Error("Montant HT invalide.");
          montantDoc = String(Math.round(n * 100) / 100);
        } else montantDoc = null;
      } else {
        lignes = lireLignes(formData);
      }
      const total = lignes.reduce((t, l) => t + (l.prixUnitaireHt === null ? 0 : Number(l.quantite) * Number(l.prixUnitaireHt)), 0);
      await db
        .update(devis)
        .set({
          titre,
          message: texte,
          validiteJours: validite,
          mode,
          documentUrl,
          documentNom,
          // Montant gardé aussi sur le devis (liste des devis).
          montantHt: mode === "document" ? montantDoc : lignes.length ? String(Math.round(total * 100) / 100) : null,
          statut: d.statut === "a_preparer" ? "brouillon" : d.statut,
          creeParId: d.creeParId ?? user.id,
          updatedAt: new Date(),
        })
        .where(eq(devis.id, id));
      if (mode === "lignes") {
        await db.delete(devisLignes).where(eq(devisLignes.devisId, id));
        if (lignes.length) await db.insert(devisLignes).values(lignes.map((l, i) => ({ ...l, devisId: id, ordre: i })));
      }
    }

    // Destinataires pas encore prévenus : remplacés par la sélection actuelle.
    const choisis = await lireDestinataires(formData, d.appareilId, d.clientId);
    const dejaEnvoyes = dv!.destinataires.filter((x) => x.envoyeLe);
    const nouveaux = choisis.filter((c) => !dejaEnvoyes.some((x) => (c.userId && x.userId === c.userId) || (c.email && x.email === c.email)));
    await db.delete(devisDestinataires).where(and(eq(devisDestinataires.devisId, id), isNull(devisDestinataires.envoyeLe)));
    if (nouveaux.length) await db.insert(devisDestinataires).values(nouveaux.map((n) => ({ ...n, devisId: id })));

    if (intention === "envoyer") {
      const relu = await lireDevis(id);
      if (relu!.d.mode === "document" && !relu!.d.documentUrl) throw new Error("Joignez le devis (PDF ou photo) avant de l'envoyer.");
      if (relu!.d.mode === "lignes" && !relu!.lignes.length) throw new Error("Ajoutez au moins une ligne avant d'envoyer.");
      if (!relu!.destinataires.some((x) => !x.envoyeLe)) throw new Error("Choisissez au moins un destinataire.");
      if (!relu!.destinataires.some((x) => x.peutDecider === 1)) throw new Error("Au moins un destinataire doit pouvoir accepter le devis.");
      const n = await envoyerDevisAuxDestinataires(id, user.id);
      if (relu!.d.interventionId) revalidatePath(`/responsable/missions/${relu!.d.interventionId}`);
      message = `Devis envoyé à ${n} destinataire(s) ✓`;
    }
  } catch (e) {
    redirect(avecMessage(retour, "erreur", (e as Error).message));
  }
  revalidatePath(retour);
  redirect(avecMessage(retour, "ok", message));
}

// ---------- Réponse saisie par le bureau (accord par téléphone, papier signé…) ----------

export async function deciderDevisBureau(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("devisId") ?? "");
  if (!uuid.safeParse(id).success) redirect("/responsable/devis");
  const decision = formData.get("decision") === "refuse" ? "refuse" : "accepte";
  const nom = String(formData.get("nom") ?? "").trim();
  if (nom.length < 2) redirect(avecMessage(page(id, "#reponse"), "erreur", "Indiquez qui a donné la réponse."));
  try {
    await deciderDevis({ devisId: id, decision, nom, canal: "bureau", userId: user.id, motif: String(formData.get("motif") ?? "").trim() || null });
  } catch (e) {
    redirect(avecMessage(page(id), "erreur", (e as Error).message));
  }
  revalidatePath(page(id));
  redirect(avecMessage(page(id), "ok", decision === "accepte" ? "Devis accepté ✓ — planifiez les travaux." : "Refus enregistré."));
}

// ---------- Travaux : la mission repart ----------

export async function planifierTravaux(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("devisId") ?? "");
  if (!uuid.safeParse(id).success) redirect("/responsable/devis");
  const technicienId = String(formData.get("technicienId") ?? "");
  const dateTxt = String(formData.get("date") ?? "");
  const date = dateTxt ? new Date(dateTxt) : null;
  if (!uuid.safeParse(technicienId).success) redirect(avecMessage(page(id, "#travaux"), "erreur", "Choisissez le technicien."));
  if (!date || Number.isNaN(date.getTime())) redirect(avecMessage(page(id, "#travaux"), "erreur", "Indiquez la date des travaux."));
  const [t] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, technicienId), eq(users.role, "technicien"), eq(users.actif, 1))).limit(1);
  if (!t) redirect(avecMessage(page(id, "#travaux"), "erreur", "Technicien introuvable."));
  let missionId = "";
  try {
    missionId = await planifierTravauxDevis({ devisId: id, technicienId, date: date!, message: String(formData.get("message") ?? "").trim().slice(0, 1000) || undefined, userId: user.id });
  } catch (e) {
    redirect(avecMessage(page(id, "#travaux"), "erreur", (e as Error).message));
  }
  revalidatePath(page(id));
  revalidatePath(`/responsable/missions/${missionId}`);
  redirect(avecMessage(`/responsable/missions/${missionId}`, "ok", "Travaux planifiés ✓ — la mission repart et le technicien est prévenu."));
}

export async function annulerDevis(formData: FormData) {
  const user = await requireUser(ROLES_BUREAU);
  const id = String(formData.get("devisId") ?? "");
  if (!uuid.safeParse(id).success) redirect("/responsable/devis");
  const [d] = await db.select({ statut: devis.statut, interventionId: devis.interventionId, numero: devis.numero }).from(devis).where(eq(devis.id, id)).limit(1);
  if (!d) redirect("/responsable/devis");
  if (d!.statut === "realise") redirect(avecMessage(page(id), "erreur", "Les travaux sont déjà réalisés."));
  await db.update(devis).set({ statut: "annule", updatedAt: new Date() }).where(eq(devis.id, id));
  await journaliser({ entite: "devis", entiteId: id, action: "annule", utilisateurId: user.id });
  if (d!.interventionId) await journaliser({ entite: "intervention", entiteId: d!.interventionId, action: "devis_annule", utilisateurId: user.id, details: d!.numero });
  revalidatePath(page(id));
  redirect(avecMessage(page(id), "ok", "Devis annulé."));
}
