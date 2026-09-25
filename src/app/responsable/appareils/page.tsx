import { Card, Btn, Field, inputClass, StatutAppareilPill } from "@/components/ui";
import { db } from "@/db";
import { appareils, clients, projetAppareils, projets } from "@/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { createAppareil } from "../actions";

const STATUTS = [
  "en_service",
  "sous_surveillance",
  "en_panne",
  "hors_service",
  "en_travaux",
  "installation",
] as const;

const STATUT_LABEL: Record<(typeof STATUTS)[number], string> = {
  en_service: "En service",
  sous_surveillance: "Sous surveillance",
  en_panne: "En panne",
  hors_service: "Hors service",
  en_travaux: "En travaux",
  installation: "Installation",
};

export default async function AppareilsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  const { statut } = await searchParams;
  const activeStatut = statut && STATUTS.includes(statut as (typeof STATUTS)[number]) ? statut : undefined;

  const [allRows, projetsParAppareilRows] = await Promise.all([
    db
      .select({
        id: appareils.id,
        numeroInterne: appareils.numeroInterne,
        marque: appareils.marque,
        modele: appareils.modele,
        statut: appareils.statut,
      })
      .from(appareils)
      .orderBy(appareils.numeroInterne),
    // Phase 6 : un appareil se rattache à un Client via un ou plusieurs
    // Projets (many-to-many) — plus de Site/Client legacy directs à afficher.
    db
      .select({
        appareilId: projetAppareils.appareilId,
        reference: projets.reference,
        titre: projets.titre,
        clientNom: clients.raisonSociale,
      })
      .from(projetAppareils)
      .innerJoin(projets, eq(projetAppareils.projetId, projets.id))
      .innerJoin(clients, eq(projets.clientId, clients.id)),
  ]);

  const projetsParAppareil = new Map<string, { reference: string; titre: string; clientNom: string }[]>();
  for (const p of projetsParAppareilRows) {
    const liste = projetsParAppareil.get(p.appareilId) ?? [];
    liste.push({ reference: p.reference, titre: p.titre, clientNom: p.clientNom });
    projetsParAppareil.set(p.appareilId, liste);
  }

  const rows = activeStatut ? allRows.filter((a) => a.statut === activeStatut) : allRows;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold font-display">Appareils</h1>
          <p className="text-sm text-ink-soft">{rows.length} appareil(s) enregistré(s)</p>
        </div>
        <Btn href="/api/export/appareils" variant="ghost">
          Exporter CSV
        </Btn>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Link
              href="/responsable/appareils"
              className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                !activeStatut ? "bg-blue text-white" : "bg-blue-pale text-blue"
              }`}
            >
              Tous
            </Link>
            {STATUTS.map((s) => (
              <Link
                key={s}
                href={`/responsable/appareils?statut=${s}`}
                className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                  activeStatut === s ? "bg-blue text-white" : "bg-blue-pale text-blue"
                }`}
              >
                {STATUT_LABEL[s]}
              </Link>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="pb-2 pr-3">N° interne</th>
                  <th className="pb-2 pr-3">Marque / Modèle</th>
                  <th className="pb-2 pr-3">Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const projetsAppareil = projetsParAppareil.get(a.id) ?? [];
                  return (
                    <tr key={a.id} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-3">
                        <Link href={`/responsable/appareils/${a.id}`} className="font-semibold text-blue">
                          {a.numeroInterne}
                        </Link>
                        <div className="text-xs text-ink-soft mt-0.5">
                          {projetsAppareil.length > 0
                            ? projetsAppareil
                                .map((p) => `${p.reference} — ${p.titre} (${p.clientNom})`)
                                .join(", ")
                            : "Sans projet"}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">{[a.marque, a.modele].filter(Boolean).join(" ") || "—"}</td>
                      <td className="py-2.5 pr-3">
                        <StatutAppareilPill statut={a.statut} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun appareil pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">Nouvel appareil</h2>
          <p className="text-xs text-ink-soft mb-3">
            Un appareil se crée seul, avec ses seules caractéristiques techniques — il se
            rattache ensuite à un Client via un Projet.
          </p>
          <form action={createAppareil} className="flex flex-col gap-3">
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
