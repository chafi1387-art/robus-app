import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { habilitationsCatalogue, technicienFiches, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { formatDate } from "@/lib/format";
import { CATEGORIES_HABILITATION, EXIGENCES_MISSION, STATUT_HAB, habilitationsCourantes } from "@/lib/habilitations";
import { creerDocumentRapport, docToBuffer, finaliserAvecPagination, sectionTitre, tableau } from "@/lib/pdf";
import { journaliser } from "@/lib/journal";

// Phase 19 : matrice des compétences (ISO 9001 §7.2) — PDF pour l'auditeur.
export async function GET() {
  const user = await requireUser(ROLES_BUREAU);
  const [techs, catalogue, habs] = await Promise.all([
    db
      .select({ id: users.id, nom: users.nom })
      .from(users)
      .leftJoin(technicienFiches, eq(technicienFiches.technicienId, users.id))
      .where(sql`${users.role} = 'technicien' and ${users.actif} = 1 and coalesce(${technicienFiches.statutRh}::text, '') <> 'sorti_effectifs'`)
      .orderBy(asc(users.nom)),
    db.select().from(habilitationsCatalogue).where(eq(habilitationsCatalogue.actif, 1)).orderBy(asc(habilitationsCatalogue.nom)),
    habilitationsCourantes(),
  ]);

  const doc = creerDocumentRapport("Matrice des compétences", `Habilitations des techniciens — édition du ${formatDate(new Date())}`);

  sectionTitre(doc, "Exigences (catalogue)");
  tableau(
    doc,
    [
      { label: "Habilitation", width: 170 },
      { label: "Catégorie", width: 80 },
      { label: "Validité", width: 60 },
      { label: "Obligatoire pour", width: 195 },
    ],
    catalogue.map((c) => [
      c.nom,
      CATEGORIES_HABILITATION[c.categorie] ?? c.categorie,
      c.validiteMois ? `${c.validiteMois} mois` : "Illimitée",
      c.obligatoire ? c.typesMission.map((t) => EXIGENCES_MISSION[t] ?? t).join(", ") + (c.marques.length ? ` (${c.marques.join(", ")})` : "") : "—",
    ])
  );

  sectionTitre(doc, "Situation par technicien");
  const lignes: string[][] = [];
  for (const t of techs) {
    for (const c of catalogue) {
      const h = habs
        .filter((x) => x.technicienId === t.id && x.catalogueId === c.id)
        .sort((a, b) => b.dateObtention.getTime() - a.dateObtention.getTime())[0];
      if (!h && !c.obligatoire) continue;
      lignes.push([
        t.nom,
        c.nom,
        h ? STATUT_HAB[h.etat].label : c.obligatoire ? "ABSENTE (obligatoire)" : "Absente",
        h ? formatDate(h.dateObtention) : "",
        h?.dateExpiration ? formatDate(h.dateExpiration) : h ? "Illimitée" : "",
        h?.certificatUrl ? "Oui" : h ? "Non" : "",
      ]);
    }
  }
  tableau(
    doc,
    [
      { label: "Technicien", width: 100 },
      { label: "Habilitation", width: 150 },
      { label: "Statut", width: 95 },
      { label: "Obtenue", width: 55 },
      { label: "Expire", width: 55 },
      { label: "Certificat", width: 50 },
    ],
    lignes
  );

  finaliserAvecPagination(doc);
  const buffer = await docToBuffer(doc);
  await journaliser({ entite: "habilitation", entiteId: user.id, action: "export_matrice_pdf", utilisateurId: user.id });
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="matrice-competences.pdf"` },
  });
}
