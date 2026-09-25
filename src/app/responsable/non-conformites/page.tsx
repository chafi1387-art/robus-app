import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { db } from "@/db";
import { appareils, clients, nonConformites, sites, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { createNonConformite } from "./actions";

const GRAVITE_LABEL: Record<string, string> = {
  mineure: "Mineure",
  majeure: "Majeure",
  critique: "Critique",
};
const GRAVITE_TONE: Record<string, "ok" | "warn" | "crit"> = {
  mineure: "ok",
  majeure: "warn",
  critique: "crit",
};

const STATUT_LABEL: Record<string, string> = {
  ouverte: "Ouverte",
  en_cours: "En cours",
  cloturee: "Clôturée",
};
const STATUT_TONE: Record<string, "ok" | "warn" | "crit"> = {
  ouverte: "crit",
  en_cours: "warn",
  cloturee: "ok",
};

const STATUTS = ["ouverte", "en_cours", "cloturee"] as const;

async function getNonConformites(statut?: string) {
  return db
    .select({
      id: nonConformites.id,
      titre: nonConformites.titre,
      gravite: nonConformites.gravite,
      statut: nonConformites.statut,
      dateEcheance: nonConformites.dateEcheance,
      raisonSociale: clients.raisonSociale,
      adresse: sites.adresse,
      numeroInterne: appareils.numeroInterne,
    })
    .from(nonConformites)
    .leftJoin(clients, eq(nonConformites.clientId, clients.id))
    .leftJoin(sites, eq(nonConformites.siteId, sites.id))
    .leftJoin(appareils, eq(nonConformites.appareilId, appareils.id))
    .where(statut ? and(eq(nonConformites.statut, statut as (typeof STATUTS)[number])) : undefined)
    .orderBy(desc(nonConformites.createdAt));
}

async function getResponsables() {
  return db
    .select({ id: users.id, nom: users.nom })
    .from(users)
    .where(inArray(users.role, ROLES_BUREAU))
    .orderBy(users.nom);
}

export default async function NonConformitesPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  await requireUser(ROLES_BUREAU);
  const { statut } = await searchParams;
  const activeStatut = statut && STATUTS.includes(statut as (typeof STATUTS)[number]) ? statut : undefined;

  const [rows, clientRows, responsables] = await Promise.all([
    getNonConformites(activeStatut),
    db.select({ id: clients.id, raisonSociale: clients.raisonSociale }).from(clients).orderBy(clients.raisonSociale),
    getResponsables(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold font-display">Non-conformités</h1>
          <p className="text-sm text-ink-soft">{rows.length} non-conformité(s)</p>
        </div>
        <Btn href="/api/export/non-conformites" variant="ghost">
          Exporter CSV
        </Btn>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Link
              href="/responsable/non-conformites"
              className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                !activeStatut ? "bg-blue text-white" : "bg-blue-pale text-blue"
              }`}
            >
              Toutes
            </Link>
            {STATUTS.map((s) => (
              <Link
                key={s}
                href={`/responsable/non-conformites?statut=${s}`}
                className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                  activeStatut === s ? "bg-blue text-white" : "bg-blue-pale text-blue"
                }`}
              >
                {STATUT_LABEL[s]}
              </Link>
            ))}
          </div>

          <div className="flex flex-col divide-y divide-line">
            {rows.map((n) => (
              <Link
                key={n.id}
                href={`/responsable/non-conformites/${n.id}`}
                className="py-3 flex items-center justify-between gap-3 hover:bg-blue-pale rounded-lg px-2 -mx-2"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{n.titre}</div>
                  <div className="text-xs text-ink-soft truncate">
                    {[n.raisonSociale, n.adresse, n.numeroInterne].filter(Boolean).join(" · ") ||
                      "Aucun lien"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-ink-soft whitespace-nowrap">
                    Échéance {formatDate(n.dateEcheance)}
                  </span>
                  <Pill tone={GRAVITE_TONE[n.gravite] ?? "neutral"}>{GRAVITE_LABEL[n.gravite] ?? n.gravite}</Pill>
                  <Pill tone={STATUT_TONE[n.statut] ?? "neutral"}>{STATUT_LABEL[n.statut] ?? n.statut}</Pill>
                </div>
              </Link>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucune non-conformité pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">Nouvelle non-conformité</h2>
          <form action={createNonConformite} className="flex flex-col gap-3">
            <Field label="Titre">
              <input name="titre" required className={inputClass} placeholder="Ex. Câble usé..." />
            </Field>
            <Field label="Description">
              <textarea name="description" rows={3} className={inputClass} />
            </Field>
            <Field label="Gravité">
              <select name="gravite" className={inputClass} defaultValue="mineure">
                <option value="mineure">Mineure</option>
                <option value="majeure">Majeure</option>
                <option value="critique">Critique</option>
              </select>
            </Field>
            <Field label="Client (optionnel)">
              <select name="clientId" className={inputClass} defaultValue="">
                <option value="">Aucun</option>
                {clientRows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.raisonSociale}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Site (optionnel, UUID)">
              <input name="siteId" className={inputClass} placeholder="uuid du site" />
            </Field>
            <Field label="Appareil (optionnel, UUID)">
              <input name="appareilId" className={inputClass} placeholder="uuid de l'appareil" />
            </Field>
            <Field label="Intervention (optionnel, UUID)">
              <input name="interventionId" className={inputClass} placeholder="uuid de l'intervention" />
            </Field>
            <Field label="Responsable de l'action">
              <select name="responsableActionId" className={inputClass} defaultValue="">
                <option value="">Non assigné</option>
                {responsables.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nom}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Action corrective">
              <textarea name="actionCorrective" rows={3} className={inputClass} />
            </Field>
            <Field label="Date d'échéance">
              <input type="date" name="dateEcheance" className={inputClass} />
            </Field>
            <Btn>Créer la non-conformité</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
