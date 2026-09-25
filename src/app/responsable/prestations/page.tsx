import { Card, Pill } from "@/components/ui";
import { db } from "@/db";
import { clients, prestations, prestationsCatalogue, projets } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";

const PRESTATION_TYPE_LABEL: Record<string, string> = {
  installation: "Installation",
  reparation: "Réparation",
  garantie: "Garantie",
  maintenance_preventive: "Maintenance préventive",
  maintenance_corrective: "Maintenance corrective",
  maintenance_systematique: "Maintenance systématique",
  vente_piece: "Vente de pièce",
};

export default async function PrestationsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireUser(ROLES_BUREAU);
  const { type } = await searchParams;

  const rows = await db
    .select({
      id: prestations.id,
      type: prestations.type,
      description: prestations.description,
      prixEstime: prestations.prixEstime,
      quantitePieces: prestations.quantitePieces,
      createdAt: prestations.createdAt,
      projetId: projets.id,
      projetReference: projets.reference,
      projetTitre: projets.titre,
      clientNom: clients.raisonSociale,
      catalogueNom: prestationsCatalogue.nom,
      catalogueCategorie: prestationsCatalogue.categorie,
    })
    .from(prestations)
    .innerJoin(projets, eq(prestations.projetId, projets.id))
    .innerJoin(clients, eq(projets.clientId, clients.id))
    .leftJoin(prestationsCatalogue, eq(prestations.catalogueId, prestationsCatalogue.id))
    .orderBy(desc(prestations.createdAt));

  // Phase 6 : le filtre par "type" reste utile pour les prestations
  // pré-Phase 6 ; on filtre aussi sur la catégorie catalogue des nouvelles.
  const filtered = type
    ? rows.filter((r) => r.type === type || r.catalogueCategorie === type)
    : rows;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Prestations</h1>
        <p className="text-sm text-ink-soft">
          {filtered.length} prestation(s), tous projets confondus. Une prestation se crée toujours
          depuis la fiche d&apos;un Projet.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/responsable/prestations">
          <Pill tone={!type ? "ok" : "neutral"}>Toutes</Pill>
        </Link>
        {Object.entries(PRESTATION_TYPE_LABEL).map(([value, label]) => (
          <Link key={value} href={`/responsable/prestations?type=${value}`}>
            <Pill tone={type === value ? "ok" : "neutral"}>{label}</Pill>
          </Link>
        ))}
      </div>

      <Card className="p-5">
        <div className="flex flex-col divide-y divide-line">
          {filtered.map((p) => (
            <Link
              key={p.id}
              href={`/responsable/projets/${p.projetId}`}
              className="py-3 flex items-center justify-between gap-3 hover:bg-blue-pale/40 -mx-2 px-2 rounded-lg"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Pill tone="neutral">
                    {p.type ? PRESTATION_TYPE_LABEL[p.type] ?? p.type : p.catalogueCategorie ?? "—"}
                  </Pill>
                  <span className="text-sm truncate">
                    {p.catalogueNom || p.description || "Sans description"}
                  </span>
                </div>
                <div className="text-xs text-ink-soft mt-0.5">
                  {p.projetReference} · {p.clientNom}
                </div>
              </div>
              {p.prixEstime && (
                <span className="text-xs text-ink-soft whitespace-nowrap">{p.prixEstime} €</span>
              )}
            </Link>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-ink-soft py-3">Aucune prestation pour l&apos;instant.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
