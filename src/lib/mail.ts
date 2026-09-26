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
};

export async function envoyerOrdreDeMission(params: OrdreDeMissionParams) {
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
    return;
  }

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

Appareil(s) concerné(s) :
${lignesAppareils}

Prestation(s) :
${lignesPrestations}
${params.message ? `\nConsignes :\n${params.message}\n` : ""}${
    lignesDocuments ? `\nDocuments utiles :\n${lignesDocuments}\n` : ""
  }
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
      <p style="font-size:12px;color:#6b7482;margin-top:24px;">— ROBUS Liften Ascenseurs</p>
    </div>
  </div>`;

  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: params.destinataireEmail,
      subject: `Ordre de mission — ${params.projetReference} — ${params.clientNom}`,
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
