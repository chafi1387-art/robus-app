import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { after } from "next/server";
import { and, asc, desc, eq, inArray, isNull, like, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appareils,
  clients,
  contactsClient,
  devis,
  devisDestinataires,
  devisLignes,
  interventions,
  missionPassages,
  observateurAppareils,
  observateurs,
  projets,
  rapportPhotos,
  rapports,
  users,
} from "@/db/schema";
import { journaliser } from "@/lib/journal";
import { envoyerAvisObservateur } from "@/lib/mail";
import { notifierBureau, notifierUtilisateurs } from "@/lib/push";
import { destinatairesAlertes } from "@/lib/demandes";
import { REINIT_ENVOI } from "@/lib/missions";
import { envoyerMissionsAuTechnicien } from "@/lib/envoi-mission";
import { controlerHabilitations, messageManques, nomUtilisateur } from "@/lib/habilitations";

// ==========================================================================
// Phase 25b — Devis dans la mission (5 étapes, la mission continue).
//   1. Besoin   : le technicien coche « Un devis est nécessaire » (ou le bureau).
//   2. Devis    : le bureau saisit les lignes OU joint un devis déjà prêt (PDF).
//   3. Envoi    : par email et/ou dans l'espace observateur — pour chacun :
//                 prix visible ou non, peut accepter ou seulement informé.
//   4. Réponse  : accepté / refusé (espace, lien email, ou saisi par le bureau).
//   5. Travaux  : la MÊME mission repart (2e passage) avec le technicien choisi ;
//                 à la fin de la mission, le devis passe « Réalisé ».
// Montants hors taxes uniquement (la facturation se fait dans Odoo).
// ==========================================================================

export const STATUTS_DEVIS: Record<string, { label: string; ton: "ok" | "warn" | "crit" | "neutral" }> = {
  a_preparer: { label: "À préparer", ton: "warn" },
  brouillon: { label: "Brouillon", ton: "neutral" },
  envoye: { label: "Envoyé — en attente de réponse", ton: "warn" },
  accepte: { label: "Accepté", ton: "ok" },
  refuse: { label: "Refusé", ton: "crit" },
  realise: { label: "Travaux réalisés", ton: "ok" },
  annule: { label: "Annulé", ton: "neutral" },
};

export const ETAPES_DEVIS = ["Besoin", "Devis", "Envoyé", "Réponse", "Travaux"] as const;
export function etapeDevis(d: { statut: string; travauxPlanifiesLe: Date | null }) {
  switch (d.statut) {
    case "a_preparer":
      return 0;
    case "brouillon":
      return 1;
    case "envoye":
      return 2;
    case "accepte":
      return d.travauxPlanifiesLe ? 4 : 3;
    case "refuse":
      return 3;
    case "realise":
      return 5;
    default:
      return 1;
  }
}

export function montant(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT`;
}

export function totalLignes(lignes: { quantite: string | number; prixUnitaireHt: string | number | null }[]) {
  let total = 0;
  let complet = true;
  for (const l of lignes) {
    if (l.prixUnitaireHt === null || l.prixUnitaireHt === "") {
      complet = false;
      continue;
    }
    total += Number(l.quantite) * Number(l.prixUnitaireHt);
  }
  return { total: Math.round(total * 100) / 100, complet };
}

export function hashJeton(jeton: string) {
  return createHash("sha256").update(jeton).digest("hex");
}

function lien(chemin: string) {
  return new URL(chemin, process.env.NEXTAUTH_URL || "https://robuswork.tech").toString();
}

async function nouveauNumero() {
  const annee = new Date().getFullYear();
  const [r] = await db
    .select({ max: sql<string | null>`max(${devis.numero})` })
    .from(devis)
    .where(like(devis.numero, `DEV-${annee}-%`));
  const n = r?.max ? Number(r.max.split("-")[2]) || 0 : 0;
  return `DEV-${annee}-${String(n + 1).padStart(4, "0")}`;
}

async function insererAvecNumero(valeurs: Omit<typeof devis.$inferInsert, "numero">) {
  for (let essai = 0; essai < 5; essai++) {
    const numero = await nouveauNumero();
    try {
      const [d] = await db.insert(devis).values({ ...valeurs, numero }).returning({ id: devis.id, numero: devis.numero });
      return d;
    } catch (e) {
      if (essai === 4 || !String((e as Error).message).includes("devis_numero_idx")) throw e;
    }
  }
  throw new Error("Numéro de devis indisponible — réessayez.");
}

async function contexteMission(interventionId: string) {
  const [m] = await db
    .select({ id: interventions.id, appareilId: interventions.appareilId, projetId: interventions.projetId, clientId: projets.clientId, numero: appareils.numeroInterne, siteId: appareils.siteId })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .where(eq(interventions.id, interventionId))
    .limit(1);
  return m ?? null;
}

/** Étape 1 — le technicien signale qu'un devis est nécessaire (rapport de mission). */
export async function signalerBesoinDevis(interventionId: string, besoin: string, userId: string) {
  const m = await contexteMission(interventionId);
  if (!m?.clientId) return null;
  const [deja] = await db
    .select({ id: devis.id })
    .from(devis)
    .where(and(eq(devis.interventionId, interventionId), inArray(devis.statut, ["a_preparer", "brouillon"])))
    .limit(1);
  if (deja) {
    await db.update(devis).set({ besoinTechnicien: besoin, updatedAt: new Date() }).where(eq(devis.id, deja.id));
    return deja.id;
  }
  const d = await insererAvecNumero({
    clientId: m.clientId,
    siteId: m.siteId ?? null,
    interventionId,
    appareilId: m.appareilId,
    projetId: m.projetId,
    statut: "a_preparer",
    titre: `Travaux — ascenseur ${m.numero}`,
    besoinTechnicien: besoin,
    demandeParId: userId,
  });
  await journaliser({ entite: "intervention", entiteId: interventionId, action: "devis_demande", utilisateurId: userId, details: `${d.numero} : ${besoin.slice(0, 200)}` });
  after(() =>
    notifierBureau({ titre: `🧾 Devis à préparer — ${m.numero}`, corps: besoin.slice(0, 140), url: `/responsable/devis/${d.id}`, tag: `devis-${d.id}` })
  );
  return d.id;
}

/** Le bureau ouvre un devis depuis la mission (reprend le devis « à préparer » s'il existe). */
export async function devisPourMission(interventionId: string, userId: string) {
  const [deja] = await db
    .select({ id: devis.id })
    .from(devis)
    .where(and(eq(devis.interventionId, interventionId), inArray(devis.statut, ["a_preparer", "brouillon"])))
    .orderBy(desc(devis.createdAt))
    .limit(1);
  if (deja) return deja.id;
  const m = await contexteMission(interventionId);
  if (!m) throw new Error("Mission introuvable.");
  if (!m.clientId) throw new Error("Mission sans projet / client : impossible de faire un devis.");
  const d = await insererAvecNumero({
    clientId: m.clientId,
    siteId: m.siteId ?? null,
    interventionId,
    appareilId: m.appareilId,
    projetId: m.projetId,
    statut: "brouillon",
    titre: `Travaux — ascenseur ${m.numero}`,
    creeParId: userId,
  });
  await journaliser({ entite: "intervention", entiteId: interventionId, action: "devis_cree", utilisateurId: userId, details: d.numero });
  return d.id;
}

export async function creerDevisClient(clientId: string, userId: string, titre: string | null, siteId: string | null) {
  const d = await insererAvecNumero({ clientId, siteId, statut: "brouillon", titre, creeParId: userId });
  return d.id;
}

export async function lireDevis(id: string) {
  const [row] = await db
    .select({
      d: devis,
      client: clients.raisonSociale,
      numeroAppareil: appareils.numeroInterne,
      projetRef: projets.reference,
      projetTitre: projets.titre,
      adresse: projets.adresse,
      missionStatut: interventions.statut,
      missionTechnicienId: interventions.technicienId,
      missionPassage: interventions.passage,
      missionDateFin: interventions.dateFin,
    })
    .from(devis)
    .innerJoin(clients, eq(devis.clientId, clients.id))
    .leftJoin(appareils, eq(devis.appareilId, appareils.id))
    .leftJoin(projets, eq(devis.projetId, projets.id))
    .leftJoin(interventions, eq(devis.interventionId, interventions.id))
    .where(eq(devis.id, id))
    .limit(1);
  if (!row) return null;
  const [lignes, destinataires] = await Promise.all([
    db.select().from(devisLignes).where(eq(devisLignes.devisId, id)).orderBy(asc(devisLignes.ordre)),
    db.select().from(devisDestinataires).where(eq(devisDestinataires.devisId, id)).orderBy(asc(devisDestinataires.createdAt)),
  ]);
  const { total, complet } = totalLignes(lignes);
  const montantHt = row.d.mode === "document" ? (row.d.montantHt !== null ? Number(row.d.montantHt) : null) : lignes.length ? total : null;
  return { ...row, lignes, destinataires, montantHt, prixComplet: row.d.mode === "document" || complet };
}
export type DevisComplet = NonNullable<Awaited<ReturnType<typeof lireDevis>>>;

export function expire(d: { statut: string; dateEnvoi: Date | null; validiteJours: number }) {
  return d.statut === "envoye" && !!d.dateEnvoi && d.dateEnvoi.getTime() + d.validiteJours * 86400000 < Date.now();
}

/** Destinataires possibles : observateurs de l'appareil + contacts du client (avec email). */
export async function destinatairesPossibles(appareilId: string | null, clientId: string) {
  const [obs, contacts] = await Promise.all([
    appareilId
      ? db
          .select({ userId: users.id, nom: users.nom, email: users.email, modele: observateurs.modele, clientId: observateurs.clientId, droits: observateurs.droits })
          .from(observateurAppareils)
          .innerJoin(observateurs, eq(observateurAppareils.observateurId, observateurs.id))
          .innerJoin(users, eq(observateurs.userId, users.id))
          .where(and(eq(observateurAppareils.appareilId, appareilId), eq(users.actif, 1)))
      : Promise.resolve([]),
    db.select({ nom: contactsClient.nom, email: contactsClient.email, fonction: contactsClient.fonction }).from(contactsClient).where(eq(contactsClient.clientId, clientId)),
  ]);
  return { observateurs: obs, contacts: contacts.filter((c) => !!c.email) as { nom: string; email: string; fonction: string | null }[] };
}

/** Étape 3 — envoi aux destinataires pas encore prévenus. */
export async function envoyerDevisAuxDestinataires(devisId: string, userId: string) {
  const dv = await lireDevis(devisId);
  if (!dv) throw new Error("Devis introuvable.");
  const aEnvoyer = dv.destinataires.filter((x) => !x.envoyeLe);
  const maintenant = new Date();
  const titre = `Devis ${dv.d.numero}${dv.numeroAppareil ? ` — ascenseur ${dv.numeroAppareil}` : ""}`;
  const resultats: { id: string; email: string | null; jeton?: string; userId: string | null; nom: string | null; peutDecider: boolean; prixVisible: boolean }[] = [];
  for (const x of aEnvoyer) {
    let jeton: string | undefined;
    if (x.canal === "email") {
      jeton = randomBytes(24).toString("base64url");
      await db.update(devisDestinataires).set({ jetonHash: hashJeton(jeton), envoyeLe: maintenant }).where(eq(devisDestinataires.id, x.id));
    } else {
      await db.update(devisDestinataires).set({ envoyeLe: maintenant }).where(eq(devisDestinataires.id, x.id));
    }
    resultats.push({ id: x.id, email: x.email, jeton, userId: x.userId, nom: x.nom, peutDecider: x.peutDecider === 1, prixVisible: x.prixVisible === 1 });
  }
  if (dv.d.statut === "a_preparer" || dv.d.statut === "brouillon") {
    await db.update(devis).set({ statut: "envoye", dateEnvoi: maintenant, envoyeParId: userId, updatedAt: maintenant }).where(eq(devis.id, devisId));
  }
  if (dv.d.interventionId) {
    await journaliser({
      entite: "intervention",
      entiteId: dv.d.interventionId,
      action: "devis_envoye",
      utilisateurId: userId,
      details: `${dv.d.numero} → ${aEnvoyer.map((x) => x.nom ?? x.email).join(", ")}`,
    });
  }
  await journaliser({ entite: "devis", entiteId: devisId, action: "envoye", utilisateurId: userId, details: aEnvoyer.map((x) => x.nom ?? x.email).join(", ") });

  // Emails et notifications après la réponse (l'écran du bureau n'attend pas).
  after(async () => {
    for (const r of resultats) {
      const texte = r.peutDecider
        ? `ROBUS vous a envoyé le devis ${dv.d.numero}${dv.d.titre ? ` (${dv.d.titre})` : ""}${r.prixVisible && dv.montantHt !== null ? ` d'un montant de ${montant(dv.montantHt)}` : ""}. Vous pouvez le consulter et l'accepter ou le refuser en ligne.`
        : `Pour information, ROBUS a établi le devis ${dv.d.numero}${dv.d.titre ? ` (${dv.d.titre})` : ""}.`;
      let statutEmail: string | null = null;
      if (r.jeton && r.email) {
        statutEmail = await envoyerAvisObservateur({ email: r.email, nom: r.nom ?? "Madame, Monsieur", titre, texte, lien: lien(`/devis/${r.jeton}`), bouton: "Voir le devis" });
      } else if (r.userId) {
        const [u] = await db.select({ email: users.email, nom: users.nom }).from(users).where(eq(users.id, r.userId)).limit(1);
        await notifierUtilisateurs([r.userId], { titre: `🧾 ${titre}`, corps: r.peutDecider ? "Un devis attend votre réponse." : "Nouveau devis (pour information).", url: `/observateur/devis/${devisId}`, tag: `devis-${devisId}` });
        if (u) statutEmail = await envoyerAvisObservateur({ email: u.email, nom: u.nom, titre, texte, lien: lien(`/observateur/devis/${devisId}`), bouton: "Voir le devis" });
      }
      if (statutEmail) await db.update(devisDestinataires).set({ envoiEmail: statutEmail }).where(eq(devisDestinataires.id, r.id));
    }
  });
  return aEnvoyer.length;
}

/** Étape 4 — réponse (espace observateur, lien email ou saisie du bureau). */
export async function deciderDevis(p: {
  devisId: string;
  decision: "accepte" | "refuse";
  nom: string;
  canal: "espace" | "email" | "bureau";
  userId?: string | null;
  motif?: string | null;
}) {
  const dv = await lireDevis(p.devisId);
  if (!dv) throw new Error("Devis introuvable.");
  if (dv.d.statut !== "envoye") throw new Error(dv.d.statut === "accepte" || dv.d.statut === "refuse" ? "Une réponse a déjà été donnée pour ce devis." : "Ce devis n'attend pas de réponse.");
  if (p.canal !== "bureau" && expire(dv.d)) throw new Error("Ce devis n'est plus valable — contactez ROBUS pour une mise à jour.");
  const maintenant = new Date();
  const res = await db
    .update(devis)
    .set({
      statut: p.decision,
      decideLe: maintenant,
      dateReponse: maintenant,
      decideParNom: p.nom.slice(0, 150),
      decideParId: p.userId ?? null,
      decideCanal: p.canal,
      motifRefus: p.decision === "refuse" ? (p.motif ?? "").slice(0, 2000) || null : null,
      updatedAt: maintenant,
    })
    .where(and(eq(devis.id, p.devisId), eq(devis.statut, "envoye")))
    .returning({ id: devis.id });
  if (!res.length) throw new Error("Une réponse a déjà été donnée pour ce devis.");
  const quoi = p.decision === "accepte" ? "accepté" : "refusé";
  const via = p.canal === "bureau" ? "saisi par le bureau" : p.canal === "email" ? "via le lien email" : "dans l'espace client";
  if (dv.d.interventionId) {
    await journaliser({ entite: "intervention", entiteId: dv.d.interventionId, action: `devis_${p.decision}`, utilisateurId: p.userId ?? null, details: `${dv.d.numero} ${quoi} par ${p.nom} (${via})${p.motif ? ` — ${p.motif}` : ""}` });
  }
  await journaliser({ entite: "devis", entiteId: p.devisId, action: p.decision, utilisateurId: p.userId ?? null, details: `${p.nom} (${via})` });
  if (p.canal !== "bureau") {
    after(async () => {
      const titre = p.decision === "accepte" ? `✅ Devis ${dv.d.numero} accepté — travaux à planifier` : `❌ Devis ${dv.d.numero} refusé`;
      const corps = `${dv.client}${dv.numeroAppareil ? ` · ${dv.numeroAppareil}` : ""} — par ${p.nom}${p.motif ? ` : ${p.motif.slice(0, 100)}` : ""}`;
      await notifierBureau({ titre, corps, url: `/responsable/devis/${p.devisId}`, tag: `devis-${p.devisId}` });
      const emails = await destinatairesAlertes();
      await Promise.all(emails.map((e) => envoyerAvisObservateur({ email: e, nom: "ROBUS", titre, texte: corps, lien: lien(`/responsable/devis/${p.devisId}`), bouton: "Ouvrir le devis" })));
    });
  }
}

/** Marque le devis « vu » par un destinataire (première ouverture). */
export async function marquerDevisVu(destinataireId: string) {
  await db.update(devisDestinataires).set({ vuLe: new Date() }).where(and(eq(devisDestinataires.id, destinataireId), isNull(devisDestinataires.vuLe)));
}

/**
 * Étape 5 — la mission repart pour les travaux (même mission, passage suivant).
 * Le rapport du passage précédent est archivé tel quel (mission_passages).
 */
export async function planifierTravauxDevis(p: { devisId: string; technicienId: string; date: Date; message?: string; userId: string }) {
  const dv = await lireDevis(p.devisId);
  if (!dv) throw new Error("Devis introuvable.");
  if (dv.d.statut !== "accepte") throw new Error("Le devis doit d'abord être accepté.");
  const interventionId = dv.d.interventionId;
  if (!interventionId) throw new Error("Ce devis n'est pas lié à une mission.");
  const [m] = await db.select().from(interventions).where(eq(interventions.id, interventionId)).limit(1);
  if (!m) throw new Error("Mission introuvable.");
  if (!m.projetId) throw new Error("Mission sans projet.");
  if (m.statut === "en_cours") throw new Error("Le technicien est sur place : planifiez les travaux une fois son rapport envoyé.");
  // Mission pas encore commencée : on change simplement le technicien / la date.
  const enCours = ["creee", "planifiee", "affectee"].includes(m.statut);
  const manques = await controlerHabilitations(p.technicienId, [interventionId]);
  if (manques.length) throw new Error(messageManques(await nomUtilisateur(p.technicienId), manques));

  if (!enCours) {
    // Archive du passage terminé (rapport + photos), puis la mission repart.
    const [r] = await db.select().from(rapports).where(eq(rapports.interventionId, interventionId)).limit(1);
    const photos = r ? (await db.select({ url: rapportPhotos.url }).from(rapportPhotos).where(eq(rapportPhotos.rapportId, r.id)).orderBy(asc(rapportPhotos.createdAt))).map((x) => x.url) : [];
    await db.insert(missionPassages).values({
      interventionId,
      numero: m.passage,
      technicienId: m.technicienId,
      dateProgrammee: m.dateProgrammee,
      dateDebut: m.dateDebut,
      dateFin: m.dateFin,
      valideeLe: m.valideeLe,
      valideeParId: m.valideeParId,
      rapport: r
        ? {
            travauxRealises: r.travauxRealises,
            observations: r.observations,
            tempsPasseMinutes: r.tempsPasseMinutes,
            statutFinalAppareil: r.statutFinalAppareil,
            heureReelle: r.heureReelle,
            dateEnvoi: r.dateEnvoi,
            modifieLe: r.modifieLe,
            corrigeBureauLe: r.corrigeBureauLe,
          }
        : null,
      photos,
      motif: `Travaux du devis ${dv.d.numero}`,
    });
    if (r) await db.delete(rapports).where(eq(rapports.id, r.id));
  }
  await db
    .update(interventions)
    .set({
      ...REINIT_ENVOI,
      passage: enCours ? m.passage : m.passage + 1,
      statut: "affectee",
      technicienId: p.technicienId,
      dateProgrammee: p.date,
      dateDebut: enCours ? m.dateDebut : null,
      dateFin: null,
      valideeLe: null,
      valideeParId: null,
      retardNotifieLe: null,
      description: m.description?.includes(dv.d.numero) ? m.description : `${m.description ? `${m.description}\n` : ""}Travaux du devis ${dv.d.numero} accepté${dv.lignes.length ? ` : ${dv.lignes.map((l) => l.designation).join(", ").slice(0, 400)}` : ""}.`,
    })
    .where(eq(interventions.id, interventionId));
  await db.update(devis).set({ travauxPlanifiesLe: new Date(), updatedAt: new Date() }).where(eq(devis.id, p.devisId));
  await envoyerMissionsAuTechnicien({
    projetId: m.projetId,
    technicienId: p.technicienId,
    interventionIds: [interventionId],
    message: p.message || `Travaux du devis ${dv.d.numero} (accepté par le client).`,
    envoyeParId: p.userId,
  });
  await journaliser({
    entite: "intervention",
    entiteId: interventionId,
    action: "devis_travaux_planifies",
    utilisateurId: p.userId,
    details: `${dv.d.numero} — passage ${enCours ? m.passage : m.passage + 1} confié à ${await nomUtilisateur(p.technicienId)}`,
  });
  return interventionId;
}

/** Fin de mission : les devis acceptés dont les travaux étaient planifiés passent « Réalisés ». */
export async function devisMissionTerminee(interventionId: string) {
  try {
    await db
      .update(devis)
      .set({ statut: "realise", realiseLe: new Date(), updatedAt: new Date() })
      .where(and(eq(devis.interventionId, interventionId), eq(devis.statut, "accepte"), sql`${devis.travauxPlanifiesLe} is not null`));
  } catch (e) {
    console.error("Devis réalisé", e);
  }
}

/** Devis d'une mission (page mission, technicien, observateur). */
export async function devisDeMission(interventionId: string) {
  return db
    .select({ id: devis.id, numero: devis.numero, statut: devis.statut, titre: devis.titre, besoinTechnicien: devis.besoinTechnicien, dateEnvoi: devis.dateEnvoi, decideLe: devis.decideLe, decideParNom: devis.decideParNom, travauxPlanifiesLe: devis.travauxPlanifiesLe, realiseLe: devis.realiseLe, createdAt: devis.createdAt, motifRefus: devis.motifRefus })
    .from(devis)
    .where(eq(devis.interventionId, interventionId))
    .orderBy(asc(devis.createdAt));
}

export async function passagesDeMission(interventionId: string) {
  return db
    .select({ p: missionPassages, technicien: users.nom })
    .from(missionPassages)
    .leftJoin(users, eq(missionPassages.technicienId, users.id))
    .where(eq(missionPassages.interventionId, interventionId))
    .orderBy(asc(missionPassages.numero));
}

/** Relance (cron) : devis envoyés sans réponse depuis 7 jours → un rappel, une seule fois. */
export async function relancerDevisSansReponse() {
  const limite = new Date(Date.now() - 7 * 86400000);
  const aRelancer = await db
    .select({ id: devis.id })
    .from(devis)
    .where(and(eq(devis.statut, "envoye"), isNull(devis.relanceLe), lt(devis.dateEnvoi, limite)));
  let n = 0;
  for (const { id } of aRelancer) {
    const dv = await lireDevis(id);
    if (!dv || expire(dv.d)) continue;
    await db.update(devis).set({ relanceLe: new Date() }).where(eq(devis.id, id));
    const titre = `Rappel — devis ${dv.d.numero} en attente de votre réponse`;
    for (const x of dv.destinataires.filter((d) => d.peutDecider === 1)) {
      if (x.canal === "observateur" && x.userId) {
        await notifierUtilisateurs([x.userId], { titre: `🧾 ${titre}`, corps: "Le devis attend votre réponse.", url: `/observateur/devis/${id}`, tag: `devis-${id}` });
      }
      // Lien email : on n'a pas le lien d'origine (seule son empreinte est gardée) → nouveau lien.
      if (x.canal === "email" && x.email) {
        const jeton = randomBytes(24).toString("base64url");
        await db.update(devisDestinataires).set({ jetonHash: hashJeton(jeton) }).where(eq(devisDestinataires.id, x.id));
        await envoyerAvisObservateur({ email: x.email, nom: x.nom ?? "Madame, Monsieur", titre, texte: `Le devis ${dv.d.numero} de ROBUS attend toujours votre réponse.`, lien: lien(`/devis/${jeton}`), bouton: "Voir le devis" });
      }
    }
    await notifierBureau({ titre: `⏰ Devis ${dv.d.numero} sans réponse depuis 7 jours`, corps: `${dv.client} — rappel envoyé au client.`, url: `/responsable/devis/${id}`, tag: `devis-${id}` });
    n++;
  }
  return n;
}

/** Devis reçus par un observateur (espace client). */
export async function devisDeLObservateur(userId: string, appareilId?: string) {
  return db
    .select({
      id: devis.id,
      numero: devis.numero,
      titre: devis.titre,
      statut: devis.statut,
      dateEnvoi: devis.dateEnvoi,
      validiteJours: devis.validiteJours,
      peutDecider: devisDestinataires.peutDecider,
      appareilId: devis.appareilId,
      numeroAppareil: appareils.numeroInterne,
    })
    .from(devisDestinataires)
    .innerJoin(devis, eq(devisDestinataires.devisId, devis.id))
    .leftJoin(appareils, eq(devis.appareilId, appareils.id))
    .where(
      and(
        eq(devisDestinataires.userId, userId),
        eq(devisDestinataires.canal, "observateur"),
        sql`${devisDestinataires.envoyeLe} is not null`,
        sql`${devis.statut}::text <> 'annule'`,
        appareilId ? eq(devis.appareilId, appareilId) : undefined
      )
    )
    .orderBy(desc(devis.dateEnvoi));
}
