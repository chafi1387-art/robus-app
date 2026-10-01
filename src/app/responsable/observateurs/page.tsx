import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Eye, Plus } from "lucide-react";
import { db } from "@/db";
import { clients, observateurAppareils, observateurs, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { Btn, Card, Field, Pill, inputClass } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { MODELES, PARAM_TELEPHONE, getParametre } from "@/lib/observateur";
import { enregistrerTelephoneUrgence } from "./actions";

// Phase 18 : tous les observateurs (accès clients en lecture seule).
export default async function ObservateursPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const user = await requireUser(ROLES_BUREAU);
  const { erreur } = await searchParams;
  const nbAppareils = db
    .select({ observateurId: observateurAppareils.observateurId, n: sql<number>`count(*)::int`.as("n") })
    .from(observateurAppareils)
    .groupBy(observateurAppareils.observateurId)
    .as("nb");
  const [rows, telephone] = await Promise.all([
    db
      .select({
        id: observateurs.id,
        nom: users.nom,
        email: users.email,
        actif: users.actif,
        modele: observateurs.modele,
        droits: observateurs.droits,
        dateFin: observateurs.dateFin,
        client: clients.raisonSociale,
        clientId: clients.id,
        appareils: nbAppareils.n,
      })
      .from(observateurs)
      .innerJoin(users, eq(observateurs.userId, users.id))
      .innerJoin(clients, eq(observateurs.clientId, clients.id))
      .leftJoin(nbAppareils, eq(nbAppareils.observateurId, observateurs.id))
      .orderBy(desc(observateurs.createdAt)),
    getParametre(PARAM_TELEPHONE),
  ]);
  const gestion = user.role === "administrateur" || user.role === "responsable_qualite";
  // eslint-disable-next-line react-hooks/purity
  const maintenant = Date.now();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold font-display flex items-center gap-2">
            <Eye className="w-6 h-6 text-blue" /> Observateurs
          </h1>
          <p className="text-sm text-ink-soft">Accès en lecture seule donnés aux clients (syndic, gardien, bureau de contrôle…).</p>
        </div>
        {gestion && (
          <Btn href="/responsable/observateurs/nouveau">
            <Plus className="w-4 h-4" /> Ajouter un observateur
          </Btn>
        )}
      </div>

      <Card className="p-5">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-soft">Aucun observateur pour l&apos;instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="pb-2 pr-3">Observateur</th>
                  <th className="pb-2 pr-3">Client</th>
                  <th className="pb-2 pr-3">Modèle</th>
                  <th className="pb-2 pr-3">Appareils</th>
                  <th className="pb-2 pr-3">Accès</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const expire = r.dateFin && r.dateFin.getTime() <= maintenant;
                  return (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-3">
                        <Link href={`/responsable/observateurs/${r.id}`} className="font-semibold text-blue hover:underline">{r.nom}</Link>
                        <div className="text-xs text-ink-soft">{r.email}</div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <Link href={`/responsable/clients/${r.clientId}`} className="hover:text-blue">{r.client}</Link>
                      </td>
                      <td className="py-2.5 pr-3">{MODELES[r.modele ?? ""]?.label ?? "Personnalisé"}</td>
                      <td className="py-2.5 pr-3 tabular">{r.appareils ?? 0}</td>
                      <td className="py-2.5 pr-3">
                        {r.actif !== 1 ? (
                          <Pill tone="crit">Retiré</Pill>
                        ) : expire ? (
                          <Pill tone="warn">Expiré</Pill>
                        ) : (
                          <Pill tone="ok">{r.dateFin ? `Jusqu'au ${formatDate(r.dateFin)}` : "Actif"}</Pill>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5 max-w-xl">
        <h2 className="font-display font-bold text-sm mb-1">Téléphone d&apos;urgence</h2>
        <p className="text-xs text-ink-soft mb-3">Affiché sur les étiquettes QR et sur la page ouverte en scannant le QR code (bouton « Appeler ROBUS »).</p>
        {erreur === "telephone" && <p className="text-xs text-red-ink mb-2">Numéro invalide.</p>}
        {gestion ? (
          <form action={enregistrerTelephoneUrgence} className="flex items-end gap-2 flex-wrap">
            <Field label="Numéro">
              <input name="telephone" defaultValue={telephone ?? ""} placeholder="+32 2 000 00 00" className={inputClass} />
            </Field>
            <Btn variant="ghost">Enregistrer</Btn>
          </form>
        ) : (
          <p className="text-sm font-semibold">{telephone ?? "Non renseigné"}</p>
        )}
      </Card>
    </div>
  );
}
