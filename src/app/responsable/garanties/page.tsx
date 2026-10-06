import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { db } from "@/db";
import { clients, garanties, garantieFormules, projets } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { FrisePassages } from "@/components/frise-passages";
import { passagesDeGaranties } from "@/lib/garantie-passages";
import { formatDate } from "@/lib/format";
import { createGarantieFormule, toggleGarantieFormuleActive, updateGarantieFormule } from "./actions";

const JOURS_ALERTE_ECHEANCE = 60;

export default async function GarantiesPage({ searchParams }: { searchParams: Promise<{ modifier?: string }> }) {
  await requireUser(ROLES_BUREAU);
  const { modifier } = await searchParams;

  const [formules, garantiesActives] = await Promise.all([
    db.select().from(garantieFormules).orderBy(garantieFormules.nom),
    db
      .select({
        garantie: garanties,
        formuleNom: garantieFormules.nom,
        projetId: projets.id,
        projetReference: projets.reference,
        projetTitre: projets.titre,
        clientNom: clients.raisonSociale,
      })
      .from(garanties)
      .innerJoin(projets, eq(garanties.projetId, projets.id))
      .innerJoin(clients, eq(projets.clientId, clients.id))
      .leftJoin(garantieFormules, eq(garanties.formuleId, garantieFormules.id))
      .orderBy(desc(garanties.createdAt)),
  ]);

  const passages = await passagesDeGaranties(garantiesActives.map((g) => g.garantie.id));
  const enEdition = formules.find((f) => f.id === modifier) ?? null;
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const seuilAlerte = now + JOURS_ALERTE_ECHEANCE * 24 * 60 * 60 * 1000;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Garanties</h1>
        <p className="text-sm text-ink-soft">
          Formules de garantie et suivi des garanties actives, tous projets confondus.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display font-bold text-sm mb-3">
            Garanties actives ({garantiesActives.length})
          </h2>
          <div className="flex flex-col divide-y divide-line">
            {garantiesActives.map((g) => {
              const echeance = new Date(g.garantie.dateFin).getTime();
              let pill: React.ReactNode;
              if (echeance < now) {
                pill = <Pill tone="crit">Expirée le {formatDate(g.garantie.dateFin)}</Pill>;
              } else if (echeance <= seuilAlerte) {
                pill = <Pill tone="warn">Échéance le {formatDate(g.garantie.dateFin)}</Pill>;
              } else {
                pill = <Pill tone="ok">Valide jusqu&apos;au {formatDate(g.garantie.dateFin)}</Pill>;
              }
              return (
                <div key={g.garantie.id} className="py-1">
                <Link
                  href={`/responsable/projets/${g.projetId}`}
                  className="py-3 flex items-center justify-between gap-3 hover:bg-blue-pale/40 -mx-2 px-2 rounded-lg"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {g.projetReference} — {g.projetTitre}
                    </div>
                    <div className="text-xs text-ink-soft truncate">
                      {g.clientNom} · {g.formuleNom ?? "Formule supprimée"} ·{" "}
                      {g.garantie.interventionsRestantes}/{g.garantie.interventionsIncluses} visite(s)
                      restante(s)
                    </div>
                  </div>
                  {pill}
                </Link>
                <div className="pb-3 pt-1">
                  <FrisePassages passages={passages.filter((p) => p.garantieId === g.garantie.id)} />
                </div>
                </div>
              );
            })}
            {garantiesActives.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucune garantie attribuée pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5 h-fit" id="formule">
          <h2 className="font-display font-bold text-sm mb-3">{enEdition ? "Modifier la formule" : "Nouvelle formule"}</h2>
          {enEdition && (
            <p className="text-xs text-ink-soft mb-3">
              Les garanties déjà attribuées gardent leur durée et leurs passages ; la correction s&apos;applique aux prochaines.
            </p>
          )}
          <form key={enEdition?.id ?? "nouvelle"} action={enEdition ? updateGarantieFormule : createGarantieFormule} className="flex flex-col gap-3">
            {enEdition && <input type="hidden" name="id" value={enEdition.id} />}
            <Field label="Nom">
              <input name="nom" required defaultValue={enEdition?.nom} className={inputClass} placeholder="Ex. Sérénité 2 ans" />
            </Field>
            <Field label="Durée (mois)">
              <input type="number" name="dureeMois" min={1} required defaultValue={enEdition?.dureeMois} className={inputClass} />
            </Field>
            <Field label="Nombre d'interventions incluses (total sur la durée)">
              <input
                type="number"
                name="nombreInterventionsInclues"
                min={0}
                required
                defaultValue={enEdition?.nombreInterventionsInclues}
                className={inputClass}
              />
            </Field>
            <Field label="Prix (€)">
              <input type="number" name="prix" step="0.01" min={0} required defaultValue={enEdition?.prix} className={inputClass} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="optionExtensionDisponible" defaultChecked={enEdition?.optionExtensionDisponible === 1} className="rounded" />
              Option d&apos;extension disponible
            </label>
            <Field label="Prix de l'extension (€, si disponible)">
              <input type="number" name="prixExtension" step="0.01" min={0} defaultValue={enEdition?.prixExtension ?? undefined} className={inputClass} />
            </Field>
            <div className="flex items-center gap-3">
              <Btn>{enEdition ? "Enregistrer" : "Créer la formule"}</Btn>
              {enEdition && (
                <Link href="/responsable/garanties" className="text-sm text-ink-soft font-semibold">Annuler</Link>
              )}
            </div>
          </form>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-display font-bold text-sm mb-3">Formules ({formules.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                <th className="pb-2 pr-3">Nom</th>
                <th className="pb-2 pr-3">Durée</th>
                <th className="pb-2 pr-3">Interventions incluses</th>
                <th className="pb-2 pr-3">Prix</th>
                <th className="pb-2 pr-3">Extension</th>
                <th className="pb-2 pr-3">Statut</th>
                <th className="pb-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {formules.map((f) => (
                <tr key={f.id} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-3 font-medium">{f.nom}</td>
                  <td className="py-2.5 pr-3 text-ink-soft">{f.dureeMois} mois</td>
                  <td className="py-2.5 pr-3 text-ink-soft">{f.nombreInterventionsInclues}</td>
                  <td className="py-2.5 pr-3 text-ink-soft">{f.prix} €</td>
                  <td className="py-2.5 pr-3 text-ink-soft">
                    {f.optionExtensionDisponible === 1
                      ? `Oui${f.prixExtension ? ` (${f.prixExtension} €)` : ""}`
                      : "Non"}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Pill tone={f.actif === 1 ? "ok" : "neutral"}>
                      {f.actif === 1 ? "Active" : "Désactivée"}
                    </Pill>
                  </td>
                  <td className="py-2.5 pr-3 flex items-center gap-1">
                    <Link
                      href={`/responsable/garanties?modifier=${f.id}#formule`}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-blue-pale"
                    >
                      Modifier
                    </Link>
                    <form action={toggleGarantieFormuleActive}>
                      <input type="hidden" name="id" value={f.id} />
                      <Btn type="submit" variant="ghost" className="!px-3 !py-1.5 !text-xs">
                        {f.actif === 1 ? "Désactiver" : "Réactiver"}
                      </Btn>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {formules.length === 0 && (
            <p className="text-sm text-ink-soft py-3">Aucune formule créée pour l&apos;instant.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
