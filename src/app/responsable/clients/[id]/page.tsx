import { Card, Btn, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { appareils, clients, contactsClient, sites } from "@/db/schema";
import { count, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createContact, createSite } from "../../actions";

const TYPE_LABEL: Record<string, string> = {
  copropriete: "Copropriété",
  entreprise: "Entreprise",
  particulier: "Particulier",
  syndicat: "Syndicat",
};

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) notFound();

  const [contacts, siteRows] = await Promise.all([
    db.select().from(contactsClient).where(eq(contactsClient.clientId, id)),
    db.select().from(sites).where(eq(sites.clientId, id)).orderBy(sites.adresse),
  ]);

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
        <p className="text-sm text-ink-soft">{TYPE_LABEL[client.type] ?? client.type}</p>
      </div>

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
