import { db } from "@/db";
import {
  appareils,
  checklistItems,
  clients,
  interventions,
  projets,
  rapportChecklistReponses,
  rapportPhotos,
  rapports,
  users,
} from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { formatDateTime } from "@/lib/format";
import {
  creerDocumentRapport,
  dessinerImage,
  docToBuffer,
  finaliserAvecPagination,
  ligneCle,
  sectionTitre,
} from "@/lib/pdf";
import { journaliser } from "@/lib/journal";
import { eq } from "drizzle-orm";

// Phase 7 : PDF illustré d'une intervention (fiche appareil + projet +
// compte-rendu + checklist + photos) — utilisé depuis le bloc "Interventions
// & rapports" de la fiche Projet ("Voir le rapport complet").
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser(ROLES_BUREAU);
  const { id } = await params;

  const [row] = await db
    .select({
      intervention: interventions,
      appareil: appareils,
      projet: projets,
      client: clients,
      technicien: users,
      rapport: rapports,
    })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .leftJoin(clients, eq(projets.clientId, clients.id))
    .leftJoin(users, eq(interventions.technicienId, users.id))
    .leftJoin(rapports, eq(rapports.interventionId, interventions.id))
    .where(eq(interventions.id, id))
    .limit(1);

  if (!row) {
    return new Response("Intervention introuvable", { status: 404 });
  }

  const { intervention, appareil, projet, client, technicien, rapport } = row;

  const doc = creerDocumentRapport(
    "Rapport d'intervention",
    `${appareil.numeroInterne} — ${formatDateTime(intervention.dateProgrammee)}`
  );

  sectionTitre(doc, "Appareil");
  ligneCle(doc, "N° interne", appareil.numeroInterne);
  ligneCle(doc, "N° de série", appareil.numeroSerie ?? "");
  ligneCle(doc, "Marque", appareil.marque ?? "");
  ligneCle(doc, "Modèle", appareil.modele ?? "");
  ligneCle(doc, "Type d'appareil", appareil.typeAppareil ?? "");
  ligneCle(doc, "Année d'installation", appareil.anneeInstallation?.toString() ?? "");
  ligneCle(doc, "Charge", appareil.charge ? `${appareil.charge} kg` : "");
  ligneCle(doc, "Vitesse", appareil.vitesse ? `${appareil.vitesse} m/s` : "");
  ligneCle(doc, "Niveaux", appareil.niveaux?.toString() ?? "");
  ligneCle(doc, "Type de portes", appareil.typePortes ?? "");

  if (projet) {
    sectionTitre(doc, "Projet");
    ligneCle(doc, "Référence", projet.reference);
    ligneCle(doc, "Titre", projet.titre);
    ligneCle(doc, "Client", client?.raisonSociale ?? "—");
    ligneCle(doc, "Adresse", projet.adresse ?? "");
  }

  sectionTitre(doc, "Intervention");
  ligneCle(doc, "Technicien", technicien?.nom ?? "Non affecté");
  ligneCle(doc, "Type", intervention.type);
  ligneCle(doc, "Date programmée", formatDateTime(intervention.dateProgrammee));
  ligneCle(doc, "Statut", intervention.statut);

  if (rapport) {
    sectionTitre(doc, "Compte-rendu");
    ligneCle(doc, "Travaux réalisés", rapport.travauxRealises ?? "");
    ligneCle(doc, "Observations", rapport.observations ?? "");
    ligneCle(
      doc,
      "Temps passé",
      rapport.tempsPasseMinutes != null ? `${rapport.tempsPasseMinutes} min` : ""
    );
    ligneCle(doc, "Statut final de l'appareil", rapport.statutFinalAppareil ?? "");

    if (rapport.checklistModeleId) {
      const reponses = await db
        .select({
          libelle: checklistItems.libelle,
          conforme: rapportChecklistReponses.conforme,
          observation: rapportChecklistReponses.observation,
        })
        .from(rapportChecklistReponses)
        .innerJoin(checklistItems, eq(rapportChecklistReponses.itemId, checklistItems.id))
        .where(eq(rapportChecklistReponses.rapportId, rapport.id))
        .orderBy(checklistItems.ordre);

      if (reponses.length > 0) {
        sectionTitre(doc, "Checklist");
        for (const r of reponses) {
          const val = r.conforme === 1 ? "Conforme" : r.conforme === 0 ? "Non conforme" : "N/A";
          ligneCle(doc, r.libelle, r.observation ? `${val} — ${r.observation}` : val);
        }
      }
    }

    const photos = await db
      .select()
      .from(rapportPhotos)
      .where(eq(rapportPhotos.rapportId, rapport.id));
    if (photos.length > 0) {
      sectionTitre(doc, `Photos (${photos.length})`);
      for (const p of photos) {
        dessinerImage(doc, p.url, { width: 160 });
      }
    }
  }

  finaliserAvecPagination(doc);
  const buffer = await docToBuffer(doc);

  await journaliser({
    entite: "intervention",
    entiteId: intervention.id,
    action: "generation_rapport_pdf",
    utilisateurId: user.id,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="rapport-intervention-${intervention.id}.pdf"`,
    },
  });
}
