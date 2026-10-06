import Link from "next/link";
import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { ChampsContrat } from "@/components/champs-contrat";
import { db } from "@/db";
import { checklistModeles, prestations, prestationsCatalogue } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { fmtMois, moisPassages, TYPE_MISSION_LABEL } from "@/lib/mois-passages";
import { asc, eq, sql } from "drizzle-orm";
import { createPrestationCatalogue, togglePrestationCatalogueActive, updatePrestationCatalogue } from "./actions";

const CATEGORIE_LABEL: Record<string, string> = {
  installation: "Installation",
  reparation: "Réparation",
  maintenance: "Maintenance",
  vente_piece: "Vente de pièce",
  autre: "Autre",
};

export default async function PrestationsCataloguePage({ searchParams }: { searchParams: Promise<{ modifier?: string }> }) {
  await requireUser(ROLES_BUREAU);
  const { modifier } = await searchParams;

  const [rows, checklists, utilisations] = await Promise.all([
    db.select().from(prestationsCatalogue).orderBy(prestationsCatalogue.mode, prestationsCatalogue.categorie, prestationsCatalogue.nom),
    db.select({ id: checklistModeles.id, nom: checklistModeles.nom }).from(checklistModeles).where(eq(checklistModeles.actif, 1)).orderBy(asc(checklistModeles.nom)),
    db
      .select({ catalogueId: prestations.catalogueId, n: sql<number>`count(*)::int` })
      .from(prestations)
      .groupBy(prestations.catalogueId),
  ]);
  const nbProjets = new Map(utilisations.map((u) => [u.catalogueId, u.n]));
  const nomChecklist = new Map(checklists.map((c) => [c.id, c.nom]));
  const enEdition = rows.find((r) => r.id === modifier) ?? null;
  const contrats = rows.filter((r) => r.mode === "contrat");
  const ponctuelles = rows.filter((r) => r.mode !== "contrat");

  const ligne = (r: (typeof rows)[number]) => (
    <tr key={r.id} className={`border-b border-line last:border-0 ${r.id === enEdition?.id ? "bg-blue-pale/50" : ""}`}>
      <td className="py-2.5 pr-3">
        <div className="font-medium">{r.nom}</div>
        {r.mode === "contrat" && r.dureeMois && r.nbPassages ? (
          <div className="text-xs text-ink-soft">
            {r.dureeMois} mois · {r.nbPassages} passage(s) par appareil · {TYPE_MISSION_LABEL[r.typeMission ?? "preventive"]} · mission {r.anticipationJours} j avant
            <br />
            Mois {moisPassages(r.dureeMois, r.nbPassages).map(fmtMois).join(" · ")}
            {r.checklistModeleId ? ` · checklist « ${nomChecklist.get(r.checklistModeleId) ?? "—"} »` : ""}
          </div>
        ) : r.description ? (
          <div className="text-xs text-ink-soft">{r.description}</div>
        ) : null}
      </td>
      <td className="py-2.5 pr-3">
        <Pill tone="neutral">{CATEGORIE_LABEL[r.categorie] ?? r.categorie}</Pill>
      </td>
      <td className="py-2.5 pr-3 text-ink-soft whitespace-nowrap">{r.prixIndicatif ? `${r.prixIndicatif} €` : "—"}</td>
      <td className="py-2.5 pr-3 text-ink-soft text-xs whitespace-nowrap">{nbProjets.get(r.id) ?? 0} projet(s)</td>
      <td className="py-2.5 pr-3">
        <Pill tone={r.actif === 1 ? "ok" : "neutral"}>{r.actif === 1 ? "Active" : "Désactivée"}</Pill>
      </td>
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-1">
          <Link
            href={`/responsable/prestations-catalogue?modifier=${r.id}#formulaire`}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-blue-pale"
          >
            Modifier
          </Link>
          <form action={togglePrestationCatalogueActive}>
            <input type="hidden" name="id" value={r.id} />
            <Btn type="submit" variant="ghost" className="!px-3 !py-1.5 !text-xs">
              {r.actif === 1 ? "Désactiver" : "Réactiver"}
            </Btn>
          </form>
        </div>
      </td>
    </tr>
  );

  const tableau = (titre: string, liste: typeof rows, vide: string) => (
    <Card className="p-5">
      <h2 className="font-display font-bold text-sm mb-3">{titre} ({liste.length})</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
              <th className="pb-2 pr-3">Nom</th>
              <th className="pb-2 pr-3">Catégorie</th>
              <th className="pb-2 pr-3">Prix indicatif</th>
              <th className="pb-2 pr-3">Utilisée</th>
              <th className="pb-2 pr-3">Statut</th>
              <th className="pb-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>{liste.map(ligne)}</tbody>
        </table>
        {liste.length === 0 && <p className="text-sm text-ink-soft py-3">{vide}</p>}
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Catalogue prestations</h1>
        <p className="text-sm text-ink-soft">
          Prestations ponctuelles et contrats à passages (abonnements de maintenance). Ajoutez-les ensuite à un projet :
          les passages d&apos;un contrat sont planifiés automatiquement, appareil par appareil.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {tableau("Contrats à passages", contrats, "Aucun contrat pour l'instant — créez vos abonnements (ex. Essentiel, Confort, Premium).")}
          {tableau("Prestations ponctuelles", ponctuelles, "Aucune prestation ponctuelle pour l'instant.")}
        </div>

        <Card className="p-5 h-fit" id="formulaire">
          <h2 className="font-display font-bold text-sm mb-3">{enEdition ? "Modifier la prestation" : "Nouvelle prestation"}</h2>
          {enEdition && (
            <p className="text-xs text-ink-soft mb-3">
              Les prestations déjà ajoutées aux projets ne changent pas (copie figée) ; la correction s&apos;applique aux prochaines.
            </p>
          )}
          <form
            key={enEdition?.id ?? "nouvelle"}
            action={enEdition ? updatePrestationCatalogue : createPrestationCatalogue}
            className="flex flex-col gap-3"
          >
            {enEdition && <input type="hidden" name="id" value={enEdition.id} />}
            <Field label="Nom">
              <input name="nom" required defaultValue={enEdition?.nom} className={inputClass} placeholder="Ex. Abonnement Confort" />
            </Field>
            <Field label="Catégorie">
              <select name="categorie" className={inputClass} defaultValue={enEdition?.categorie ?? "maintenance"}>
                {Object.entries(CATEGORIE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <ChampsContrat
              checklists={checklists}
              defauts={
                enEdition
                  ? {
                      mode: enEdition.mode,
                      dureeMois: enEdition.dureeMois,
                      nbPassages: enEdition.nbPassages,
                      typeMission: enEdition.typeMission,
                      anticipationJours: enEdition.anticipationJours,
                      checklistModeleId: enEdition.checklistModeleId,
                    }
                  : undefined
              }
            />
            <Field label="Description">
              <textarea name="description" rows={3} defaultValue={enEdition?.description ?? ""} className={inputClass} />
            </Field>
            <Field label="Prix indicatif (€)">
              <input type="number" name="prixIndicatif" step="0.01" min={0} defaultValue={enEdition?.prixIndicatif ?? undefined} className={inputClass} />
            </Field>
            <div className="flex items-center gap-3">
              <Btn>{enEdition ? "Enregistrer" : "Créer la prestation"}</Btn>
              {enEdition && (
                <Link href="/responsable/prestations-catalogue" className="text-sm text-ink-soft font-semibold">
                  Annuler
                </Link>
              )}
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
