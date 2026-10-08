import nodemailer from "nodemailer";
import path from "node:path";
import fs from "node:fs";
import { journaliser } from "@/lib/journal";
import { formatDate } from "@/lib/format";

const LOGO_PATH = path.join(process.cwd(), "public", "logo-robus.png");

function logoAttachment() {
  // N'attache le logo que s'il est bien présent sur le disque — un fichier
  // manquant ne doit jamais faire échouer l'envoi de l'email.
  if (!fs.existsSync(LOGO_PATH)) return [];
  return [{ filename: "logo.png", path: LOGO_PATH, cid: "robus-logo" }];
}

function echapperHtml(texte: string) {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resoudreUrlDocument(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, process.env.NEXTAUTH_URL || "https://robuswork.tech").toString();
}

function enteteHtml() {
  return `<div style="background:#003366;padding:16px 20px;">
    <img src="cid:robus-logo" alt="ROBUS" height="32" style="display:block;" />
  </div>`;
}

/**
 * Envoi des "ordres de mission" par email (Phase 5).
 * Configuré via variables d'environnement (voir .env.example) — si elles
 * sont absentes (ex. en développement local sans SMTP configuré), l'envoi
 * est silencieusement désactivé : ça ne doit jamais faire échouer l'action
 * métier qui l'appelle (affectation d'un technicien à un Projet).
 */
function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
}

export type OrdreDeMissionParams = {
  projetId: string;
  destinataireEmail: string;
  destinataireNom: string;
  projetReference: string;
  projetTitre: string;
  clientNom: string;
  adresses: string[];
  appareils: string[];
  prestations: string[];
  dateDebutPrevue: Date | null;
  // Phase 7 : message libre + documents joints, optionnels — ajoutés à
  // l'affectation initiale d'un technicien ou lors d'un renvoi manuel.
  message?: string;
  documents?: { titre: string; url: string }[];
  // Phase 17 : missions précises envoyées (date réelle de chaque mission).
  missions?: { date: Date | null; appareil: string; type: string }[];
};

export type ResultatEmail = "ok" | "echec" | "non_configure";

function formatDateHeure(d: Date) {
  return d.toLocaleString("fr-BE", { timeZone: "Europe/Brussels", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export async function envoyerOrdreDeMission(params: OrdreDeMissionParams): Promise<ResultatEmail> {
  const transport = getTransport();
  if (!transport) {
    // Pas de SMTP configuré (ex. environnement de développement) : on ne
    // bloque jamais l'affectation, on trace juste l'absence d'envoi.
    await journaliser({
      entite: "projet",
      entiteId: params.projetId,
      action: "email_non_configure",
      details: `Ordre de mission non envoyé (SMTP non configuré) — ${params.destinataireEmail}`,
    });
    return "non_configure";
  }

  const missions = params.missions ?? [];
  const lienApp = new URL("/technicien", process.env.NEXTAUTH_URL || "https://robuswork.tech").toString();
  const lignesMissions = missions.length
    ? missions.map((m) => `- ${m.date ? formatDateHeure(m.date) : "date à confirmer"} — ${m.appareil} (${m.type})`).join("\n")
    : "";

  const quand = params.dateDebutPrevue
    ? formatDate(params.dateDebutPrevue)
    : "Date à confirmer";

  const lignesAppareils = params.appareils.length
    ? params.appareils.map((a) => `- ${a}`).join("\n")
    : "- (à préciser)";
  const lignesPrestations = params.prestations.length
    ? params.prestations.map((p) => `- ${p}`).join("\n")
    : "- (à préciser)";
  const lignesDocuments = (params.documents ?? []).length
    ? params.documents!.map((d) => `- ${d.titre} : ${resoudreUrlDocument(d.url)}`).join("\n")
    : "";

  const texte = `Bonjour ${params.destinataireNom},

Vous avez été affecté(e) au projet suivant :

Référence : ${params.projetReference}
Projet : ${params.projetTitre}
Client : ${params.clientNom}
Adresse(s) : ${params.adresses.join(", ") || "à préciser"}
Date prévue : ${quand}
${lignesMissions ? `\nMission(s) :\n${lignesMissions}\n` : ""}
Appareil(s) concerné(s) :
${lignesAppareils}

Prestation(s) :
${lignesPrestations}
${params.message ? `\nConsignes :\n${params.message}\n` : ""}${
    lignesDocuments ? `\nDocuments utiles :\n${lignesDocuments}\n` : ""
  }
Ouvrir l'application ROBUS : ${lienApp}

— ROBUS Liften Ascenseurs`;

  const ligneHtml = (label: string, valeur: string) =>
    `<tr><td style="padding:3px 10px 3px 0;color:#6b7482;font-size:12px;font-weight:bold;white-space:nowrap;vertical-align:top;">${echapperHtml(
      label
    )}</td><td style="padding:3px 0;color:#333333;font-size:13px;">${echapperHtml(valeur)}</td></tr>`;

  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;">
    ${enteteHtml()}
    <div style="padding:20px;">
      <p style="font-size:14px;color:#333333;">Bonjour ${echapperHtml(params.destinataireNom)},</p>
      <p style="font-size:14px;color:#333333;">Vous avez été affecté(e) au projet suivant :</p>
      <table style="border-collapse:collapse;margin:10px 0;">
        ${ligneHtml("Référence", params.projetReference)}
        ${ligneHtml("Projet", params.projetTitre)}
        ${ligneHtml("Client", params.clientNom)}
        ${ligneHtml("Adresse(s)", params.adresses.join(", ") || "à préciser")}
        ${ligneHtml("Date prévue", quand)}
      </table>
      ${
        missions.length
          ? `<p style="font-size:13px;color:#333333;margin:14px 0 4px;"><strong>Mission(s)</strong></p>
             <table style="border-collapse:collapse;">${missions
               .map(
                 (m) =>
                   `<tr><td style="padding:3px 12px 3px 0;font-size:13px;font-weight:bold;color:#003366;white-space:nowrap;">${echapperHtml(
                     m.date ? formatDateHeure(m.date) : "Date à confirmer"
                   )}</td><td style="padding:3px 0;font-size:13px;color:#333333;">${echapperHtml(`${m.appareil} — ${m.type}`)}</td></tr>`
               )
               .join("")}</table>`
          : ""
      }
      <p style="font-size:13px;color:#333333;margin:14px 0 4px;"><strong>Appareil(s) concerné(s)</strong></p>
      <p style="font-size:13px;color:#333333;margin:0;">${
        params.appareils.length
          ? params.appareils.map((a) => echapperHtml(a)).join("<br/>")
          : "(à préciser)"
      }</p>
      <p style="font-size:13px;color:#333333;margin:14px 0 4px;"><strong>Prestation(s)</strong></p>
      <p style="font-size:13px;color:#333333;margin:0;">${
        params.prestations.length
          ? params.prestations.map((p) => echapperHtml(p)).join("<br/>")
          : "(à préciser)"
      }</p>
      ${
        params.message
          ? `<div style="margin-top:16px;padding:10px 12px;background:#e8f4fc;border-radius:8px;">
               <p style="font-size:12px;color:#0055a4;font-weight:bold;margin:0 0 4px;text-transform:uppercase;">Consignes</p>
               <p style="font-size:13px;color:#333333;margin:0;white-space:pre-wrap;">${echapperHtml(params.message)}</p>
             </div>`
          : ""
      }
      ${
        params.documents && params.documents.length > 0
          ? `<div style="margin-top:16px;">
               <p style="font-size:12px;color:#6b7482;font-weight:bold;margin:0 0 6px;text-transform:uppercase;">Documents utiles</p>
               <ul style="margin:0;padding-left:18px;">
                 ${params.documents
                   .map(
                     (d) =>
                       `<li style="font-size:13px;margin-bottom:4px;"><a href="${resoudreUrlDocument(
                         d.url
                       )}" style="color:#0055a4;">${echapperHtml(d.titre)}</a></li>`
                   )
                   .join("")}
               </ul>
             </div>`
          : ""
      }
      <p style="margin-top:20px;"><a href="${lienApp}" style="display:inline-block;background:#0055a4;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:10px 18px;border-radius:8px;">Ouvrir mes missions</a></p>
      <p style="font-size:12px;color:#6b7482;margin-top:24px;">— ROBUS Liften Ascenseurs</p>
    </div>
  </div>`;

  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: params.destinataireEmail,
      subject: missions.length
        ? `Nouvelle mission — ${missions[0].date ? formatDateHeure(missions[0].date) : params.projetReference} — ${params.clientNom}`
        : `Ordre de mission — ${params.projetReference} — ${params.clientNom}`,
      text: texte,
      html,
      attachments: logoAttachment(),
    });
    await journaliser({
      entite: "projet",
      entiteId: params.projetId,
      action: "email_envoye",
      details: `Ordre de mission envoyé à ${params.destinataireEmail}`,
    });
    return "ok";
  } catch (err) {
    // L'échec d'envoi ne doit jamais empêcher l'affectation du technicien —
    // on le trace pour que ce soit visible dans le journal d'activité.
    await journaliser({
      entite: "projet",
      entiteId: params.projetId,
      action: "email_echec",
      details: `Échec d'envoi à ${params.destinataireEmail} : ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return "echec";
  }
}

/**
 * "Besoin d'aide" (Phase 6) : le technicien alerte le bureau depuis le
 * terrain. Même politique que envoyerOrdreDeMission — silencieux si SMTP
 * n'est pas configuré, ne bloque jamais l'action métier (l'enregistrement
 * de la demande d'aide en base a déjà eu lieu avant cet appel).
 */
export type AlerteAideParams = {
  demandeId: string;
  interventionId: string;
  technicienNom: string;
  numeroInterne: string;
  message: string | null;
};

export async function envoyerAlerteAide(params: AlerteAideParams) {
  const transport = getTransport();
  const destinataire = process.env.MAIL_FROM || process.env.SMTP_USER;
  if (!transport || !destinataire) {
    await journaliser({
      entite: "intervention",
      entiteId: params.interventionId,
      action: "email_non_configure",
      details: `Alerte "Besoin d'aide" non envoyée (SMTP non configuré) — ${params.technicienNom}`,
    });
    return;
  }

  const texte = `Le technicien ${params.technicienNom} a demandé de l'aide sur l'appareil ${params.numeroInterne}.

${params.message ? `Message : ${params.message}\n\n` : ""}Intervention concernée : ${params.interventionId}

— ROBUS Liften Ascenseurs`;

  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;">
    ${enteteHtml()}
    <div style="padding:20px;">
      <p style="font-size:14px;color:#333333;">Le technicien <strong>${echapperHtml(
        params.technicienNom
      )}</strong> a demandé de l'aide sur l'appareil <strong>${echapperHtml(params.numeroInterne)}</strong>.</p>
      ${
        params.message
          ? `<p style="font-size:13px;color:#333333;background:#e8f4fc;border-radius:8px;padding:10px 12px;white-space:pre-wrap;">${echapperHtml(
              params.message
            )}</p>`
          : ""
      }
      <p style="font-size:12px;color:#6b7482;">Intervention concernée : ${echapperHtml(params.interventionId)}</p>
      <p style="font-size:12px;color:#6b7482;margin-top:24px;">— ROBUS Liften Ascenseurs</p>
    </div>
  </div>`;

  try {
    await transport.sendMail({
      from: destinataire,
      to: destinataire,
      subject: `Besoin d'aide — ${params.technicienNom} — ${params.numeroInterne}`,
      text: texte,
      html,
      attachments: logoAttachment(),
    });
    await journaliser({
      entite: "intervention",
      entiteId: params.interventionId,
      action: "email_envoye",
      details: `Alerte "Besoin d'aide" envoyée pour ${params.technicienNom}`,
    });
  } catch (err) {
    await journaliser({
      entite: "intervention",
      entiteId: params.interventionId,
      action: "email_echec",
      details: `Échec d'envoi de l'alerte "Besoin d'aide" : ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
}

/**
 * Phase 14 : lien de réinitialisation du mot de passe (valable 30 min).
 * Renvoie true si l'email est parti, false sinon (SMTP absent ou erreur).
 */
export async function envoyerLienReinitialisation(params: { email: string; nom: string; lien: string }) {
  const transport = getTransport();
  if (!transport) return false;
  const nom = echapperHtml(params.nom);
  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: params.email,
      subject: "ROBUS — Réinitialisation de votre mot de passe",
      text: `Bonjour ${params.nom},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 30 minutes, utilisable une seule fois) :\n${params.lien}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe actuel reste valable.\n\nROBUS`,
      html: `${enteteHtml()}<div style="font-family:Arial,sans-serif;padding:20px;color:#1f2a37;">
        <p>Bonjour ${nom},</p>
        <p>Pour choisir un nouveau mot de passe, cliquez sur le bouton ci-dessous. Le lien est valable <strong>30 minutes</strong> et utilisable une seule fois.</p>
        <p><a href="${params.lien}" style="display:inline-block;background:#0055a4;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Choisir un nouveau mot de passe</a></p>
        <p style="font-size:12px;color:#5b6675;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe actuel reste valable.</p>
      </div>`,
      attachments: logoAttachment(),
    });
    return true;
  } catch {
    return false;
  }
}

// ==========================================================================
// Phase 18 — Espace Observateur : invitation (création du mot de passe) et
// avis (intervention planifiée, rapport disponible…). Jamais bloquant.
// ==========================================================================
export async function envoyerInvitationObservateur(params: {
  email: string;
  nom: string;
  clientNom: string;
  lien: string;
  dateFin: Date | null;
}): Promise<ResultatEmail> {
  const transport = getTransport();
  if (!transport) return "non_configure";
  const fin = params.dateFin ? ` jusqu'au ${formatDate(params.dateFin)}` : "";
  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: params.email,
      subject: `ROBUS — Votre accès au suivi de vos ascenseurs (${params.clientNom})`,
      text: `Bonjour ${params.nom},\n\nROBUS vous donne accès au suivi de vos ascenseurs (${params.clientNom})${fin}.\n\nPour activer votre accès, créez votre mot de passe avec ce lien (valable 7 jours) :\n${params.lien}\n\nEnsuite, connectez-vous avec votre email et ce mot de passe, ou scannez le QR code collé dans la cabine.\n\nROBUS`,
      html: `${enteteHtml()}<div style="font-family:Arial,sans-serif;padding:20px;color:#1f2a37;">
        <p>Bonjour ${echapperHtml(params.nom)},</p>
        <p>ROBUS vous donne accès au suivi de vos ascenseurs (<strong>${echapperHtml(params.clientNom)}</strong>)${echapperHtml(fin)}.</p>
        <p>Pour activer votre accès, créez votre mot de passe (lien valable <strong>7 jours</strong>) :</p>
        <p><a href="${params.lien}" style="display:inline-block;background:#0055a4;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Créer mon mot de passe</a></p>
        <p style="font-size:13px;color:#5b6675;">Ensuite, connectez-vous avec votre email et ce mot de passe, ou scannez le QR code collé dans la cabine de l'ascenseur.</p>
      </div>`,
      attachments: logoAttachment(),
    });
    return "ok";
  } catch {
    return "echec";
  }
}

export async function envoyerAvisObservateur(params: { email: string; nom: string; titre: string; texte: string; lien: string; bouton?: string }) {
  const transport = getTransport();
  if (!transport) return "non_configure" as const;
  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: params.email,
      subject: `ROBUS — ${params.titre.replace(/^[^\p{L}\p{N}]+/u, "")}`,
      text: `Bonjour ${params.nom},\n\n${params.texte}\n\n${params.bouton ?? "Voir le détail"} : ${params.lien}\n\nROBUS`,
      html: `${enteteHtml()}<div style="font-family:Arial,sans-serif;padding:20px;color:#1f2a37;">
        <p>Bonjour ${echapperHtml(params.nom)},</p>
        <p style="font-size:15px;"><strong>${echapperHtml(params.titre)}</strong></p>
        <p>${echapperHtml(params.texte)}</p>
        <p><a href="${params.lien}" style="display:inline-block;background:#0055a4;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">${echapperHtml(params.bouton ?? "Voir le détail")}</a></p>
      </div>`,
      attachments: logoAttachment(),
    });
    return "ok" as const;
  } catch {
    return "echec" as const;
  }
}

// ==========================================================================
// Phase 20 — Demandes client : alerte au bureau (panne, demande…) et résumé
// mensuel envoyé aux observateurs.
// ==========================================================================
export async function envoyerAlerteDemande(params: {
  destinataires: string[];
  sujet: string;
  lignes: [string, string][];
  description: string;
  lien: string;
  urgence: boolean;
  /** Phase 21 : libellé du bouton (« Ouvrir la demande » par défaut). */
  bouton?: string;
}) {
  const transport = getTransport();
  if (!transport || !params.destinataires.length) return "non_configure" as const;
  const bouton = params.bouton ?? "Ouvrir la demande";
  const tableau = params.lignes
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 12px 3px 0;color:#6b7482;font-size:12px;font-weight:bold;white-space:nowrap;">${echapperHtml(k)}</td><td style="padding:3px 0;font-size:13px;color:#333333;">${echapperHtml(v)}</td></tr>`
    )
    .join("");
  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: params.destinataires.join(", "),
      subject: params.sujet,
      priority: params.urgence ? "high" : "normal",
      text: `${params.sujet}\n\n${params.lignes.map(([k, v]) => `${k} : ${v}`).join("\n")}\n\n${params.description}\n\n${bouton} : ${params.lien}\n\nROBUS`,
      html: `${enteteHtml()}<div style="font-family:Arial,sans-serif;padding:20px;color:#1f2a37;max-width:560px;">
        ${params.urgence ? `<div style="background:#fdecea;color:#a3261b;font-weight:bold;padding:10px 14px;border-radius:8px;margin-bottom:12px;">URGENCE — à traiter immédiatement</div>` : ""}
        <p style="font-size:16px;font-weight:bold;margin:0 0 10px;">${echapperHtml(params.sujet)}</p>
        <table style="border-collapse:collapse;margin:0 0 12px;">${tableau}</table>
        <div style="background:#f4f7fb;border-radius:8px;padding:12px 14px;font-size:14px;white-space:pre-wrap;">${echapperHtml(params.description)}</div>
        <p style="margin-top:18px;"><a href="${params.lien}" style="display:inline-block;background:#0055a4;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">${echapperHtml(bouton)}</a></p>
      </div>`,
      attachments: logoAttachment(),
    });
    return "ok" as const;
  } catch {
    return "echec" as const;
  }
}

export async function envoyerResumeMensuel(params: { email: string; nom: string; mois: string; blocs: { titre: string; lignes: string[] }[]; lien: string }) {
  const transport = getTransport();
  if (!transport) return "non_configure" as const;
  const html = params.blocs
    .map(
      (b) =>
        `<p style="font-size:13px;font-weight:bold;color:#003366;margin:16px 0 4px;text-transform:uppercase;">${echapperHtml(b.titre)}</p>` +
        (b.lignes.length
          ? `<ul style="margin:0;padding-left:18px;">${b.lignes.map((l) => `<li style="font-size:13px;margin-bottom:3px;">${echapperHtml(l)}</li>`).join("")}</ul>`
          : `<p style="font-size:13px;color:#6b7482;margin:0;">—</p>`)
    )
    .join("");
  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: params.email,
      subject: `ROBUS — Résumé de vos ascenseurs · ${params.mois}`,
      text: `Bonjour ${params.nom},\n\nRésumé ${params.mois} :\n\n${params.blocs.map((b) => `${b.titre}\n${b.lignes.map((l) => `- ${l}`).join("\n") || "-"}`).join("\n\n")}\n\nVotre espace : ${params.lien}\n\nROBUS`,
      html: `${enteteHtml()}<div style="font-family:Arial,sans-serif;padding:20px;color:#1f2a37;max-width:560px;">
        <p>Bonjour ${echapperHtml(params.nom)},</p>
        <p>Voici le résumé de vos ascenseurs pour <strong>${echapperHtml(params.mois)}</strong>.</p>
        ${html}
        <p style="margin-top:20px;"><a href="${params.lien}" style="display:inline-block;background:#0055a4;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">Ouvrir mon espace</a></p>
        <p style="font-size:11px;color:#6b7482;margin-top:18px;">Vous pouvez désactiver ce résumé dans « Mon accès ».</p>
      </div>`,
      attachments: logoAttachment(),
    });
    return "ok" as const;
  } catch {
    return "echec" as const;
  }
}

/** Phase 21 : avis simple (technicien, observateur…) — titre, texte, bouton « Voir le détail ». */
export const envoyerAvisSimple = envoyerAvisObservateur;
