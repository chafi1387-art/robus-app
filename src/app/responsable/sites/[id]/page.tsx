import { Card, Btn, Field, inputClass, StatutAppareilPill } from "@/components/ui";
import { db } from "@/db";
import { appareils, clients, sites } from "@/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAppareil } from "../../actions";

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [row] = await db
    .select({ site: sites, client: clients })
    .from(sites)
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .where(eq(sites.id, id))
    .limit(1);
  if (!row) notFound();
  const { site, client } = row;

  const appareilRows = await db.select().from(appareils).where(eq(appareils.siteId, id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/responsable/clients/${client.id}`} className="text-xs text-blue font-semibold">
          &larr; {client.raisonSociale}
        </Link>
        <h1 className="text-2xl font-extrabold font-display mt-1">{site.adresse}</h1>
        {site.instructionsAcces && (
          <p className="text-sm text-ink-soft mt-1">{site.instructionsAcces}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display font-bold text-sm mb-3">Appareils présents sur ce site</h2>
          <div className="flex flex-col divide-y divide-line">
            {appareilRows.map((a) => (
              <Link
                key={a.id}
                href={`/responsable/appareils/${a.id}`}
                className="py-3 flex items-center justify-between hover:bg-blue-pale rounded-lg px-2 -mx-2"
              >
                <div>
                  <div className="text-sm font-semibold">{a.numeroInterne}</div>
                  <div className="text-xs text-ink-soft">
                    {[a.marque, a.modele].filter(Boolean).join(" ")}
                  </div>
                </div>
                <StatutAppareilPill statut={a.statut} />
              </Link>
            ))}
            {appareilRows.length === 0 && (
              <p className="text-sm text-ink-soft py-2">Aucun appareil pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">Nouvel appareil</h2>
          <form action={createAppareil} className="flex flex-col gap-3">
            <input type="hidden" name="siteId" value={site.id} />
            <Field label="N° unique interne Robus">
              <input name="numeroInterne" required className={inputClass} placeholder="A-1042" />
            </Field>
            <Field label="Marque">
              <input name="marque" className={inputClass} placeholder="OTIS, Schindler, Kone..." />
            </Field>
            <Field label="Modèle">
              <input name="modele" className={inputClass} />
            </Field>
            <Field label="N° de série constructeur">
              <input name="numeroSerie" className={inputClass} />
            </Field>
            <Field label="Type d'appareil">
              <input name="typeAppareil" className={inputClass} placeholder="Traction, hydraulique..." />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Charge (kg)">
                <input name="charge" type="number" step="0.01" className={inputClass} />
              </Field>
              <Field label="Vitesse (m/s)">
                <input name="vitesse" type="number" step="0.01" className={inputClass} />
              </Field>
              <Field label="Niveaux">
                <input name="niveaux" type="number" className={inputClass} />
              </Field>
              <Field label="Année d'installation">
                <input name="anneeInstallation" type="number" className={inputClass} />
              </Field>
            </div>
            <Field label="Type de portes">
              <input name="typePortes" className={inputClass} placeholder="Automatiques, manuelles..." />
            </Field>
            <Field label="Statut">
              <select name="statut" className={inputClass} defaultValue="en_service">
                <option value="en_service">En service</option>
                <option value="sous_surveillance">Sous surveillance</option>
                <option value="en_panne">En panne</option>
                <option value="hors_service">Hors service</option>
                <option value="en_travaux">En travaux</option>
                <option value="installation">Installation (projet sur plan)</option>
              </select>
            </Field>
            <Btn>Créer l&apos;appareil</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
