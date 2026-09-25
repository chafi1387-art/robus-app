import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";

// Palette reprise du cahier des charges (section 2).
export const COULEURS = {
  navy: "#003366",
  blue: "#0055a4",
  blueAccent: "#00a3e0",
  bluePale: "#e8f4fc",
  ink: "#333333",
  inkSoft: "#6b7482",
  line: "#e2e8f0",
  orange: "#e67e22",
  red: "#c0392b",
  green: "#27ae60",
};

const MARGE = 45;
const LARGEUR_PAGE = 595.28; // A4 portrait, points

const LOGO_PATH = path.join(process.cwd(), "public", "logo-robus.png");
const LOGO_HAUTEUR_ENTETE = 32;
// Ratio du fichier logo-robus.png (1206×1236, quasi carré) — sert uniquement
// à décaler le texte de l'entête à droite du logo, sans avoir à lire le
// fichier de façon synchrone à chaque page.
const LOGO_LARGEUR_ESTIMEE = LOGO_HAUTEUR_ENTETE * (1206 / 1236);

export function creerDocumentRapport(titre: string, sousTitre: string) {
  const doc = new PDFDocument({ size: "A4", margin: MARGE, bufferPages: true });

  const dessinerEntete = () => {
    doc
      .rect(0, 0, LARGEUR_PAGE, 78)
      .fill(COULEURS.navy);

    let texteX = MARGE;
    try {
      if (fs.existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, MARGE, 14, { height: LOGO_HAUTEUR_ENTETE });
        texteX = MARGE + LOGO_LARGEUR_ESTIMEE + 10;
      }
    } catch {
      // Un logo illisible ne doit jamais empêcher la génération du PDF.
    }

    doc
      .fillColor("#ffffff")
      .fontSize(9)
      .font("Helvetica-Bold")
      .text("ROBUS LIFTEN · ASCENSEURS", texteX, 20);
    doc
      .fontSize(16)
      .text(titre, texteX, 34);
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor(COULEURS.blueAccent)
      .text(sousTitre, texteX, 56);
    doc.fillColor(COULEURS.ink).font("Helvetica");
    doc.y = 100;
  };

  dessinerEntete();
  return doc;
}

/**
 * Insère une image (photo de rapport, etc.) dans le document, si le fichier
 * existe bien sur le disque. `urlOuChemin` est une URL relative telle que
 * stockée en base (ex. "/uploads/rapports/xxx.jpg") — jamais une URL externe
 * (pas de récupération réseau synchrone dans un PDF).
 * Ne lève JAMAIS — une photo manquante ou corrompue est silencieusement
 * ignorée plutôt que de faire échouer toute la génération du PDF.
 */
export function dessinerImage(
  doc: PDFKit.PDFDocument,
  urlOuChemin: string | null | undefined,
  opts?: { width?: number }
) {
  try {
    if (!urlOuChemin || /^https?:\/\//i.test(urlOuChemin)) return;
    const cheminAbsolu = path.join(process.cwd(), "public", urlOuChemin);
    if (!fs.existsSync(cheminAbsolu)) return;

    if (doc.y > 650) doc.addPage();
    doc.x = MARGE;
    doc.image(cheminAbsolu, { width: opts?.width ?? 160 });
    doc.y += 8;
  } catch {
    // Ceinture et bretelles : jamais de plantage de PDF pour une photo.
  }
}

export function sectionTitre(doc: PDFKit.PDFDocument, texte: string) {
  if (doc.y > 700) doc.addPage();
  doc.moveDown(0.5);
  doc
    .fontSize(12)
    .font("Helvetica-Bold")
    .fillColor(COULEURS.navy)
    .text(texte);
  doc
    .moveTo(MARGE, doc.y + 2)
    .lineTo(LARGEUR_PAGE - MARGE, doc.y + 2)
    .strokeColor(COULEURS.line)
    .stroke();
  doc.moveDown(0.6);
  doc.fillColor(COULEURS.ink).font("Helvetica").fontSize(10);
}

export function ligneCle(doc: PDFKit.PDFDocument, cle: string, valeur: string) {
  if (doc.y > 740) doc.addPage();
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COULEURS.inkSoft).text(cle, MARGE, y, { width: 160 });
  doc.font("Helvetica").fontSize(9).fillColor(COULEURS.ink).text(valeur || "—", MARGE + 165, y, {
    width: LARGEUR_PAGE - MARGE * 2 - 165,
  });
  doc.moveDown(0.4);
}

export function tableau(
  doc: PDFKit.PDFDocument,
  colonnes: { label: string; width: number }[],
  lignes: string[][]
) {
  const largeurTotale = colonnes.reduce((s, c) => s + c.width, 0);
  const x0 = MARGE;

  const dessinerEntete = () => {
    const y = doc.y;
    doc.rect(x0, y, largeurTotale, 20).fill(COULEURS.bluePale);
    let x = x0;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(COULEURS.navy);
    for (const col of colonnes) {
      doc.text(col.label, x + 4, y + 6, { width: col.width - 8 });
      x += col.width;
    }
    doc.y = y + 20;
  };

  dessinerEntete();

  doc.font("Helvetica").fontSize(8).fillColor(COULEURS.ink);
  for (const [i, ligne] of lignes.entries()) {
    if (doc.y > 760) {
      doc.addPage();
      doc.y = 100;
      dessinerEntete();
      doc.font("Helvetica").fontSize(8).fillColor(COULEURS.ink);
    }
    const yLigne = doc.y;
    if (i % 2 === 1) {
      doc.rect(x0, yLigne, largeurTotale, 18).fill("#fafbfc");
      doc.fillColor(COULEURS.ink);
    }
    let x = x0;
    for (const [j, cellule] of ligne.entries()) {
      doc.text(cellule || "—", x + 4, yLigne + 5, { width: colonnes[j].width - 8, height: 14, ellipsis: true });
      x += colonnes[j].width;
    }
    doc.y = yLigne + 18;
  }

  if (lignes.length === 0) {
    doc.fillColor(COULEURS.inkSoft).fontSize(9).text("Aucune donnée pour cette période.", x0, doc.y + 4);
  }
  doc.moveDown(0.8);
}

export function finaliserAvecPagination(doc: PDFKit.PDFDocument) {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc
      .fontSize(7)
      .fillColor(COULEURS.inkSoft)
      .text(
        `ROBUS LIFTEN ASCENSEURS — Rapport généré le ${new Date().toLocaleString("fr-BE")} — Page ${i + 1}/${pages.count}`,
        MARGE,
        812,
        { width: LARGEUR_PAGE - MARGE * 2, align: "center" }
      );
  }
}

export async function docToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
