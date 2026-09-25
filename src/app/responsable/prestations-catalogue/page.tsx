import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { db } from "@/db";
import { prestationsCatalogue } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { createPrestationCatalogue, togglePrestationCatalogueActive } from "./actions";

const CATEGORIE_LABEL: Record<string, string> = {
  installation: "Installation",
  reparation: "Réparation",
  maintenance: "Maintenance",
  vente_piece: "Vente de pièce",
  autre: "Autre",
};

export default async function PrestationsCataloguePage() {
  await requireUser(ROLES_BUREAU);

  const rows = await db
    .select()
    .from(prestationsCatalogue)
    .orderBy(prestationsCatalogue.categorie, prestationsCatalogue.nom);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Catalogue prestations</h1>
        <p className="text-sm text-ink-soft">
          Catalogue indépendant des prestations proposées — chaque Projet instancie ensuite l&apos;une
          de ces entrées.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display font-bold text-sm mb-3">Prestations ({rows.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="pb-2 pr-3">Nom</th>
                  <th className="pb-2 pr-3">Catégorie</th>
                  <th className="pb-2 pr-3">Prix indicatif</th>
                  <th className="pb-2 pr-3">Statut</th>
                  <th className="pb-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{r.nom}</div>
                      {r.description && (
                        <div className="text-xs text-ink-soft">{r.description}</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Pill tone="neutral">{CATEGORIE_LABEL[r.categorie] ?? r.categorie}</Pill>
                    </td>
                    <td className="py-2.5 pr-3 text-ink-soft">
                      {r.prixIndicatif ? `${r.prixIndicatif} €` : "—"}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Pill tone={r.actif === 1 ? "ok" : "neutral"}>
                        {r.actif === 1 ? "Active" : "Désactivée"}
                      </Pill>
                    </td>
                    <td className="py-2.5 pr-3">
                      <form action={togglePrestationCatalogueActive}>
                        <input type="hidden" name="id" value={r.id} />
                        <Btn type="submit" variant="ghost" className="!px-3 !py-1.5 !text-xs">
                          {r.actif === 1 ? "Désactiver" : "Réactiver"}
                        </Btn>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucune prestation créée pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">Nouvelle prestation</h2>
          <form action={createPrestationCatalogue} className="flex flex-col gap-3">
            <Field label="Nom">
              <input name="nom" required className={inputClass} placeholder="Ex. Remplacement câble de traction" />
            </Field>
            <Field label="Catégorie">
              <select name="categorie" className={inputClass} defaultValue="autre">
                {Object.entries(CATEGORIE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description">
              <textarea name="description" rows={3} className={inputClass} />
            </Field>
            <Field label="Prix indicatif (€)">
              <input type="number" name="prixIndicatif" step="0.01" min={0} className={inputClass} />
            </Field>
            <Btn>Créer la prestation</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
