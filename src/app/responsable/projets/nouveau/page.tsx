import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { db } from "@/db";
import {
  appareils,
  clients,
  documentsFormations,
  garantieFormules,
  habilitationsTechnicien,
  interventions,
  prestationsCatalogue,
  projetAppareils,
  projets,
  technicienFiches,
  users,
} from "@/db/schema";
import { and, eq, ne, notInArray, sql } from "drizzle-orm";
import { AssistantProjet, type DonneesAssistant } from "./assistant";

export default async function NouveauProjetPage() {
  await requireUser(ROLES_BUREAU);

  const [listeClients, listeAppareils, liensClientAppareil, techs, habs, charges, formules, catalogue] = await Promise.all([
    db.select({ id: clients.id, nom: clients.raisonSociale, type: clients.type }).from(clients).orderBy(clients.raisonSociale),
    db
      .select({ id: appareils.id, numero: appareils.numeroInterne, marque: appareils.marque, modele: appareils.modele, type: appareils.typeAppareil, niveaux: appareils.niveaux })
      .from(appareils)
      .orderBy(appareils.numeroInterne),
    db
      .selectDistinct({ clientId: projets.clientId, appareilId: projetAppareils.appareilId })
      .from(projetAppareils)
      .innerJoin(projets, eq(projetAppareils.projetId, projets.id)),
    db
      .select({ id: users.id, nom: users.nom, statutRh: technicienFiches.statutRh, poste: technicienFiches.poste, specialites: technicienFiches.specialites })
      .from(users)
      .leftJoin(technicienFiches, eq(technicienFiches.technicienId, users.id))
      .where(and(eq(users.role, "technicien"), eq(users.actif, 1)))
      .orderBy(users.nom),
    db
      .select({ technicienId: habilitationsTechnicien.technicienId, titre: documentsFormations.titre })
      .from(habilitationsTechnicien)
      .innerJoin(documentsFormations, eq(habilitationsTechnicien.documentId, documentsFormations.id))
      .where(sql`${habilitationsTechnicien.dateExpiration} is null or ${habilitationsTechnicien.dateExpiration} > now()`),
    db
      .select({ technicienId: interventions.technicienId, n: sql<number>`count(*)::int` })
      .from(interventions)
      .where(notInArray(interventions.statut, ["terminee", "validee", "cloturee"]))
      .groupBy(interventions.technicienId),
    db.select().from(garantieFormules).where(eq(garantieFormules.actif, 1)).orderBy(garantieFormules.dureeMois),
    db
      .select({ id: prestationsCatalogue.id, nom: prestationsCatalogue.nom, categorie: prestationsCatalogue.categorie, prix: prestationsCatalogue.prixIndicatif })
      .from(prestationsCatalogue)
      .where(and(eq(prestationsCatalogue.actif, 1), ne(prestationsCatalogue.categorie, "vente_piece")))
      .orderBy(prestationsCatalogue.categorie, prestationsCatalogue.nom),
  ]);

  const clientsParAppareil = new Map<string, string[]>();
  for (const l of liensClientAppareil) {
    clientsParAppareil.set(l.appareilId, [...(clientsParAppareil.get(l.appareilId) ?? []), l.clientId]);
  }

  const donnees: DonneesAssistant = {
    clients: listeClients,
    appareils: listeAppareils.map((a) => ({ ...a, clientIds: clientsParAppareil.get(a.id) ?? [] })),
    techniciens: techs
      .filter((t) => t.statutRh !== "sorti_effectifs")
      .map((t) => ({
        id: t.id,
        nom: t.nom,
        statutRh: t.statutRh ?? "actif",
        poste: t.poste,
        specialites: t.specialites,
        habilitations: habs.filter((h) => h.technicienId === t.id).map((h) => h.titre),
        missionsEnCours: charges.find((c) => c.technicienId === t.id)?.n ?? 0,
      })),
    formules: formules.map((f) => ({ id: f.id, nom: f.nom, dureeMois: f.dureeMois, visites: f.nombreInterventionsInclues, prix: f.prix, extension: f.optionExtensionDisponible === 1 })),
    catalogue: catalogue.map((c) => ({ ...c, prix: c.prix })),
  };

  return <AssistantProjet donnees={donnees} />;
}
