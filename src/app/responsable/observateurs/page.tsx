import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Eye, Plus } from "lucide-react";
import { db } from "@/db";
import { clients, observateurAppareils, observateurs, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { Btn, Card, Field, Pill, inputClass } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { MODELES, PARAM_TELEPHONE, getParametre } from "@/lib/observateur";
import { enregistrerParametresClient } from "./actions";
import {
  PARAM_CONTACT_EMAIL,
  PARAM_CONTACT_NOM,
  PARAM_CONTACT_TEL,
  PARAM_DELAI_AUTRE_H,
  PARAM_DELAI_PANNE_MIN,
  PARAM_EMAILS_ALERTES,
  PARAM_RESUME_MENSUEL,
} from "@/lib/demandes";

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
  const [emails, delaiPanne, delaiAutre, resume, contactNom, contactTel, contactEmail, defaut] = await Promise.all([
    getParametre(PARAM_EMAILS_ALERTES),
    getParametre(PARAM_DELAI_PANNE_MIN),
    getParametre(PARAM_DELAI_AUTRE_H),
    getParametre(PARAM_RESUME_MENSUEL),
    getParametre(PARAM_CONTACT_NOM),
    getParametre(PARAM_CONTACT_TEL),
    getParametre(PARAM_CONTACT_EMAIL),
    db.select({ email: users.email }).from(users).where(and(inArray(users.role, ["administrateur", "responsable_qualite"]), eq(users.actif, 1))),
  ]);
  const param = { emails, delaiPanne, delaiAutre, resume, contactNom, contactTel, contactEmail };
  const destinatairesParDefaut = defaut.map((u) => u.email).join(", ");
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

      <Card className="p-5">
        <h2 className="font-display font-bold text-sm mb-1">Relation client — paramètres</h2>
        <p className="text-xs text-ink-soft mb-4">Alertes des demandes clients (pannes…), délais de prise en charge, contact affiché au client, résumé mensuel.</p>
        {erreur === "telephone" && <p className="text-xs text-red-ink mb-2">Numéro invalide.</p>}
        {gestion ? (
          <form action={enregistrerParametresClient} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Field label="Emails qui reçoivent les alertes (pannes, demandes) — séparés par des virgules">
                <input name="emailsAlertes" defaultValue={param.emails ?? ""} placeholder={`Vide = administrateurs et responsables qualité (${destinatairesParDefaut})`} className={inputClass} />
              </Field>
            </div>
            <Field label="Délai de prise en charge d'une panne (minutes)">
              <input name="delaiPanne" type="number" min={5} max={1440} defaultValue={param.delaiPanne ?? "30"} className={inputClass} />
            </Field>
            <Field label="Délai pour les autres demandes (heures ouvrées)">
              <input name="delaiAutre" type="number" min={1} max={240} defaultValue={param.delaiAutre ?? "24"} className={inputClass} />
            </Field>
            <Field label="Téléphone d'urgence (étiquettes QR)">
              <input name="telephone" defaultValue={telephone ?? ""} placeholder="+32 2 000 00 00" className={inputClass} />
            </Field>
            <Field label="Contact affiché au client — nom">
              <input name="contactNom" defaultValue={param.contactNom ?? ""} placeholder="Ex. Service client ROBUS" className={inputClass} />
            </Field>
            <Field label="Contact — téléphone">
              <input name="contactTelephone" defaultValue={param.contactTel ?? ""} className={inputClass} />
            </Field>
            <Field label="Contact — email">
              <input name="contactEmail" type="email" defaultValue={param.contactEmail ?? ""} className={inputClass} />
            </Field>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" name="resumeMensuel" defaultChecked={param.resume !== "0"} /> Envoyer un résumé mensuel par email aux observateurs (le 1er du mois ; chacun peut le désactiver)
            </label>
            <div className="md:col-span-2">
              <Btn>Enregistrer</Btn>
            </div>
          </form>
        ) : (
          <p className="text-sm">Alertes : {param.emails || destinatairesParDefaut}</p>
        )}
      </Card>
    </div>
  );
}
