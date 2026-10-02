import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { formationsParticipants, formationsSessions, habilitationsCatalogue, users } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { formatDate } from "@/lib/format";
import { COULEURS, creerDocumentRapport, docToBuffer, finaliserAvecPagination, ligneCle, sectionTitre } from "@/lib/pdf";
import { LIEUX_FORMATION, dateFormation } from "@/lib/formations";

// Phase 21 : attestation de formation (preuve ISO 9001 §7.2) — pour le bureau
// et pour le technicien concerné (sa propre attestation uniquement).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["administrateur", "responsable_qualite", "commercial", "technicien"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Introuvable", { status: 404 });
  const valideur = alias(users, "valideur");
  const [r] = await db
    .select({ p: formationsParticipants, s: formationsSessions, nom: users.nom, habilitation: habilitationsCatalogue.nom, valideur: valideur.nom })
    .from(formationsParticipants)
    .innerJoin(formationsSessions, eq(formationsParticipants.sessionId, formationsSessions.id))
    .innerJoin(users, eq(formationsParticipants.technicienId, users.id))
    .leftJoin(habilitationsCatalogue, eq(formationsSessions.catalogueId, habilitationsCatalogue.id))
    .leftJoin(valideur, eq(formationsSessions.clotureeParId, valideur.id))
    .where(eq(formationsParticipants.id, id))
    .limit(1);
  if (!r) return new Response("Introuvable", { status: 404 });
  if (user.role === "technicien" && r.p.technicienId !== user.id) return new Response("Accès refusé", { status: 403 });
  if (r.s.statut !== "terminee" || r.p.present !== 1) return new Response("Attestation disponible après validation de la formation (participant présent).", { status: 409 });

  const doc = creerDocumentRapport("Attestation de formation", `Délivrée le ${formatDate(r.s.clotureeLe ?? new Date())}`);
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(11).fillColor(COULEURS.ink).text("ROBUS Liften · Ascenseurs atteste que", { align: "center" });
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(COULEURS.navy).text(r.nom, { align: "center" });
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(11).fillColor(COULEURS.ink).text("a suivi la formation interne", { align: "center" });
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(15).fillColor(COULEURS.blue).text(`« ${r.s.titre} »`, { align: "center" });
  doc.moveDown(1.5);
  sectionTitre(doc, "Détails");
  ligneCle(doc, "Date", dateFormation(r.s.dateDebut));
  ligneCle(doc, "Durée", r.s.dureeHeures ? `${r.s.dureeHeures} heure(s)` : "—");
  ligneCle(doc, "Lieu", LIEUX_FORMATION[r.s.lieu] ?? r.s.lieu);
  ligneCle(doc, "Formateur / organisme", r.s.organisme ?? "ROBUS");
  ligneCle(doc, "Présence", r.p.emargeLe ? `Signée par le participant le ${r.p.emargeLe.toLocaleString("fr-BE", { timeZone: "Europe/Brussels" })}` : "Confirmée par le bureau");
  ligneCle(doc, "Résultat", r.p.resultat === "reussi" ? "Réussi" : r.p.resultat === "a_refaire" ? "À refaire" : "—");
  if (r.habilitation && r.p.habilitationId) ligneCle(doc, "Habilitation délivrée", r.habilitation);
  ligneCle(doc, "Validée par", `${r.valideur ?? "Bureau ROBUS"}${r.s.clotureeLe ? ` le ${formatDate(r.s.clotureeLe)}` : ""}`);
  if (r.s.programme) {
    sectionTitre(doc, "Programme");
    doc.font("Helvetica").fontSize(9).fillColor(COULEURS.ink).text(r.s.programme);
  }
  doc.moveDown(2);
  doc.font("Helvetica").fontSize(8).fillColor(COULEURS.inkSoft).text(`Référence : ${r.p.id}`, { align: "right" });
  finaliserAvecPagination(doc);
  const buffer = await docToBuffer(doc);
  const nomFichier = `attestation-${r.nom.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${r.s.dateDebut.toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nomFichier}"` },
  });
}
