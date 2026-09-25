import { Card, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { clients, appareils, projets, sites, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { asc, inArray } from "drizzle-orm";

const TYPES = [
  { value: "global", label: "Rapport global de pilotage (réunion direction)" },
  { value: "maintenance", label: "Rapport Maintenance" },
  { value: "non-conformites", label: "Rapport Non-conformités & Actions correctives" },
  { value: "client", label: "Rapport par Client" },
  { value: "site", label: "Rapport par Site" },
  { value: "appareil", label: "Rapport par Appareil" },
  { value: "technicien", label: "Rapport par Technicien" },
  { value: "projet", label: "Rapport de Projet complet (ISO 9001)" },
  { value: "score-iso", label: "Rapport Score ISO 9001" },
];

export default async function RapportsPage() {
  await requireUser(ROLES_BUREAU);

  const [listeClients, listeAppareils, listeSites, listeTechniciens, listeProjets] = await Promise.all([
    db.select({ id: clients.id, nom: clients.raisonSociale }).from(clients).orderBy(asc(clients.raisonSociale)),
    db
      .select({ id: appareils.id, numeroInterne: appareils.numeroInterne })
      .from(appareils)
      .orderBy(asc(appareils.numeroInterne)),
    db.select({ id: sites.id, adresse: sites.adresse }).from(sites).orderBy(asc(sites.adresse)),
    db
      .select({ id: users.id, nom: users.nom })
      .from(users)
      .where(inArray(users.role, ["technicien", "administrateur"]))
      .orderBy(asc(users.nom)),
    db
      .select({ id: projets.id, reference: projets.reference, titre: projets.titre })
      .from(projets)
      .orderBy(asc(projets.reference)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Générer un rapport</h1>
        <p className="text-sm text-ink-soft">
          Section 10 du cahier des charges — rapport PDF professionnel, prêt pour réunion.
        </p>
      </div>

      <Card className="p-5 max-w-2xl">
        <form action="/api/rapports/pdf" method="get" target="_blank" className="flex flex-col gap-4">
          <Field label="Type de rapport">
            <select name="type" id="type" className={inputClass} defaultValue="global">
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date début (optionnel)">
              <input type="date" name="dateDebut" className={inputClass} />
            </Field>
            <Field label="Date fin (optionnel)">
              <input type="date" name="dateFin" className={inputClass} />
            </Field>
          </div>

          <Field label="Client concerné (rapport « par Client »)">
            <select name="entityIdClient" className={inputClass} defaultValue="">
              <option value="">—</option>
              {listeClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Site concerné (rapport « par Site »)">
            <select name="entityIdSite" className={inputClass} defaultValue="">
              <option value="">—</option>
              {listeSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.adresse}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Appareil concerné (rapport « par Appareil »)">
            <select name="entityIdAppareil" className={inputClass} defaultValue="">
              <option value="">—</option>
              {listeAppareils.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.numeroInterne}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Technicien concerné (rapport « par Technicien »)">
            <select name="entityIdTechnicien" className={inputClass} defaultValue="">
              <option value="">Tous</option>
              {listeTechniciens.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nom}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Projet concerné (rapport « de Projet complet »)">
            <select name="entityIdProjet" className={inputClass} defaultValue="">
              <option value="">—</option>
              {listeProjets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.reference} — {p.titre}
                </option>
              ))}
            </select>
          </Field>

          <p className="text-xs text-ink-soft">
            Selon le type choisi, seul le champ « entité » correspondant est pris en compte — les
            autres sont ignorés à la génération.
          </p>

          {/* Script minimal, sans dépendance : recopie le bon sélecteur d'entité dans
              le paramètre générique `entityId` attendu par la route de génération. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `
                document.currentScript.closest('form').addEventListener('submit', function (e) {
                  var type = this.querySelector('#type').value;
                  var map = { client: 'entityIdClient', site: 'entityIdSite', appareil: 'entityIdAppareil', technicien: 'entityIdTechnicien', projet: 'entityIdProjet' };
                  var champ = map[type];
                  var input = this.querySelector('input[name="entityId"]');
                  if (!input) {
                    input = document.createElement('input');
                    input.type = 'hidden';
                    input.name = 'entityId';
                    this.appendChild(input);
                  }
                  input.value = champ ? (this.querySelector('[name="' + champ + '"]').value || '') : '';
                });
              `,
            }}
          />

          <button
            type="submit"
            className="mt-2 bg-blue hover:bg-blue-light text-white font-display font-bold text-sm rounded-lg py-2.5 transition-colors"
          >
            Générer le PDF
          </button>
        </form>
      </Card>
    </div>
  );
}
