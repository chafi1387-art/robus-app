import { Card, Btn, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { revuesDirection } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { desc } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import { createRevueDirection } from "./actions";

async function getRevues() {
  return db.select().from(revuesDirection).orderBy(desc(revuesDirection.dateRevue));
}

export default async function RevuesDirectionPage() {
  await requireUser(ROLES_BUREAU);
  const rows = await getRevues();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Revue de direction</h1>
        <p className="text-sm text-ink-soft">Clause 9.3 — {rows.length} revue(s) enregistrée(s)</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-col divide-y divide-line">
            {rows.map((r) => (
              <div key={r.id} className="py-4 flex flex-col gap-2">
                <div className="font-semibold text-sm">{formatDate(r.dateRevue)}</div>
                {r.participants && (
                  <div className="text-xs text-ink-soft">
                    <span className="font-bold uppercase tracking-wide">Participants : </span>
                    {r.participants}
                  </div>
                )}
                {r.pointsAbordes && (
                  <div className="text-xs text-ink-soft">
                    <span className="font-bold uppercase tracking-wide">Points abordés : </span>
                    {r.pointsAbordes}
                  </div>
                )}
                {r.decisions && (
                  <div className="text-xs text-ink-soft">
                    <span className="font-bold uppercase tracking-wide">Décisions : </span>
                    {r.decisions}
                  </div>
                )}
              </div>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucune revue de direction enregistrée.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Nouvelle revue</h2>
          <form action={createRevueDirection} className="flex flex-col gap-3">
            <Field label="Date de la revue">
              <input type="date" name="dateRevue" required className={inputClass} />
            </Field>
            <Field label="Participants">
              <textarea
                name="participants"
                rows={2}
                className={inputClass}
                placeholder="Noms et fonctions des participants..."
              />
            </Field>
            <Field label="Points abordés">
              <textarea
                name="pointsAbordes"
                rows={4}
                className={inputClass}
                placeholder="Actions issues des revues précédentes, indicateurs qualité, non-conformités, satisfaction client..."
              />
            </Field>
            <Field label="Décisions">
              <textarea
                name="decisions"
                rows={4}
                className={inputClass}
                placeholder="Décisions prises et actions à mener..."
              />
            </Field>
            <Btn>Enregistrer la revue</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
