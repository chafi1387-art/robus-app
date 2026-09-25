import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser, Role } from "@/lib/auth-helpers";
import { createUser, resetUserPassword, toggleUserActive } from "./actions";

const ROLES_ADMIN_ONLY: Role[] = ["administrateur"];

const ROLE_LABEL: Record<string, string> = {
  administrateur: "Administrateur",
  responsable_qualite: "Responsable Qualité",
  technicien: "Technicien",
  commercial: "Commercial",
};

async function getUsers() {
  return db
    .select({
      id: users.id,
      nom: users.nom,
      email: users.email,
      role: users.role,
      actif: users.actif,
    })
    .from(users)
    .orderBy(users.nom);
}

export default async function UtilisateursPage() {
  const currentUser = await requireUser(ROLES_ADMIN_ONLY);
  const rows = await getUsers();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold font-display">Gestion des utilisateurs</h1>
          <p className="text-sm text-ink-soft">{rows.length} utilisateur(s) enregistré(s)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-col divide-y divide-line">
            {rows.map((u) => (
              <div key={u.id} className="py-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-sm">
                      {u.nom}
                      {u.id === currentUser.id && (
                        <span className="ml-2 text-xs text-ink-soft font-normal">(vous)</span>
                      )}
                    </div>
                    <div className="text-xs text-ink-soft">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Pill tone="neutral">{ROLE_LABEL[u.role] ?? u.role}</Pill>
                    <Pill tone={u.actif === 1 ? "ok" : "crit"}>
                      {u.actif === 1 ? "Actif" : "Désactivé"}
                    </Pill>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {u.id !== currentUser.id && (
                    <form action={toggleUserActive}>
                      <input type="hidden" name="userId" value={u.id} />
                      <Btn type="submit" variant="ghost" className="!px-3 !py-1.5 !text-xs">
                        {u.actif === 1 ? "Désactiver" : "Réactiver"}
                      </Btn>
                    </form>
                  )}

                  <details className="group">
                    <summary className="list-none cursor-pointer inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold font-display bg-transparent border border-line text-ink hover:bg-blue-pale hover:border-blue-pale transition-colors">
                      Réinitialiser le mot de passe
                    </summary>
                    <form
                      action={resetUserPassword}
                      className="mt-2 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="userId" value={u.id} />
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                          Nouveau mot de passe
                        </span>
                        <input
                          type="password"
                          name="password"
                          required
                          minLength={8}
                          className={`${inputClass} max-w-xs`}
                          placeholder="8 caractères minimum"
                        />
                      </div>
                      <Btn type="submit" variant="primary" className="!px-3 !py-1.5 !text-xs">
                        Valider
                      </Btn>
                    </form>
                  </details>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun utilisateur pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Nouvel utilisateur</h2>
          <form action={createUser} className="flex flex-col gap-3">
            <Field label="Nom">
              <input name="nom" required className={inputClass} placeholder="Nom complet" />
            </Field>
            <Field label="Email">
              <input
                type="email"
                name="email"
                required
                className={inputClass}
                placeholder="nom@robus.fr"
              />
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
            <Field label="Rôle">
              <select name="role" className={inputClass} defaultValue="technicien">
                <option value="administrateur">Administrateur</option>
                <option value="responsable_qualite">Responsable Qualité</option>
                <option value="technicien">Technicien</option>
                <option value="commercial">Commercial</option>
              </select>
            </Field>
            <Btn>Créer l&apos;utilisateur</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
