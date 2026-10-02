import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { formationsParticipants, formationsSessions, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { formatDate } from "@/lib/format";
import { creerDocumentRapport, docToBuffer, finaliserAvecPagination, ligneCle, sectionTitre, tableau } from "@/lib/pdf";
import { LIEUX_FORMATION, dateFormation } from "@/lib/formations";

// Phase 21 : feuille d'émargement d'une formation (réponses, signatures dans
// l'application, validation du bureau) — preuve pour l'audit ISO 9001.
const heure = (d: Date | null) => (d ? d.toLocaleString("fr-BE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short" }) : "");

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(ROLES_BUREAU);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Introuvable", { status: 404 });
  const [s] = await db.select().from(formationsSessions).where(eq(formationsSessions.id, id)).limit(1);
  if (!s) return new Response("Introuvable", { status: 404 });
  const participants = await db
    .select({ p: formationsParticipants, nom: users.nom })
    .from(formationsParticipants)
    .innerJoin(users, eq(formationsParticipants.technicienId, users.id))
    .where(eq(formationsParticipants.sessionId, id))
    .orderBy(asc(users.nom));
  const doc = creerDocumentRapport("Feuille d'émargement", s.titre);
  sectionTitre(doc, "Formation");
  ligneCle(doc, "Date", dateFormation(s.dateDebut));
  ligneCle(doc, "Durée", s.dureeHeures ? `${s.dureeHeures} h` : "—");
  ligneCle(doc, "Lieu", LIEUX_FORMATION[s.lieu] ?? s.lieu);
  ligneCle(doc, "Formateur / organisme", s.organisme ?? "ROBUS");
  ligneCle(doc, "Statut", s.statut === "terminee" ? `Validée le ${formatDate(s.clotureeLe)}` : s.statut === "annulee" ? "Annulée" : "Planifiée");
  sectionTitre(doc, "Participants");
  tableau(
    doc,
    [
      { label: "Technicien", width: 120 },
      { label: "Réponse", width: 80 },
      { label: "Signature (application)", width: 110 },
      { label: "Présence validée", width: 80 },
      { label: "Résultat", width: 60 },
      { label: "Signature manuscrite", width: 55 },
    ],
    participants.map(({ p, nom }) => [
      nom,
      p.reponse === "confirme" ? "Confirmé" : p.reponse === "indisponible" ? "Indisponible" : "Sans réponse",
      p.emargeLe ? heure(p.emargeLe) : "",
      s.statut === "terminee" ? (p.present ? "Présent" : "Absent") : "",
      p.resultat === "reussi" ? "Réussi" : p.resultat === "a_refaire" ? "À refaire" : "",
      " ",
    ])
  );
  finaliserAvecPagination(doc);
  const buffer = await docToBuffer(doc);
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="emargement-${s.dateDebut.toISOString().slice(0, 10)}.pdf"` },
  });
}
