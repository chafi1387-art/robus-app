import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { db } from "@/db";
import { clients, garanties, projets } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { createProjet } from "./actions";
import { getClientsForSelect } from "../actions";

const STATUT_LABEL: Record<string, string> = {
  cree: "Créé",
  planifie: "Planifié",
  en_cours: "En cours",
  termine: "Terminé",
  valide_iso: "Validé ISO",
};
const STATUT_TONE: Record<string, "ok" | "warn" | "crit" | "neutral"> = {
  cree: "neutral",
  planifie: "neutral",
  en_cours: "warn",
  termine: "ok",
  valide_iso: "ok",
};

export default async function ProjetsPage() {
  await requireUser(ROLES_BUREAU);

  const [rows, clientsOptions] = await Promise.all([
    db
      .select({
        id: projets.id,
        reference: projets.reference,
        titre: projets.titre,
        statut: projets.statut,
        clientNom: clients.raisonSociale,
        aGarantie: garanties.id,
      })
      .from(projets)
      .innerJoin(clients, eq(projets.clientId, clients.id))
      .leftJoin(garanties, eq(garanties.projetId, projets.id))
      .orderBy(desc(projets.createdAt)),
    getClientsForSelect(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Projets</h1>
        <p className="text-sm text-ink-soft">
          {rows.length} projet(s) — le centre de contrôle qui relie Client, Appareil(s),
          Prestation(s) et Technicien(s)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-col divide-y divide-line">
            {rows.map((p) => (
              <Link
                key={p.id}
                href={`/responsable/projets/${p.id}`}
                className="py-3 flex items-center justify-between gap-3 hover:bg-blue-pale/40 -mx-2 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">
                    {p.reference} — {p.titre}
                  </div>
                  <div className="text-xs text-ink-soft truncate">{p.clientNom}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.aGarantie && <Pill tone="ok">Garantie</Pill>}
                  <Pill tone={STATUT_TONE[p.statut] ?? "neutral"}>
                    {STATUT_LABEL[p.statut] ?? p.statut}
                  </Pill>
                </div>
              </Link>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun projet pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">Nouveau projet</h2>
          <form action={createProjet} className="flex flex-col gap-3">
            <Field label="Client">
              <select name="clientId" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Choisir un client
                </option>
                {clientsOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.raisonSociale}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Titre">
              <input name="titre" required className={inputClass} placeholder="Ex. Installation ascenseur bloc B" />
            </Field>
            <Field label="Description">
              <textarea name="description" rows={3} className={inputClass} />
            </Field>
            <Field label="Adresse d'intervention">
              <textarea
                name="adresse"
                required
                rows={2}
                className={inputClass}
                placeholder="Adresse du chantier / de l'immeuble..."
              />
            </Field>
            <Field label="Instructions d'accès (optionnel)">
              <textarea name="instructionsAcces" rows={2} className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Contact sur place — nom">
                <input name="contactNom" className={inputClass} />
              </Field>
              <Field label="Contact sur place — téléphone">
                <input name="contactTelephone" className={inputClass} />
              </Field>
            </div>
            <Field label="Date de début prévue">
              <input type="date" name="dateDebutPrevue" className={inputClass} />
            </Field>
            <Field label="Date de fin prévue">
              <input type="date" name="dateFinPrevue" className={inputClass} />
            </Field>
            <Btn>Créer le projet</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
