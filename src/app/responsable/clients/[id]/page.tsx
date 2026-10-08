import { Card, Btn, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { appareils, clients, contactsClient, heuresSousTraitance, observateurs, sites, users } from "@/db/schema";
import { Eye } from "lucide-react";
import { MODELES } from "@/lib/observateur";
import { count, desc, eq, sql } from "drizzle-orm";
import { formatMinutes, libelleMois } from "@/lib/sous-traitance";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createContact, createSite, updateClientType } from "../../actions";
import { BoutonEnvoi } from "@/components/bouton-envoi";

const TYPE_LABEL: Record<string, string> = {
  copropriete: "Copropriété",
  entreprise: "Entreprise",
  particulier: "Particulier",
  syndicat: "Syndicat",
  sous_traitance: "Sous-traitance",
};

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) notFound();

  const [contacts, siteRows, observateursClient] = await Promise.all([
    db.select().from(contactsClient).where(eq(contactsClient.clientId, id)),
    db.select().from(sites).where(eq(sites.clientId, id)).orderBy(sites.adresse),
    db
      .select({ id: observateurs.id, nom: users.nom, email: users.email, actif: users.actif, modele: observateurs.modele })
      .from(observateurs)
      .innerJoin(users, eq(observateurs.userId, users.id))
      .where(eq(observateurs.clientId, id)),
  ]);

  // Sous-traitance : historique des heures par mois (12 derniers mois saisis)
  const heuresParMois =
    client.type === "sous_traitance"
      ? await db
          .select({
            mois: sql<string>`to_char(${heuresSousTraitance.dateTravail}, 'YYYY-MM')`,
            minutes: sql<number>`sum(${heuresSousTraitance.minutes})::int`,
            nb: sql<number>`count(*)::int`,
          })
          .from(heuresSousTraitance)
          .where(eq(heuresSousTraitance.clientId, id))
          .groupBy(sql`1`)
          .orderBy(desc(sql`1`))
          .limit(12)
      : [];

  const sitesWithCounts = await Promise.all(
    siteRows.map(async (s) => {
      const [{ n }] = await db.select({ n: count() }).from(appareils).where(eq(appareils.siteId, s.id));
      return { ...s, nbAppareils: Number(n) };
    })
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/responsable/clients" className="text-xs text-blue font-semibold">
          &larr; Clients
        </Link>
        <h1 className="text-2xl font-extrabold font-display mt-1">{client.raisonSociale}</h1>
        <form action={updateClientType} className="flex items-center gap-2 mt-1">
          <input type="hidden" name="clientId" value={client.id} />
          <select name="type" defaultValue={client.type} className="rounded-lg border border-line px-2 py-1 text-sm bg-surface">
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <BoutonEnvoi type="submit" className="text-xs font-semibold text-blue border border-line rounded-lg px-2.5 py-1 hover:bg-blue-pale">
            Changer le type
          </BoutonEnvoi>
        </form>
      </div>

      {client.type === "sous_traitance" && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-sm">Heures de sous-traitance (historique)</h2>
            <Link href={`/responsable/sous-traitance?client=${client.id}`} className="text-xs font-semibold text-blue">
              Voir le détail &rarr;
            </Link>
          </div>
          {heuresParMois.length === 0 ? (
            <p className="text-sm text-ink-soft">Aucune heure déclarée par les techniciens pour ce client.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {heuresParMois.map((r) => (
                <Link
                  key={r.mois}
                  href={`/responsable/sous-traitance?client=${client.id}&mois=${r.mois}`}
                  className="py-2 flex items-center justify-between text-sm hover:bg-blue-pale rounded-lg px-2 -mx-2"
                >
                  <span>{libelleMois(r.mois)}</span>
                  <span className="text-ink-soft text-xs">{r.nb} saisie(s)</span>
                  <span className="font-display font-extrabold tabular">{formatMinutes(r.minutes)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h2 className="font-display font-bold text-sm flex items-center gap-2"><Eye className="w-4 h-4 text-blue" /> Observateurs ({observateursClient.length})</h2>
            <p className="text-xs text-ink-soft">Personnes du client qui suivent leurs ascenseurs en lecture seule (QR code, historique, interventions en cours…).</p>
          </div>
          <Btn href={`/responsable/observateurs/nouveau?client=${client.id}`} variant="ghost" className="!text-xs">
            + Ajouter un observateur
          </Btn>
        </div>
        <div className="flex flex-col divide-y divide-line">
          {observateursClient.map((o) => (
            <Link key={o.id} href={`/responsable/observateurs/${o.id}`} className="py-2.5 flex items-center justify-between gap-3 hover:bg-blue-pale rounded-lg px-2 -mx-2">
              <span className="text-sm">
                <span className="font-semibold">{o.nom}</span> <span className="text-ink-soft">· {o.email}</span>
              </span>
              <span className="text-xs text-ink-soft">{MODELES[o.modele ?? ""]?.label ?? "Personnalisé"}{o.actif !== 1 ? " · accès retiré" : ""}</span>
            </Link>
          ))}
          {observateursClient.length === 0 && <p className="text-sm text-ink-soft py-1">Aucun observateur pour ce client.</p>}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Contacts</h2>
            {contacts.length === 0 && <p className="text-sm text-ink-soft">Aucun contact enregistré.</p>}
            <div className="flex flex-col divide-y divide-line">
              {contacts.map((c) => (
                <div key={c.id} className="py-2.5 text-sm">
                  <span className="font-semibold">{c.nom}</span>
                  {c.fonction && <span className="text-ink-soft"> — {c.fonction}</span>}
                  <div className="text-xs text-ink-soft">
                    {[c.telephone, c.email].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ))}
            </div>
            <form action={createContact} className="flex flex-col gap-2 mt-3 pt-3 border-t border-line">
              <input type="hidden" name="clientId" value={client.id} />
              <div className="grid grid-cols-2 gap-2">
                <input name="nom" required placeholder="Nom du contact" className={inputClass} />
                <input name="fonction" placeholder="Fonction (optionnel)" className={inputClass} />
                <input name="telephone" placeholder="Téléphone" className={inputClass} />
                <input name="email" type="email" placeholder="Email" className={inputClass} />
              </div>
              <Btn variant="ghost" className="self-start text-xs px-3 py-1.5">
                Ajouter ce contact
              </Btn>
            </form>
          </Card>

          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Sites rattachés</h2>
            <div className="flex flex-col divide-y divide-line">
              {sitesWithCounts.map((s) => (
                <Link
                  key={s.id}
                  href={`/responsable/sites/${s.id}`}
                  className="py-3 flex items-center justify-between hover:bg-blue-pale rounded-lg px-2 -mx-2"
                >
                  <div className="text-sm font-medium">{s.adresse}</div>
                  <div className="text-xs text-ink-soft">{s.nbAppareils} appareil(s)</div>
                </Link>
              ))}
              {sitesWithCounts.length === 0 && (
                <p className="text-sm text-ink-soft py-2">Aucun site pour l&apos;instant.</p>
              )}
            </div>
          </Card>
        </div>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">Nouveau site</h2>
          <form action={createSite} className="flex flex-col gap-3">
            <input type="hidden" name="clientId" value={client.id} />
            <Field label="Adresse complète">
              <textarea name="adresse" required rows={2} className={inputClass} />
            </Field>
            <Field label="Instructions d'accès">
              <textarea name="instructionsAcces" rows={2} className={inputClass} />
            </Field>
            <Btn>Créer le site</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
