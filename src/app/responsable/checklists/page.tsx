import { Card, Btn, Field, inputClass, Pill } from "@/components/ui";
import { db } from "@/db";
import { checklistModeles } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { desc, sql } from "drizzle-orm";
import Link from "next/link";
import { createChecklistModele, toggleChecklistModeleActif } from "./actions";

const TYPE_INTERVENTION_LABEL: Record<string, string> = {
  preventive: "Préventive",
  corrective: "Corrective",
  systematique: "Systématique",
};

// Phase 23 : une seule requête (avant : une par modèle) + nombre de missions.
async function getModeles() {
  return db
    .select({
      id: checklistModeles.id,
      nom: checklistModeles.nom,
      typeIntervention: checklistModeles.typeIntervention,
      marque: checklistModeles.marque,
      typeAppareil: checklistModeles.typeAppareil,
      actif: checklistModeles.actif,
      version: checklistModeles.version,
      nbItems: sql<number>`(select count(*)::int from checklist_items i where i.modele_id = "checklist_modeles"."id" and i.actif = 1)`,
      nbMissions: sql<number>`(select count(*)::int from mission_checklists mc where mc.modele_id = "checklist_modeles"."id")`,
    })
    .from(checklistModeles)
    .orderBy(desc(checklistModeles.actif), checklistModeles.nom);
}

export default async function ChecklistsPage() {
  await requireUser(ROLES_BUREAU);
  const rows = await getModeles();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Checklists</h1>
        <p className="text-sm text-ink-soft">
          {rows.length} modèle(s). Vous choisissez les checklists en créant la mission (sinon la plus adaptée est ajoutée automatiquement selon le type de mission,
          la marque et le type d&apos;appareil). Le technicien les voit dès réception de l&apos;ordre et les coche pendant l&apos;intervention : ✓ conforme, ✗ non conforme avec un commentaire.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-col divide-y divide-line">
            {rows.map((m) => (
              <div
                key={m.id}
                className="py-3 flex items-center justify-between gap-3 hover:bg-blue-pale rounded-lg px-2 -mx-2"
              >
                <Link href={`/responsable/checklists/${m.id}`} className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{m.nom}</div>
                  <div className="text-xs text-ink-soft">
                    {[
                      m.typeIntervention ? TYPE_INTERVENTION_LABEL[m.typeIntervention] : null,
                      m.marque,
                      m.typeAppareil,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Générique"}
                  </div>
                </Link>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-ink-soft text-right">{m.nbItems} tâche(s) · v{m.version}<br />{m.nbMissions} mission(s)</span>
                  <Pill tone={m.actif ? "ok" : "neutral"}>{m.actif ? "Actif" : "Inactif"}</Pill>
                  <form action={toggleChecklistModeleActif}>
                    <input type="hidden" name="modeleId" value={m.id} />
                    <input type="hidden" name="actif" value={m.actif} />
                    <Btn variant="ghost" type="submit">
                      {m.actif ? "Désactiver" : "Activer"}
                    </Btn>
                  </form>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun modèle de checklist pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">Nouveau modèle</h2>
          <form action={createChecklistModele} className="flex flex-col gap-3">
            <Field label="Nom du modèle">
              <input
                name="nom"
                required
                className={inputClass}
                placeholder="Checklist Préventive Standard"
              />
            </Field>
            <Field label="Type d'intervention">
              <select name="typeIntervention" className={inputClass} defaultValue="">
                <option value="">Tous types</option>
                <option value="preventive">Préventive</option>
                <option value="corrective">Corrective</option>
                <option value="systematique">Systématique</option>
              </select>
            </Field>
            <Field label="Marque (optionnel)">
              <input name="marque" className={inputClass} placeholder="OTIS, Schindler, Kone..." />
            </Field>
            <Field label="Type d'appareil (optionnel)">
              <input name="typeAppareil" className={inputClass} placeholder="Ascenseur, Monte-charge..." />
            </Field>
            <Btn>Créer le modèle</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
