import { db } from "@/db";
import {
  appareils,
  audits,
  clients,
  documentsFormations,
  garantieFormules,
  garanties,
  interventions,
  nonConformites,
  prestations,
  prestationsCatalogue,
  projetAppareils,
  projets,
  projetTechniciens,
  rapportPhotos,
  rapports,
  scoreIsoSaisies,
  sites,
  users,
} from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  COULEURS,
  docToBuffer,
  creerDocumentRapport,
  dessinerImage,
  finaliserAvecPagination,
  ligneCle,
  sectionTitre,
  tableau,
} from "@/lib/pdf";
import { journaliser } from "@/lib/journal";
import { BLOCS_ISO, calculerScoreGlobal } from "@/lib/score-iso";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

function periodeLabel(debut?: Date, fin?: Date) {
  if (!debut && !fin) return "Toute la période";
  return `Du ${debut ? formatDate(debut) : "…"} au ${fin ? formatDate(fin) : "…"}`;
}

function parseDate(v: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: NextRequest) {
  const user = await requireUser(ROLES_BUREAU);
  const params = req.nextUrl.searchParams;
  const type = params.get("type") ?? "global";
  const dateDebut = parseDate(params.get("dateDebut"));
  const dateFinRaw = parseDate(params.get("dateFin"));
  const dateFin = dateFinRaw ? new Date(dateFinRaw.getTime() + 86399999) : undefined; // fin de journée
  const entityId = params.get("entityId") ?? undefined;

  const bornesIntervention = [
    dateDebut ? gte(interventions.dateProgrammee, dateDebut) : undefined,
    dateFin ? lte(interventions.dateProgrammee, dateFin) : undefined,
  ].filter(Boolean);

  let doc;

  switch (type) {
    case "maintenance": {
      doc = creerDocumentRapport("Rapport Maintenance", periodeLabel(dateDebut, dateFin));
      // Phase 6 : le client se dérive du Projet (l'Appareil n'étant plus
      // nécessairement rattaché à un Site) — LEFT JOIN pour ne jamais faire
      // disparaître une intervention sans Projet du rapport.
      const rows = await db
        .select({ i: interventions, appareil: appareils, client: clients, technicien: users.nom })
        .from(interventions)
        .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
        .leftJoin(projets, eq(interventions.projetId, projets.id))
        .leftJoin(clients, eq(projets.clientId, clients.id))
        .leftJoin(users, eq(interventions.technicienId, users.id))
        .where(bornesIntervention.length ? and(...bornesIntervention) : undefined)
        .orderBy(desc(interventions.dateProgrammee));

      sectionTitre(doc, `Interventions (${rows.length})`);
      tableau(
        doc,
        [
          { label: "Date", width: 65 },
          { label: "Appareil", width: 60 },
          { label: "Client", width: 110 },
          { label: "Type", width: 55 },
          { label: "Statut", width: 60 },
          { label: "Technicien", width: 90 },
        ],
        rows.map((r) => [
          formatDate(r.i.dateProgrammee),
          r.appareil.numeroInterne,
          r.client?.raisonSociale ?? "—",
          r.i.type,
          r.i.statut,
          r.technicien ?? "Non affecté",
        ])
      );
      break;
    }

    case "non-conformites": {
      doc = creerDocumentRapport("Rapport Non-conformités & Actions correctives", periodeLabel(dateDebut, dateFin));
      const bornes = [
        dateDebut ? gte(nonConformites.createdAt, dateDebut) : undefined,
        dateFin ? lte(nonConformites.createdAt, dateFin) : undefined,
      ].filter(Boolean);
      const rows = await db
        .select({ nc: nonConformites, client: clients, appareil: appareils })
        .from(nonConformites)
        .leftJoin(clients, eq(nonConformites.clientId, clients.id))
        .leftJoin(appareils, eq(nonConformites.appareilId, appareils.id))
        .where(bornes.length ? and(...bornes) : undefined)
        .orderBy(desc(nonConformites.createdAt));

      const ouvertes = rows.filter((r) => r.nc.statut !== "cloturee").length;
      sectionTitre(doc, "Synthèse");
      ligneCle(doc, "Total", String(rows.length));
      ligneCle(doc, "Ouvertes / en cours", String(ouvertes));
      ligneCle(doc, "Clôturées", String(rows.length - ouvertes));

      sectionTitre(doc, "Détail");
      tableau(
        doc,
        [
          { label: "Titre", width: 140 },
          { label: "Gravité", width: 55 },
          { label: "Statut", width: 55 },
          { label: "Client", width: 100 },
          { label: "Échéance", width: 65 },
        ],
        rows.map((r) => [
          r.nc.titre,
          r.nc.gravite,
          r.nc.statut,
          r.client?.raisonSociale ?? "—",
          formatDate(r.nc.dateEcheance),
        ])
      );
      break;
    }

    case "score-iso": {
      doc = creerDocumentRapport("Rapport Score ISO 9001", "Historique et répartition par bloc");
      const historique = await db
        .select({ mois: scoreIsoSaisies.mois })
        .from(scoreIsoSaisies)
        .groupBy(scoreIsoSaisies.mois)
        .orderBy(sql`${scoreIsoSaisies.mois} desc`)
        .limit(12);

      sectionTitre(doc, "Historique mensuel (12 derniers mois saisis)");
      const lignesHisto: string[][] = [];
      for (const { mois } of historique) {
        const saisies = await db.select().from(scoreIsoSaisies).where(eq(scoreIsoSaisies.mois, mois));
        const valeurs: Record<string, number> = {};
        for (const s of saisies) valeurs[s.bloc] = Number(s.valeur);
        lignesHisto.push([mois, `${calculerScoreGlobal(valeurs)}%`, `${saisies.length}/${BLOCS_ISO.length} blocs`]);
      }
      tableau(
        doc,
        [
          { label: "Mois", width: 100 },
          { label: "Score global", width: 100 },
          { label: "Blocs saisis", width: 100 },
        ],
        lignesHisto
      );

      if (historique[0]) {
        const derniersSaisies = await db
          .select()
          .from(scoreIsoSaisies)
          .where(eq(scoreIsoSaisies.mois, historique[0].mois));
        const valeurs: Record<string, { valeur: number; commentaire: string | null }> = {};
        for (const s of derniersSaisies) valeurs[s.bloc] = { valeur: Number(s.valeur), commentaire: s.commentaire };
        sectionTitre(doc, `Répartition par bloc — ${historique[0].mois}`);
        tableau(
          doc,
          [
            { label: "Bloc", width: 180 },
            { label: "Poids", width: 50 },
            { label: "Valeur", width: 50 },
            { label: "Commentaire", width: 170 },
          ],
          BLOCS_ISO.map((b) => [
            b.label,
            `${b.poids}%`,
            valeurs[b.cle] ? `${valeurs[b.cle].valeur}%` : "—",
            valeurs[b.cle]?.commentaire ?? "",
          ])
        );
      }
      break;
    }

    case "technicien": {
      const [technicien] = entityId
        ? await db.select().from(users).where(eq(users.id, entityId)).limit(1)
        : [undefined];
      doc = creerDocumentRapport(
        `Rapport Technicien — ${technicien?.nom ?? "Tous"}`,
        periodeLabel(dateDebut, dateFin)
      );
      const bornes = [
        entityId ? eq(interventions.technicienId, entityId) : undefined,
        ...bornesIntervention,
      ].filter(Boolean);
      const rows = await db
        .select({ i: interventions, appareil: appareils, client: clients, rapport: rapports })
        .from(interventions)
        .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
        .leftJoin(projets, eq(interventions.projetId, projets.id))
        .leftJoin(clients, eq(projets.clientId, clients.id))
        .leftJoin(rapports, eq(rapports.interventionId, interventions.id))
        .where(bornes.length ? and(...bornes) : undefined)
        .orderBy(desc(interventions.dateProgrammee));

      sectionTitre(doc, `Interventions réalisées (${rows.length})`);
      tableau(
        doc,
        [
          { label: "Date", width: 65 },
          { label: "Appareil", width: 60 },
          { label: "Client", width: 110 },
          { label: "Statut", width: 60 },
          { label: "Temps (min)", width: 65 },
          { label: "Travaux", width: 100 },
        ],
        rows.map((r) => [
          formatDate(r.i.dateProgrammee),
          r.appareil.numeroInterne,
          r.client?.raisonSociale ?? "—",
          r.i.statut,
          r.rapport?.tempsPasseMinutes ? String(r.rapport.tempsPasseMinutes) : "—",
          r.rapport?.travauxRealises ?? "—",
        ])
      );
      break;
    }

    case "projet": {
      if (!entityId) {
        return new Response("entityId requis pour ce type de rapport", { status: 400 });
      }
      const [row] = await db
        .select({ projet: projets, client: clients })
        .from(projets)
        .innerJoin(clients, eq(projets.clientId, clients.id))
        .where(eq(projets.id, entityId))
        .limit(1);
      if (!row) {
        return new Response("Projet introuvable", { status: 404 });
      }
      const { projet, client } = row;

      doc = creerDocumentRapport(`Dossier Projet — ${projet.reference}`, projet.titre);

      sectionTitre(doc, "Informations du projet");
      ligneCle(doc, "Référence", projet.reference);
      ligneCle(doc, "Titre", projet.titre);
      ligneCle(doc, "Client", client.raisonSociale);
      ligneCle(doc, "Adresse", projet.adresse ?? "");
      ligneCle(doc, "Instructions d'accès", projet.instructionsAcces ?? "");
      ligneCle(doc, "Contact sur place", projet.contactNom ?? "");
      ligneCle(doc, "Statut ISO", projet.statut);

      const [techniciensRows, appareilsRows, prestationsRows, garantieRow, documentsRows, interventionsRows] =
        await Promise.all([
          db
            .select({ nom: users.nom, role: projetTechniciens.role })
            .from(projetTechniciens)
            .innerJoin(users, eq(projetTechniciens.technicienId, users.id))
            .where(eq(projetTechniciens.projetId, projet.id)),
          db
            .select({
              numeroInterne: appareils.numeroInterne,
              marque: appareils.marque,
              modele: appareils.modele,
              statut: appareils.statut,
            })
            .from(projetAppareils)
            .innerJoin(appareils, eq(projetAppareils.appareilId, appareils.id))
            .where(eq(projetAppareils.projetId, projet.id)),
          db
            .select({ prestation: prestations, catalogueNom: prestationsCatalogue.nom })
            .from(prestations)
            .leftJoin(prestationsCatalogue, eq(prestations.catalogueId, prestationsCatalogue.id))
            .where(eq(prestations.projetId, projet.id)),
          db
            .select({ garantie: garanties, formule: garantieFormules })
            .from(garanties)
            .leftJoin(garantieFormules, eq(garanties.formuleId, garantieFormules.id))
            .where(eq(garanties.projetId, projet.id))
            .limit(1),
          db.select().from(documentsFormations).where(eq(documentsFormations.projetId, projet.id)),
          db
            .select({ i: interventions, technicien: users.nom, rapport: rapports })
            .from(interventions)
            .leftJoin(users, eq(interventions.technicienId, users.id))
            .leftJoin(rapports, eq(rapports.interventionId, interventions.id))
            .where(eq(interventions.projetId, projet.id))
            .orderBy(desc(interventions.dateProgrammee)),
        ]);

      sectionTitre(doc, `Techniciens affectés (${techniciensRows.length})`);
      tableau(
        doc,
        [
          { label: "Nom", width: 250 },
          { label: "Rôle", width: 250 },
        ],
        techniciensRows.map((t) => [t.nom, t.role ?? "—"])
      );

      sectionTitre(doc, `Appareils (${appareilsRows.length})`);
      tableau(
        doc,
        [
          { label: "N° interne", width: 120 },
          { label: "Marque / Modèle", width: 200 },
          { label: "Statut", width: 180 },
        ],
        appareilsRows.map((a) => [a.numeroInterne, `${a.marque ?? ""} ${a.modele ?? ""}`.trim(), a.statut])
      );

      sectionTitre(doc, `Prestations (${prestationsRows.length})`);
      tableau(
        doc,
        [
          { label: "Prestation", width: 250 },
          { label: "Description", width: 250 },
        ],
        prestationsRows.map((p) => [p.catalogueNom ?? p.prestation.type ?? "—", p.prestation.description ?? ""])
      );

      const garantie = garantieRow[0];
      sectionTitre(doc, "Garantie");
      if (garantie) {
        ligneCle(doc, "Formule", garantie.formule?.nom ?? "—");
        ligneCle(
          doc,
          "Interventions restantes",
          `${garantie.garantie.interventionsRestantes} / ${garantie.garantie.interventionsIncluses}`
        );
        ligneCle(doc, "Échéance", formatDate(garantie.garantie.dateFin));
      } else {
        ligneCle(doc, "Garantie", "Aucune");
      }

      sectionTitre(doc, `Documents liés (${documentsRows.length})`);
      tableau(
        doc,
        [
          { label: "Titre", width: 280 },
          { label: "Catégorie", width: 220 },
        ],
        documentsRows.map((d) => [d.titre, d.categorie])
      );

      sectionTitre(doc, `Historique des interventions (${interventionsRows.length})`);
      if (interventionsRows.length === 0) {
        doc.fillColor(COULEURS.inkSoft).fontSize(9).text("Aucune intervention pour ce projet.");
        doc.fillColor(COULEURS.ink);
      }
      for (const r of interventionsRows) {
        if (doc.y > 700) doc.addPage();
        ligneCle(doc, "Date", formatDateTime(r.i.dateProgrammee));
        ligneCle(doc, "Technicien", r.technicien ?? "Non affecté");
        ligneCle(doc, "Statut", r.i.statut);
        ligneCle(doc, "Commentaire", r.rapport?.travauxRealises ?? "");
        ligneCle(doc, "Observations", r.rapport?.observations ?? "");
        ligneCle(
          doc,
          "Temps passé",
          r.rapport?.tempsPasseMinutes != null ? `${r.rapport.tempsPasseMinutes} min` : ""
        );
        if (r.rapport) {
          const photos = await db
            .select()
            .from(rapportPhotos)
            .where(eq(rapportPhotos.rapportId, r.rapport.id));
          for (const p of photos) {
            dessinerImage(doc, p.url, { width: 140 });
          }
        }
        doc.moveDown(0.6);
      }
      break;
    }

    case "client":
    case "site":
    case "appareil": {
      if (!entityId) {
        return new Response("entityId requis pour ce type de rapport", { status: 400 });
      }
      if (type === "client") {
        const [client] = await db.select().from(clients).where(eq(clients.id, entityId)).limit(1);
        doc = creerDocumentRapport(`Fiche Client — ${client?.raisonSociale ?? ""}`, periodeLabel(dateDebut, dateFin));
        const sitesRows = await db.select().from(sites).where(eq(sites.clientId, entityId));
        sectionTitre(doc, "Sites");
        tableau(doc, [{ label: "Adresse", width: 250 }, { label: "Instructions d'accès", width: 250 }],
          sitesRows.map((s) => [s.adresse, s.instructionsAcces ?? ""])
        );
        const rows = await db
          .select({ i: interventions, appareil: appareils })
          .from(interventions)
          .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
          .innerJoin(sites, eq(appareils.siteId, sites.id))
          .where(and(eq(sites.clientId, entityId), ...bornesIntervention))
          .orderBy(desc(interventions.dateProgrammee));
        sectionTitre(doc, `Historique des interventions (${rows.length})`);
        tableau(
          doc,
          [
            { label: "Date", width: 80 },
            { label: "Appareil", width: 80 },
            { label: "Type", width: 80 },
            { label: "Statut", width: 80 },
          ],
          rows.map((r) => [formatDate(r.i.dateProgrammee), r.appareil.numeroInterne, r.i.type, r.i.statut])
        );
      } else if (type === "site") {
        const [site] = await db
          .select({ site: sites, client: clients })
          .from(sites)
          .innerJoin(clients, eq(sites.clientId, clients.id))
          .where(eq(sites.id, entityId))
          .limit(1);
        doc = creerDocumentRapport(`Fiche Site — ${site?.site.adresse ?? ""}`, periodeLabel(dateDebut, dateFin));
        ligneCle(doc, "Client", site?.client.raisonSociale ?? "");
        const appareilsRows = await db.select().from(appareils).where(eq(appareils.siteId, entityId));
        sectionTitre(doc, `Appareils (${appareilsRows.length})`);
        tableau(
          doc,
          [
            { label: "N° interne", width: 90 },
            { label: "Marque / Modèle", width: 140 },
            { label: "Statut", width: 90 },
          ],
          appareilsRows.map((a) => [a.numeroInterne, `${a.marque ?? ""} ${a.modele ?? ""}`.trim(), a.statut])
        );
      } else {
        // Phase 6 : l'Appareil peut être indépendant de tout Site — LEFT JOIN
        // pour que la fiche reste générée (sans Client/Site) plutôt que vide.
        const [row] = await db
          .select({ appareil: appareils, site: sites, client: clients })
          .from(appareils)
          .leftJoin(sites, eq(appareils.siteId, sites.id))
          .leftJoin(clients, eq(sites.clientId, clients.id))
          .where(eq(appareils.id, entityId))
          .limit(1);
        doc = creerDocumentRapport(`Fiche Appareil — ${row?.appareil.numeroInterne ?? ""}`, periodeLabel(dateDebut, dateFin));
        if (row) {
          ligneCle(doc, "Client", row.client?.raisonSociale ?? "—");
          ligneCle(doc, "Site", row.site?.adresse ?? "—");
          ligneCle(doc, "Marque / Modèle", `${row.appareil.marque ?? "—"} / ${row.appareil.modele ?? "—"}`);
          ligneCle(doc, "N° de série", row.appareil.numeroSerie ?? "—");
          ligneCle(doc, "Statut", row.appareil.statut);
        }
        const rows = await db
          .select({ i: interventions, rapport: rapports })
          .from(interventions)
          .leftJoin(rapports, eq(rapports.interventionId, interventions.id))
          .where(and(eq(interventions.appareilId, entityId), ...bornesIntervention))
          .orderBy(desc(interventions.dateProgrammee));
        sectionTitre(doc, `Historique complet des interventions (${rows.length})`);
        tableau(
          doc,
          [
            { label: "Date", width: 75 },
            { label: "Type", width: 65 },
            { label: "Statut", width: 65 },
            { label: "Travaux réalisés", width: 195 },
          ],
          rows.map((r) => [
            formatDate(r.i.dateProgrammee),
            r.i.type,
            r.i.statut,
            r.rapport?.travauxRealises ?? "—",
          ])
        );
      }
      break;
    }

    case "global":
    default: {
      doc = creerDocumentRapport("Rapport Global de Pilotage", periodeLabel(dateDebut, dateFin));

      const [[{ n: nbInterventions }], [{ n: nbDone }], [{ n: nbEnPanne }], [{ n: nbNcOuvertes }]] =
        await Promise.all([
          db.select({ n: sql<number>`count(*)::int` }).from(interventions),
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(interventions)
            .where(sql`${interventions.statut} in ('terminee','validee','cloturee')`),
          db.select({ n: sql<number>`count(*)::int` }).from(appareils).where(eq(appareils.statut, "en_panne")),
          db.select({ n: sql<number>`count(*)::int` }).from(nonConformites).where(sql`${nonConformites.statut} != 'cloturee'`),
        ]);

      sectionTitre(doc, "Indicateurs clés");
      ligneCle(doc, "Taux de réalisation", nbInterventions > 0 ? `${Math.round((nbDone / nbInterventions) * 100)}%` : "—");
      ligneCle(doc, "Appareils en panne", String(nbEnPanne));
      ligneCle(doc, "Non-conformités ouvertes", String(nbNcOuvertes));

      const moisCourant = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      const saisiesMois = await db.select().from(scoreIsoSaisies).where(eq(scoreIsoSaisies.mois, moisCourant));
      const valeurs: Record<string, number> = {};
      for (const s of saisiesMois) valeurs[s.bloc] = Number(s.valeur);
      sectionTitre(doc, `Score ISO 9001 — ${moisCourant}`);
      ligneCle(doc, "Score global", `${calculerScoreGlobal(valeurs)}%`);
      tableau(
        doc,
        [
          { label: "Bloc", width: 220 },
          { label: "Poids", width: 60 },
          { label: "Valeur", width: 60 },
        ],
        BLOCS_ISO.map((b) => [b.label, `${b.poids}%`, valeurs[b.cle] !== undefined ? `${valeurs[b.cle]}%` : "—"])
      );

      const auditsRecents = await db.select().from(audits).orderBy(desc(audits.createdAt)).limit(5);
      sectionTitre(doc, "Derniers audits");
      tableau(
        doc,
        [
          { label: "Titre", width: 180 },
          { label: "Type", width: 80 },
          { label: "Statut", width: 80 },
          { label: "Date", width: 80 },
        ],
        auditsRecents.map((a) => [a.titre, a.type, a.statut, formatDate(a.datePlanifiee)])
      );
      break;
    }
  }

  finaliserAvecPagination(doc);
  const buffer = await docToBuffer(doc);
  const filename = `rapport-robus-${type}-${new Date().toISOString().slice(0, 10)}.pdf`;

  await journaliser({
    entite: "rapports",
    entiteId: user.id,
    action: `generation_${type}`,
    utilisateurId: user.id,
    details: periodeLabel(dateDebut, dateFin),
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
