import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { Card, Field, inputClass, Btn } from "@/components/ui";
import { FormulaireObservateur } from "@/components/formulaire-observateur";
import { DROITS, MODELES, getAppareilsDuClient } from "@/lib/observateur";
import { creerObservateur } from "../actions";

export default async function NouvelObservateurPage({ searchParams }: { searchParams: Promise<{ client?: string; erreur?: string }> }) {
  await requireUser(["administrateur", "responsable_qualite"]);
  const { client: clientId, erreur } = await searchParams;
  const valide = !!clientId && /^[0-9a-f-]{36}$/i.test(clientId);
  const [client] = valide ? await db.select().from(clients).where(eq(clients.id, clientId!)).limit(1) : [];

  if (!client) {
    const liste = await db.select({ id: clients.id, nom: clients.raisonSociale }).from(clients).orderBy(asc(clients.raisonSociale));
    return (
      <div className="flex flex-col gap-4 max-w-xl">
        <Link href="/responsable/observateurs" className="text-xs text-blue font-semibold">&larr; Observateurs</Link>
        <h1 className="text-2xl font-extrabold font-display">Nouvel observateur</h1>
        <Card className="p-5">
          <form className="flex items-end gap-2 flex-wrap">
            <Field label="Pour quel client ?">
              <select name="client" required className={inputClass} defaultValue="">
                <option value="" disabled>Choisir un client</option>
                {liste.map((c) => (
                  <option key={c.id} value={c.id}>{c.nom}</option>
                ))}
              </select>
            </Field>
            <Btn>Continuer</Btn>
          </form>
        </Card>
      </div>
    );
  }

  const appareils = await getAppareilsDuClient(client.id);
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/responsable/clients/${client.id}`} className="text-xs text-blue font-semibold">&larr; {client.raisonSociale}</Link>
      <div>
        <h1 className="text-2xl font-extrabold font-display">Nouvel observateur</h1>
        <p className="text-sm text-ink-soft">Client : <span className="font-semibold text-ink">{client.raisonSociale}</span>. Il recevra un email pour créer son mot de passe.</p>
      </div>
      {erreur && <div className="text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">{erreur}</div>}
      <Card className="p-5">
        <FormulaireObservateur
          action={creerObservateur}
          droits={DROITS.map((d) => ({ id: d.id, label: d.label, aide: d.aide }))}
          modeles={Object.fromEntries(Object.entries(MODELES).map(([k, v]) => [k, { label: v.label, droits: [...v.droits], joursAcces: v.joursAcces }]))}
          appareils={appareils.map((a) => ({ id: a.id, numeroInterne: a.numeroInterne, adresse: a.adresse, marque: a.marque }))}
          clientId={client.id}
          initial={{ modele: "syndic", droits: [...MODELES.syndic.droits], appareilIds: appareils.map((a) => a.id), dateFin: "", histo12: false }}
          creation
        />
      </Card>
    </div>
  );
}
