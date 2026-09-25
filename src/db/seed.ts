import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "./index";
import { users, clients, sites, appareils, interventions, contactsClient } from "./schema";

async function main() {
  console.log("Seed — nettoyage puis insertion des données de démonstration...");

  // Nettoyage (ordre inverse des dépendances)
  await db.delete(interventions);
  await db.delete(appareils);
  await db.delete(sites);
  await db.delete(contactsClient);
  await db.delete(clients);
  await db.delete(users);

  const passwordHash = await bcrypt.hash("demo1234", 10);

  const [admin, responsable, technicien1, technicien2, commercial] = await db
    .insert(users)
    .values([
      { nom: "A. Verhoeven", email: "admin@robus.be", passwordHash, role: "administrateur" },
      {
        nom: "S. Lambert",
        email: "responsable@robus.be",
        passwordHash,
        role: "responsable_qualite",
      },
      { nom: "J. Dupont", email: "technicien@robus.be", passwordHash, role: "technicien" },
      { nom: "M. Rossi", email: "m.rossi@robus.be", passwordHash, role: "technicien" },
      { nom: "L. Petit", email: "commercial@robus.be", passwordHash, role: "commercial" },
    ])
    .returning();

  const [clientTilleuls, clientHorizon, clientClinique] = await db
    .insert(clients)
    .values([
      {
        raisonSociale: "Copropriété Les Tilleuls",
        type: "copropriete",
        commercialResponsableId: commercial.id,
      },
      {
        raisonSociale: "SCI Tour Horizon",
        type: "entreprise",
        commercialResponsableId: commercial.id,
      },
      {
        raisonSociale: "Clinique Sainte-Anne asbl",
        type: "entreprise",
        commercialResponsableId: commercial.id,
      },
    ])
    .returning();

  await db.insert(contactsClient).values([
    {
      clientId: clientTilleuls.id,
      nom: "P. Janssens",
      fonction: "Syndic",
      telephone: "+32 4 000 00 01",
      email: "syndic@lestilleuls.be",
    },
    {
      clientId: clientHorizon.id,
      nom: "K. Willems",
      fonction: "Gestionnaire d'immeuble",
      telephone: "+32 4 000 00 02",
      email: "k.willems@tourhorizon.be",
    },
  ]);

  const [siteTilleuls] = await db
    .insert(sites)
    .values([
      {
        clientId: clientTilleuls.id,
        adresse: "12 rue de Namur, 4000 Liège",
        instructionsAcces: "Local technique niveau -1, clé chez le concierge.",
      },
    ])
    .returning();

  const [siteHorizon] = await db
    .insert(sites)
    .values([
      {
        clientId: clientHorizon.id,
        adresse: "4 avenue Louise, 4000 Liège",
        instructionsAcces: "Badge d'accès requis, contacter la réception.",
      },
    ])
    .returning();

  const [siteClinique] = await db
    .insert(sites)
    .values([
      {
        clientId: clientClinique.id,
        adresse: "88 boulevard Piercot, 4000 Liège",
        instructionsAcces: "Accès prioritaire — signaler l'arrivée à l'accueil.",
      },
    ])
    .returning();

  const [appareilA, appareilD] = await db
    .insert(appareils)
    .values([
      {
        siteId: siteTilleuls.id,
        numeroInterne: "A-1042",
        numeroSerie: "OTIS-GEN2-88213",
        marque: "OTIS",
        modele: "Gen2",
        typeAppareil: "Ascenseur",
        anneeInstallation: 2014,
        charge: "630",
        vitesse: "1.0",
        niveaux: 6,
        typePortes: "Automatique coulissante",
        statut: "en_service",
      },
      {
        siteId: siteTilleuls.id,
        numeroInterne: "D-3390",
        numeroSerie: "KONE-MX-55210",
        marque: "Kone",
        modele: "MonoSpace",
        typeAppareil: "Ascenseur",
        anneeInstallation: 2018,
        charge: "800",
        vitesse: "1.6",
        niveaux: 8,
        statut: "en_service",
      },
    ])
    .returning();

  const [appareilB] = await db
    .insert(appareils)
    .values([
      {
        siteId: siteHorizon.id,
        numeroInterne: "B-0871",
        numeroSerie: "SCHINDLER-5500-4471",
        marque: "Schindler",
        modele: "5500",
        typeAppareil: "Ascenseur",
        anneeInstallation: 2011,
        charge: "1000",
        vitesse: "1.6",
        niveaux: 12,
        statut: "en_panne",
      },
    ])
    .returning();

  const [appareilC] = await db
    .insert(appareils)
    .values([
      {
        siteId: siteClinique.id,
        numeroInterne: "C-2210",
        numeroSerie: "KONE-MS-99021",
        marque: "Kone",
        modele: "MonoSpace",
        typeAppareil: "Ascenseur",
        anneeInstallation: 2016,
        charge: "1275",
        vitesse: "1.6",
        niveaux: 10,
        statut: "sous_surveillance",
      },
    ])
    .returning();

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (h: number, m = 0) => new Date(today.getTime() + (h * 60 + m) * 60000);
  const daysAgo = (n: number) => new Date(today.getTime() - n * 86400000);
  const daysFromNow = (n: number) => new Date(today.getTime() + n * 86400000);

  await db.insert(interventions).values([
    {
      appareilId: appareilA.id,
      technicienId: technicien1.id,
      type: "preventive",
      statut: "planifiee",
      priorite: "normale",
      description: "Contrôle visuel cabine et portes, essais de fonctionnement.",
      dateProgrammee: at(8, 30),
    },
    {
      appareilId: appareilB.id,
      technicienId: technicien1.id,
      type: "corrective",
      statut: "affectee",
      priorite: "critique",
      description: "Panne signalée : arrêt entre étages.",
      dateProgrammee: at(10, 0),
    },
    {
      appareilId: appareilC.id,
      technicienId: technicien1.id,
      type: "systematique",
      statut: "planifiee",
      priorite: "haute",
      description: "Contrôle réglementaire des câbles de traction.",
      dateProgrammee: at(14, 0),
    },
    {
      appareilId: appareilD.id,
      technicienId: technicien2.id,
      type: "preventive",
      statut: "terminee",
      priorite: "normale",
      description: "Entretien préventif standard.",
      dateProgrammee: daysAgo(2),
      dateDebut: daysAgo(2),
      dateFin: daysAgo(2),
    },
    {
      appareilId: appareilA.id,
      technicienId: null,
      type: "preventive",
      statut: "creee",
      priorite: "normale",
      description: "Prochaine maintenance préventive.",
      dateProgrammee: daysFromNow(21),
    },
  ]);

  console.log("Terminé.");
  console.log({
    utilisateurs: [admin.email, responsable.email, technicien1.email, technicien2.email, commercial.email],
  });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
