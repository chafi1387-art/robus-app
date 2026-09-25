import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { db } from "@/db";
import { appareils, clients, interventions, nonConformites, sites, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatDateTime } from "@/lib/format";
import { updateActionCorrective, updateNonConformiteStatut } from "../actions";

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

const STATUT_SUIVANT: Record<string, { value: string; label: string } | undefined> = {
  ouverte: { value: "en_cours", label: "Passer en cours" },
  en_cours: { value: "cloturee", label: "Clôturer" },
};

export default async function NonConformiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser(ROLES_BUREAU);
  const { id } = await params;

  const [row] = await db
    .select({
      nc: nonConformites,
      client: clients,
      site: sites,
      appareil: appareils,
      intervention: interventions,
    })
    .from(nonConformites)
    .leftJoin(clients, eq(nonConformites.clientId, clients.id))
    .leftJoin(sites, eq(nonConformites.siteId, sites.id))
    .leftJoin(appareils, eq(nonConformites.appareilId, appareils.id))
    .leftJoin(interventions, eq(nonConformites.interventionId, interventions.id))
    .where(eq(nonConformites.id, id))
    .limit(1);
  if (!row) notFound();
  const { nc, client, site, appareil, intervention } = row;

  const [declarant, responsableAction] = await Promise.all([
    nc.declarantId
      ? db.select({ nom: users.nom }).from(users).where(eq(users.id, nc.declarantId)).limit(1)
      : Promise.resolve([]),
    nc.responsableActionId
      ? db.select({ nom: users.nom }).from(users).where(eq(users.id, nc.responsableActionId)).limit(1)
      : Promise.resolve([]),
  ]);

  const prochainStatut = STATUT_SUIVANT[nc.statut];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/responsable/non-conformites" className="text-xs text-blue font-semibold">
          &larr; Non-conformités
        </Link>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h1 className="text-2xl font-extrabold font-display">{nc.titre}</h1>
          <Pill tone={GRAVITE_TONE[nc.gravite] ?? "neutral"}>{GRAVITE_LABEL[nc.gravite] ?? nc.gravite}</Pill>
          <Pill tone={STATUT_TONE[nc.statut] ?? "neutral"}>{STATUT_LABEL[nc.statut] ?? nc.statut}</Pill>
        </div>
        <p className="text-sm text-ink-soft">Déclarée le {formatDateTime(nc.createdAt)}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Détails</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <InfoRow label="Description" value={nc.description} full />
              <InfoRow
                label="Client"
                value={
                  client ? (
                    <Link href={`/responsable/clients/${client.id}`} className="text-blue font-semibold">
                      {client.raisonSociale}
                    </Link>
                  ) : undefined
                }
              />
              <InfoRow label="Site" value={site?.adresse} />
              <InfoRow
                label="Appareil"
                value={
                  appareil ? (
                    <Link href={`/responsable/appareils/${appareil.id}`} className="text-blue font-semibold">
                      {appareil.numeroInterne}
                    </Link>
                  ) : undefined
                }
              />
              <InfoRow label="Intervention" value={intervention ? intervention.id : undefined} />
              <InfoRow label="Déclarant" value={declarant[0]?.nom} />
              <InfoRow label="Responsable de l'action" value={responsableAction[0]?.nom} />
              <InfoRow label="Date d'échéance" value={formatDate(nc.dateEcheance)} />
              <InfoRow label="Date de clôture" value={formatDate(nc.dateCloture)} />
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Action corrective</h2>
            <form action={updateActionCorrective} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={nc.id} />
              <Field label="Action corrective">
                <textarea
                  name="actionCorrective"
                  rows={4}
                  className={inputClass}
                  defaultValue={nc.actionCorrective ?? ""}
                />
              </Field>
              <Btn>Enregistrer l&apos;action corrective</Btn>
            </form>
          </Card>
        </div>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">Statut</h2>
          <p className="text-sm text-ink-soft mb-3">
            Statut actuel : <Pill tone={STATUT_TONE[nc.statut] ?? "neutral"}>{STATUT_LABEL[nc.statut] ?? nc.statut}</Pill>
          </p>
          {prochainStatut ? (
            <form action={updateNonConformiteStatut} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={nc.id} />
              <input type="hidden" name="statut" value={prochainStatut.value} />
              <Btn>{prochainStatut.label}</Btn>
            </form>
          ) : (
            <p className="text-sm text-ink-soft">Cette non-conformité est clôturée.</p>
          )}

          {nc.statut !== "ouverte" && (
            <form action={updateNonConformiteStatut} className="mt-3">
              <input type="hidden" name="id" value={nc.id} />
              <input type="hidden" name="statut" value="ouverte" />
              <Btn variant="ghost" className="w-full justify-center">
                Rouvrir
              </Btn>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  full = false,
}: {
  label: string;
  value?: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "col-span-2" : undefined}>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}
