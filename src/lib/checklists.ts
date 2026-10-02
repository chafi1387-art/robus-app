import "server-only";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { appareils, checklistItems, checklistModeles, interventions, missionChecklistTaches, missionChecklists } from "@/db/schema";
import { compter } from "@/lib/checklists-regles";

// Phase 23 : checklists attribuées aux missions. Au moment de l'attribution,
// les tâches du modèle sont COPIÉES dans la mission : modifier le modèle plus
// tard ne change jamais une mission déjà donnée (preuve ISO).

export async function modelesActifs() {
  return db
    .select({
      id: checklistModeles.id,
      nom: checklistModeles.nom,
      typeIntervention: checklistModeles.typeIntervention,
      marque: checklistModeles.marque,
      typeAppareil: checklistModeles.typeAppareil,
      // Colonne qualifiée en clair : sans jointure, Drizzle écrirait « id » seul (ambigu dans la sous-requête).
      nbTaches: sql<number>`(select count(*)::int from checklist_items i where i.modele_id = "checklist_modeles"."id" and i.actif = 1)`,
    })
    .from(checklistModeles)
    .where(eq(checklistModeles.actif, 1))
    .orderBy(asc(checklistModeles.nom));
}

type ModeleCritere = { id: string; typeIntervention: string | null; marque: string | null; typeAppareil: string | null; nbTaches: number };

/** Modèle le plus précis compatible (type de mission, marque, type d'appareil). */
export function choisirSuggere(modeles: ModeleCritere[], type: string | null, marque: string | null, typeAppareil: string | null) {
  const norm = (v: string | null) => (v ?? "").trim().toLowerCase();
  const compatibles = modeles.filter(
    (m) =>
      m.nbTaches > 0 &&
      (!m.typeIntervention || m.typeIntervention === type) &&
      (!m.marque || norm(m.marque) === norm(marque)) &&
      (!m.typeAppareil || norm(m.typeAppareil) === norm(typeAppareil))
  );
  const score = (m: ModeleCritere) => (m.typeIntervention ? 1 : 0) + (m.marque ? 1 : 0) + (m.typeAppareil ? 1 : 0);
  compatibles.sort((a, b) => score(b) - score(a));
  return compatibles[0]?.id ?? null;
}

/** Suggestions par appareil (pour pré-cocher le formulaire « Nouvelle mission »). */
export async function suggestionsParAppareil(appareilIds: string[], type: string | null) {
  const map: Record<string, string | null> = {};
  if (!appareilIds.length) return map;
  const [modeles, apps] = await Promise.all([
    modelesActifs(),
    db.select({ id: appareils.id, marque: appareils.marque, typeAppareil: appareils.typeAppareil }).from(appareils).where(inArray(appareils.id, appareilIds)),
  ]);
  for (const a of apps) map[a.id] = choisirSuggere(modeles, type, a.marque, a.typeAppareil);
  return map;
}

/** Copie les tâches des modèles dans la mission (un modèle déjà présent n'est pas dupliqué). */
export async function attribuerChecklists(interventionId: string, modeleIds: string[], userId: string | null) {
  const ids = [...new Set(modeleIds.filter(Boolean))];
  if (!ids.length) return 0;
  const deja = await db.select({ modeleId: missionChecklists.modeleId, ordre: missionChecklists.ordre }).from(missionChecklists).where(eq(missionChecklists.interventionId, interventionId));
  const presents = new Set(deja.map((d) => d.modeleId));
  let ordre = deja.reduce((m, d) => Math.max(m, d.ordre + 1), 0);
  let ajoutees = 0;
  const modeles = await db.select().from(checklistModeles).where(and(inArray(checklistModeles.id, ids), eq(checklistModeles.actif, 1)));
  for (const id of ids) {
    const m = modeles.find((x) => x.id === id);
    if (!m || presents.has(id)) continue;
    const items = await db
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.modeleId, id), eq(checklistItems.actif, 1)))
      .orderBy(asc(checklistItems.ordre));
    if (!items.length) continue;
    const [mc] = await db
      .insert(missionChecklists)
      .values({ interventionId, modeleId: id, nom: m.nom, versionModele: m.version, ordre: ordre++, ajouteeParId: userId })
      .returning({ id: missionChecklists.id });
    await db.insert(missionChecklistTaches).values(
      items.map((it, i) => ({
        missionChecklistId: mc.id,
        itemId: it.id,
        ordre: i,
        section: it.section,
        libelle: it.libelle,
        obligatoire: it.obligatoire,
        type: it.type,
        unite: it.unite,
        valeurMin: it.valeurMin,
        valeurMax: it.valeurMax,
      }))
    );
    ajoutees++;
  }
  return ajoutees;
}

/** Missions créées automatiquement (garantie, planification, panne client) : checklist suggérée. */
export async function attribuerParDefaut(interventionId: string) {
  try {
    const [m] = await db
      .select({ type: interventions.type, marque: appareils.marque, typeAppareil: appareils.typeAppareil })
      .from(interventions)
      .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
      .where(eq(interventions.id, interventionId))
      .limit(1);
    if (!m) return;
    const [{ n }] = await db.select({ n: count() }).from(missionChecklists).where(eq(missionChecklists.interventionId, interventionId));
    if (Number(n) > 0) return;
    const id = choisirSuggere(await modelesActifs(), m.type, m.marque, m.typeAppareil);
    if (id) await attribuerChecklists(interventionId, [id], null);
  } catch (e) {
    console.error("Checklist par défaut", e);
  }
}

/** Checklists d'une mission avec leurs tâches. */
export async function checklistsMission(interventionId: string) {
  const listes = await db.select().from(missionChecklists).where(eq(missionChecklists.interventionId, interventionId)).orderBy(asc(missionChecklists.ordre));
  if (!listes.length) return [];
  const taches = await db
    .select()
    .from(missionChecklistTaches)
    .where(inArray(missionChecklistTaches.missionChecklistId, listes.map((l) => l.id)))
    .orderBy(asc(missionChecklistTaches.ordre));
  return listes.map((l) => {
    const t = taches.filter((x) => x.missionChecklistId === l.id);
    return { ...l, taches: t, compte: compter(t) };
  });
}

/** Progression par mission (listes de missions, planning). */
export async function progressionMissions(interventionIds: string[]) {
  const map = new Map<string, { total: number; faites: number; nok: number }>();
  if (!interventionIds.length) return map;
  const rows = await db
    .select({
      interventionId: missionChecklists.interventionId,
      total: sql<number>`count(${missionChecklistTaches.id})::int`,
      faites: sql<number>`count(${missionChecklistTaches.resultat})::int`,
      nok: sql<number>`count(*) filter (where ${missionChecklistTaches.resultat} = 'nok')::int`,
    })
    .from(missionChecklists)
    .innerJoin(missionChecklistTaches, eq(missionChecklistTaches.missionChecklistId, missionChecklists.id))
    .where(inArray(missionChecklists.interventionId, interventionIds))
    .groupBy(missionChecklists.interventionId);
  for (const r of rows) map.set(r.interventionId, { total: r.total, faites: r.faites, nok: r.nok });
  return map;
}

/** Tâches obligatoires pas encore remplies (bloque l'envoi du rapport). */
export async function tachesObligatoiresManquantes(interventionId: string) {
  const [r] = await db
    .select({ n: count() })
    .from(missionChecklistTaches)
    .innerJoin(missionChecklists, eq(missionChecklistTaches.missionChecklistId, missionChecklists.id))
    .where(and(eq(missionChecklists.interventionId, interventionId), eq(missionChecklistTaches.obligatoire, 1), isNull(missionChecklistTaches.resultat)));
  return Number(r?.n ?? 0);
}
