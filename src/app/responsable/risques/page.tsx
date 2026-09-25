import { Card, Btn, Field, Pill, PrioritePill, inputClass } from "@/components/ui";
import { db } from "@/db";
import { risques, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { desc, eq, inArray } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import { createRisque, updateRisqueStatut } from "./actions";

const TYPE_LABEL: Record<string, string> = {
  risque: "Risque",
  opportunite: "Opportunité",
};

const STATUT_LABEL: Record<string, string> = {
  identifie: "Identifié",
  en_traitement: "En traitement",
  maitrise: "Maîtrisé",
};

const STATUT_TONE: Record<string, "ok" | "warn" | "crit" | "neutral"> = {
  identifie: "neutral",
  en_traitement: "warn",
  maitrise: "ok",
};

async function getRisques() {
  return db
    .select({
      id: risques.id,
      type: risques.type,
      titre: risques.titre,
      description: risques.description,
      impact: risques.impact,
      statut: risques.statut,
      planActions: risques.planActions,
      dateRevue: risques.dateRevue,
      responsableNom: users.nom,
    })
    .from(risques)
    .leftJoin(users, eq(risques.responsableId, users.id))
    .orderBy(desc(risques.createdAt));
}

async function getResponsablesPotentiels() {
  return db
    .select({ id: users.id, nom: users.nom })
    .from(users)
    .where(inArray(users.role, ["administrateur", "responsable_qualite", "commercial"]))
    .orderBy(users.nom);
}

export default async function RisquesPage() {
  await requireUser(ROLES_BUREAU);
  const [rows, responsables] = await Promise.all([getRisques(), getResponsablesPotentiels()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Registre des risques &amp; opportunités</h1>
        <p className="text-sm text-ink-soft">
          Clause 6.1 — {rows.length} entrée(s) enregistrée(s)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-col divide-y divide-line">
            {rows.map((r) => (
              <div key={r.id} className="py-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Pill tone="neutral">{TYPE_LABEL[r.type] ?? r.type}</Pill>
                      <PrioritePill priorite={r.impact} />
                    </div>
                    <div className="font-semibold text-sm mt-1">{r.titre}</div>
                    {r.description && (
                      <div className="text-xs text-ink-soft mt-0.5">{r.description}</div>
                    )}
                  </div>
                  <Pill tone={STATUT_TONE[r.statut] ?? "neutral"}>
                    {STATUT_LABEL[r.statut] ?? r.statut}
                  </Pill>
                </div>

                {r.planActions && (
                  <div className="text-xs text-ink-soft">
                    <span className="font-bold uppercase tracking-wide">Plan d&apos;actions : </span>
                    {r.planActions}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
                  <div className="flex flex-wrap gap-3">
                    <span>Responsable : {r.responsableNom ?? "Non assigné"}</span>
                    <span>Prochaine revue : {formatDate(r.dateRevue)}</span>
                  </div>
                  <form action={updateRisqueStatut} className="flex items-center gap-2">
                    <input type="hidden" name="risqueId" value={r.id} />
                    <select
                      name="statut"
                      defaultValue={r.statut}
                      className={`${inputClass} !py-1 !text-xs w-auto`}
                    >
                      <option value="identifie">Identifié</option>
                      <option value="en_traitement">En traitement</option>
                      <option value="maitrise">Maîtrisé</option>
                    </select>
                    <Btn type="submit" variant="ghost" className="!px-3 !py-1.5 !text-xs">
                      Mettre à jour
                    </Btn>
                  </form>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun risque ou opportunité enregistré.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Nouvelle entrée</h2>
          <form action={createRisque} className="flex flex-col gap-3">
            <Field label="Type">
              <select name="type" className={inputClass} defaultValue="risque">
                <option value="risque">Risque</option>
                <option value="opportunite">Opportunité</option>
              </select>
            </Field>
            <Field label="Titre">
              <input name="titre" required className={inputClass} placeholder="Intitulé synthétique" />
            </Field>
            <Field label="Description">
              <textarea
                name="description"
                rows={3}
                className={inputClass}
                placeholder="Contexte, causes, conséquences potentielles..."
              />
            </Field>
            <Field label="Impact">
              <select name="impact" className={inputClass} defaultValue="normale">
                <option value="basse">Basse</option>
                <option value="normale">Normale</option>
                <option value="haute">Haute</option>
                <option value="critique">Critique</option>
              </select>
            </Field>
            <Field label="Plan d'actions">
              <textarea
                name="planActions"
                rows={3}
                className={inputClass}
                placeholder="Actions prévues pour traiter ce point..."
              />
            </Field>
            <Field label="Responsable">
              <select name="responsableId" className={inputClass} defaultValue="">
                <option value="">Non assigné</option>
                {responsables.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nom}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date de revue">
              <input type="date" name="dateRevue" className={inputClass} />
            </Field>
            <Btn>Ajouter au registre</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
