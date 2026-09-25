import { Card, Btn, Field, inputClass, Pill } from "@/components/ui";
import { db } from "@/db";
import { checklistItems, checklistModeles } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addChecklistItem, removeChecklistItem, toggleChecklistModeleActif } from "../actions";

const TYPE_INTERVENTION_LABEL: Record<string, string> = {
  preventive: "Préventive",
  corrective: "Corrective",
  systematique: "Systématique",
};

export default async function ChecklistModeleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser(ROLES_BUREAU);
  const { id } = await params;

  const [modele] = await db
    .select()
    .from(checklistModeles)
    .where(eq(checklistModeles.id, id))
    .limit(1);
  if (!modele) notFound();

  const items = await db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.modeleId, id))
    .orderBy(asc(checklistItems.ordre));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/responsable/checklists" className="text-xs text-blue font-semibold">
          &larr; Checklists
        </Link>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-2xl font-extrabold font-display">{modele.nom}</h1>
          <Pill tone={modele.actif ? "ok" : "neutral"}>{modele.actif ? "Actif" : "Inactif"}</Pill>
        </div>
        <p className="text-sm text-ink-soft">
          {[
            modele.typeIntervention ? TYPE_INTERVENTION_LABEL[modele.typeIntervention] : null,
            modele.marque,
            modele.typeAppareil,
          ]
            .filter(Boolean)
            .join(" · ") || "Générique — applicable à tous types/marques"}
        </p>
        <form action={toggleChecklistModeleActif} className="mt-2">
          <input type="hidden" name="modeleId" value={modele.id} />
          <input type="hidden" name="actif" value={modele.actif} />
          <Btn variant="ghost" type="submit">
            {modele.actif ? "Désactiver ce modèle" : "Activer ce modèle"}
          </Btn>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display font-bold text-sm mb-3">
            Items de la checklist ({items.length})
          </h2>
          <div className="flex flex-col divide-y divide-line">
            {items.map((item) => (
              <div key={item.id} className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-bold text-ink-soft w-6 text-right shrink-0">
                    {item.ordre + 1}
                  </span>
                  <span className="text-sm">{item.libelle}</span>
                </div>
                <form action={removeChecklistItem}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="modeleId" value={modele.id} />
                  <Btn variant="ghost" type="submit">
                    Supprimer
                  </Btn>
                </form>
              </div>
            ))}
            {items.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun item pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">Ajouter un item</h2>
          <form action={addChecklistItem} className="flex flex-col gap-3">
            <input type="hidden" name="modeleId" value={modele.id} />
            <Field label="Libellé de l'item">
              <input
                name="libelle"
                required
                className={inputClass}
                placeholder="Contrôle visuel cabine et portes"
              />
            </Field>
            <p className="text-xs text-ink-soft">
              L&apos;item sera ajouté en fin de liste (ordre {items.length + 1}).
            </p>
            <Btn>Ajouter l&apos;item</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
