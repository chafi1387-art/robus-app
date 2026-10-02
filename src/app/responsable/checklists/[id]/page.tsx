import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, Btn, Field, inputClass, Pill } from "@/components/ui";
import { db } from "@/db";
import { checklistItems, checklistModeles, missionChecklists } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { formatDate } from "@/lib/format";
import { libelleLimites } from "@/lib/checklists-regles";
import {
  addChecklistItem,
  deplacerChecklistItem,
  dupliquerChecklistModele,
  modifierChecklistItem,
  modifierChecklistModele,
  removeChecklistItem,
  toggleChecklistModeleActif,
} from "../actions";

const TYPE_INTERVENTION_LABEL: Record<string, string> = {
  preventive: "Préventive",
  corrective: "Corrective",
  systematique: "Systématique",
};

const SECTIONS = ["Machinerie", "Cabine", "Portes palières", "Gaine", "Cuvette", "Sécurité", "Essais"];

// Phase 23 : éditeur d'un modèle de checklist — sections, tâches
// obligatoires, mesures avec limites, ordre, version.
export default async function ChecklistModeleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(ROLES_BUREAU);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [[modele], items, [usage]] = await Promise.all([
    db.select().from(checklistModeles).where(eq(checklistModeles.id, id)).limit(1),
    db.select().from(checklistItems).where(and(eq(checklistItems.modeleId, id), eq(checklistItems.actif, 1))).orderBy(asc(checklistItems.ordre)),
    db.select({ n: sql<number>`count(*)::int` }).from(missionChecklists).where(eq(missionChecklists.modeleId, id)),
  ]);
  if (!modele) notFound();
  const sectionsExistantes = [...new Set([...items.map((i) => i.section).filter((x): x is string => !!x), ...SECTIONS])];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/responsable/checklists" className="text-xs text-blue font-semibold">&larr; Checklists</Link>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h1 className="text-2xl font-extrabold font-display">{modele.nom}</h1>
          <Pill tone={modele.actif ? "ok" : "neutral"}>{modele.actif ? "Actif" : "Inactif"}</Pill>
          <Pill tone="neutral">Version {modele.version}</Pill>
        </div>
        <p className="text-sm text-ink-soft">
          {[modele.typeIntervention ? TYPE_INTERVENTION_LABEL[modele.typeIntervention] : null, modele.marque, modele.typeAppareil].filter(Boolean).join(" · ") ||
            "Générique — applicable à tous types / marques"}
          {" · "}utilisé sur {usage?.n ?? 0} mission(s) · modifié le {formatDate(modele.updatedAt)}
        </p>
        <div className="flex gap-2 mt-2 flex-wrap">
          <form action={toggleChecklistModeleActif}>
            <input type="hidden" name="modeleId" value={modele.id} />
            <input type="hidden" name="actif" value={modele.actif} />
            <Btn variant="ghost" type="submit">{modele.actif ? "Désactiver" : "Activer"}</Btn>
          </form>
          <form action={dupliquerChecklistModele}>
            <input type="hidden" name="modeleId" value={modele.id} />
            <Btn variant="ghost" type="submit">Dupliquer</Btn>
          </form>
        </div>
        <p className="text-xs text-ink-soft mt-2">
          Les missions déjà attribuées gardent la version qu&apos;elles ont reçue : modifier ce modèle ne change que les prochaines missions.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display font-bold text-sm mb-3">Tâches ({items.length})</h2>
          <div className="flex flex-col divide-y divide-line">
            {items.map((item, i) => (
              <div key={item.id}>
                {item.section && item.section !== items[i - 1]?.section && (
                  <div className="pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-ink-soft">{item.section}</div>
                )}
                <div className="py-2.5 flex items-start gap-3">
                  <span className="text-xs font-bold text-ink-soft w-6 text-right shrink-0 mt-0.5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">
                      {item.libelle}
                      {item.obligatoire ? <span className="text-red-ink"> *</span> : <span className="text-xs text-ink-soft"> (facultative)</span>}
                    </div>
                    <div className="text-xs text-ink-soft">{item.type === "mesure" ? `Mesure ${libelleLimites(item)}` : "✓ / ✗"}</div>
                    <details className="mt-1">
                      <summary className="text-xs font-semibold text-blue cursor-pointer select-none">Modifier</summary>
                      <FormTache modeleId={modele.id} item={item} sections={sectionsExistantes} />
                    </details>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {i > 0 && (
                      <form action={deplacerChecklistItem}>
                        <input type="hidden" name="modeleId" value={modele.id} />
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="sens" value="haut" />
                        <button type="submit" aria-label="Monter" className="w-7 h-7 rounded-md border border-line flex items-center justify-center hover:bg-blue-pale">
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    )}
                    {i < items.length - 1 && (
                      <form action={deplacerChecklistItem}>
                        <input type="hidden" name="modeleId" value={modele.id} />
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="sens" value="bas" />
                        <button type="submit" aria-label="Descendre" className="w-7 h-7 rounded-md border border-line flex items-center justify-center hover:bg-blue-pale">
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    )}
                    <form action={removeChecklistItem}>
                      <input type="hidden" name="itemId" value={item.id} />
                      <input type="hidden" name="modeleId" value={modele.id} />
                      <button type="submit" className="text-xs font-semibold text-red-ink px-2">Retirer</button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
            {items.length === 0 && <p className="text-sm text-ink-soft py-3">Aucune tâche pour l&apos;instant.</p>}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-2">Ajouter une tâche</h2>
            <FormTache modeleId={modele.id} sections={sectionsExistantes} />
          </Card>
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-2">Ajouter plusieurs tâches d&apos;un coup</h2>
            <form action={addChecklistItem} className="flex flex-col gap-2">
              <input type="hidden" name="modeleId" value={modele.id} />
              <Field label="Section (facultatif)">
                <input name="section" list="sections-cl" className={inputClass} placeholder="Ex. Cabine" />
              </Field>
              <textarea name="lignes" rows={5} required className={inputClass} placeholder={"Une tâche par ligne, par exemple :\nÉclairage cabine\nBouton d'alarme\nPorte : réouverture sur obstacle"} />
              <p className="text-xs text-ink-soft">Tâches ✓ / ✗ obligatoires (modifiables ensuite).</p>
              <Btn variant="ghost">Ajouter les tâches</Btn>
            </form>
          </Card>
          <Card className="p-5">
            <details>
              <summary className="font-display font-bold text-sm cursor-pointer select-none text-blue">Modifier le modèle (nom, filtres)</summary>
              <form action={modifierChecklistModele} className="flex flex-col gap-2 mt-3">
                <input type="hidden" name="modeleId" value={modele.id} />
                <Field label="Nom">
                  <input name="nom" required defaultValue={modele.nom} className={inputClass} />
                </Field>
                <Field label="Type de mission (proposée automatiquement)">
                  <select name="typeIntervention" defaultValue={modele.typeIntervention ?? ""} className={inputClass}>
                    <option value="">Tous</option>
                    {Object.entries(TYPE_INTERVENTION_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Marque (facultatif)">
                  <input name="marque" defaultValue={modele.marque ?? ""} className={inputClass} />
                </Field>
                <Field label="Type d'appareil (facultatif)">
                  <input name="typeAppareil" defaultValue={modele.typeAppareil ?? ""} className={inputClass} />
                </Field>
                <Field label="Description (facultatif)">
                  <textarea name="description" rows={2} defaultValue={modele.description ?? ""} className={inputClass} />
                </Field>
                <Btn variant="ghost" className="self-start">Enregistrer</Btn>
              </form>
            </details>
          </Card>
        </div>
      </div>
      <datalist id="sections-cl">
        {sectionsExistantes.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
    </div>
  );
}

function FormTache({ modeleId, item, sections }: { modeleId: string; item?: typeof checklistItems.$inferSelect; sections: string[] }) {
  return (
    <form action={item ? modifierChecklistItem : addChecklistItem} className="flex flex-col gap-2 mt-2">
      <input type="hidden" name="modeleId" value={modeleId} />
      {item && <input type="hidden" name="itemId" value={item.id} />}
      <Field label="Tâche">
        <input name="libelle" required defaultValue={item?.libelle} className={inputClass} placeholder="Ex. Isolement du moteur" />
      </Field>
      <Field label="Section (facultatif)">
        <input name="section" list="sections-cl" defaultValue={item?.section ?? ""} className={inputClass} placeholder={sections[0]} />
      </Field>
      <div className="flex gap-4 flex-wrap text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" name="type" value="case" defaultChecked={!item || item.type === "case"} /> ✓ / ✗
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="type" value="mesure" defaultChecked={item?.type === "mesure"} /> Mesure (chiffre)
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="obligatoire" defaultChecked={!item || item.obligatoire === 1} /> Obligatoire
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Unité">
          <input name="unite" defaultValue={item?.unite ?? ""} className={inputClass} placeholder="MΩ, mm…" />
        </Field>
        <Field label="Minimum">
          <input name="valeurMin" inputMode="decimal" defaultValue={item?.valeurMin ?? ""} className={inputClass} />
        </Field>
        <Field label="Maximum">
          <input name="valeurMax" inputMode="decimal" defaultValue={item?.valeurMax ?? ""} className={inputClass} />
        </Field>
      </div>
      <p className="text-xs text-ink-soft">Unité et limites : seulement pour une mesure. Hors limites = ✗ automatique (commentaire demandé).</p>
      <Btn variant={item ? "ghost" : "primary"} className="self-start">{item ? "Enregistrer" : "Ajouter la tâche"}</Btn>
    </form>
  );
}
