import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { db } from "@/db";
import { clients, sites, technicienFiches, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { eq } from "drizzle-orm";
import { createTechnicien } from "./actions";
import { getSitesForSelect } from "../actions";

const STATUT_RH_LABEL: Record<string, string> = {
  actif: "Actif",
  en_conge: "En congé",
  arret_maladie: "Arrêt maladie",
  en_formation: "En formation",
  suspendu: "Suspendu",
  sorti_effectifs: "Sorti des effectifs",
};

async function getTechniciensAvecFiche() {
  return db
    .select({
      id: users.id,
      nom: users.nom,
      email: users.email,
      telephone: users.telephone,
      actif: users.actif,
      photoUrl: technicienFiches.photoUrl,
      siteAdresse: sites.adresse,
      clientNom: clients.raisonSociale,
    })
    .from(users)
    .leftJoin(technicienFiches, eq(technicienFiches.technicienId, users.id))
    .leftJoin(sites, eq(sites.id, technicienFiches.siteRattachementId))
    .leftJoin(clients, eq(clients.id, sites.clientId))
    .where(eq(users.role, "technicien"))
    .orderBy(users.nom);
}

export default async function TechniciensPage() {
  const user = await requireUser(ROLES_BUREAU);
  const [rows, sitesOptions] = await Promise.all([getTechniciensAvecFiche(), getSitesForSelect()]);
  const estAdmin = user.role === "administrateur";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Techniciens</h1>
        <p className="text-sm text-ink-soft">{rows.length} technicien(s) — fiche RH complète</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-col divide-y divide-line">
            {rows.map((t) => (
              <a
                key={t.id}
                href={`/responsable/techniciens/${t.id}`}
                className="py-3 flex items-center gap-3 hover:bg-blue-pale/40 -mx-2 px-2 rounded-lg transition-colors"
              >
                {t.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.photoUrl}
                    alt={t.nom}
                    className="w-10 h-10 rounded-full object-cover bg-blue-pale shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue to-navy text-white flex items-center justify-center font-display font-bold text-xs shrink-0">
                    {t.nom
                      .split(" ")
                      .map((p) => p[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{t.nom}</div>
                  <div className="text-xs text-ink-soft truncate">
                    {t.email}
                    {t.siteAdresse ? ` · Rattaché : ${t.clientNom} — ${t.siteAdresse}` : ""}
                  </div>
                </div>
                <Pill tone={t.actif === 1 ? "ok" : "crit"}>
                  {t.actif === 1 ? "Actif" : "Désactivé"}
                </Pill>
              </a>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun technicien pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        {estAdmin && (
          <Card className="p-5 h-fit">
            <h2 className="font-display font-bold text-sm mb-3">Nouveau technicien</h2>
            <form action={createTechnicien} className="flex flex-col gap-3">
              <Field label="Nom complet">
                <input name="nom" required className={inputClass} />
              </Field>
              <Field label="Email">
                <input type="email" name="email" required className={inputClass} />
              </Field>
              <Field label="Mot de passe initial">
                <input
                  type="password"
                  name="password"
                  required
                  minLength={8}
                  className={inputClass}
                  placeholder="8 caractères minimum"
                />
              </Field>
              <Field label="Téléphone">
                <input name="telephone" className={inputClass} />
              </Field>
              <Field label="Date de naissance">
                <input type="date" name="dateNaissance" className={inputClass} />
              </Field>
              <Field label="Contact d'urgence — nom">
                <input name="contactUrgenceNom" className={inputClass} />
              </Field>
              <Field label="Contact d'urgence — téléphone">
                <input name="contactUrgenceTelephone" className={inputClass} />
              </Field>
              <Field label="Site de rattachement (optionnel)">
                <select name="siteRattachementId" className={inputClass} defaultValue="">
                  <option value="">Aucun</option>
                  {sitesOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.raisonSociale} — {s.adresse}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date d'entrée dans l'entreprise">
                <input type="date" name="dateEntreeEntreprise" className={inputClass} />
              </Field>
              <Field label="Type de contrat">
                <input
                  name="typeContrat"
                  className={inputClass}
                  placeholder="CDI, CDD, intérimaire..."
                />
              </Field>
              <Field label="Adresse du domicile">
                <textarea name="adresseDomicile" rows={2} className={inputClass} />
              </Field>
              <Field label="Statut RH">
                <select name="statutRh" className={inputClass} defaultValue="actif">
                  {Object.entries(STATUT_RH_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Btn>Créer le technicien</Btn>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
