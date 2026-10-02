"use server";

import { z } from "zod";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appareils, interventions, missionChecklistTaches, missionChecklists } from "@/db/schema";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { notifierBureau } from "@/lib/push";
import { evaluerMesure } from "@/lib/checklists-regles";

// Phase 23 : le technicien remplit une tâche de checklist — enregistrée tout
// de suite (rien n'est perdu s'il quitte l'écran). ✓ = conforme ; ✗ = non
// conforme avec un commentaire obligatoire ; mesure = valeur comparée aux limites.

export type ReponseTache = { ok: true; resultat: "ok" | "nok"; valeur: string | null; commentaire: string | null } | { ok: false; erreur: string };

const schema = z.object({
  tacheId: z.string().uuid(),
  resultat: z.enum(["ok", "nok"]).optional(),
  valeur: z.string().optional(),
  commentaire: z.string().max(1000).optional(),
});

export async function repondreTache(entree: { tacheId: string; resultat?: "ok" | "nok"; valeur?: string; commentaire?: string }): Promise<ReponseTache> {
  const user = await requireUser(ROLES_TECHNICIEN);
  const p = schema.safeParse(entree);
  if (!p.success) return { ok: false, erreur: "Réponse invalide." };
  const [t] = await db
    .select({
      tache: missionChecklistTaches,
      interventionId: missionChecklists.interventionId,
      technicienId: interventions.technicienId,
      statut: interventions.statut,
      numero: appareils.numeroInterne,
    })
    .from(missionChecklistTaches)
    .innerJoin(missionChecklists, eq(missionChecklistTaches.missionChecklistId, missionChecklists.id))
    .innerJoin(interventions, eq(missionChecklists.interventionId, interventions.id))
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .where(eq(missionChecklistTaches.id, p.data.tacheId))
    .limit(1);
  if (!t) return { ok: false, erreur: "Tâche introuvable." };
  if (user.role !== "administrateur" && t.technicienId !== user.id) return { ok: false, erreur: "Cette mission n'est pas la vôtre." };
  if (t.statut !== "en_cours") return { ok: false, erreur: "Commencez la mission pour remplir la checklist." };

  const commentaire = (p.data.commentaire ?? "").trim() || null;
  let resultat: "ok" | "nok";
  let valeur: string | null = null;
  if (t.tache.type === "mesure") {
    const v = Number(String(p.data.valeur ?? "").replace(",", "."));
    if (!p.data.valeur || Number.isNaN(v)) return { ok: false, erreur: "Indiquez la valeur mesurée." };
    valeur = String(v);
    resultat = evaluerMesure(v, t.tache.valeurMin, t.tache.valeurMax);
  } else {
    if (!p.data.resultat) return { ok: false, erreur: "Choisissez ✓ ou ✗." };
    resultat = p.data.resultat;
  }
  if (resultat === "nok" && !commentaire) return { ok: false, erreur: "Non conforme : écrivez pourquoi." };

  await db
    .update(missionChecklistTaches)
    .set({ resultat, valeur, commentaire: resultat === "nok" ? commentaire : commentaire, rempliLe: new Date(), rempliParId: user.id, ...(resultat === "ok" ? { traiteLe: null, traiteParId: null } : {}) })
    .where(eq(missionChecklistTaches.id, t.tache.id));

  // ✗ : le bureau est prévenu (une fois par tâche) — il décide ensuite.
  if (resultat === "nok" && t.tache.resultat !== "nok") {
    after(() =>
      notifierBureau({
        titre: "✗ Checklist : point non conforme",
        corps: `${t.numero} — ${t.tache.libelle}${valeur ? ` (${valeur}${t.tache.unite ? ` ${t.tache.unite}` : ""})` : ""} : ${commentaire}`,
        url: `/responsable/missions/${t.interventionId}#checklist`,
        tag: `checklist-${t.tache.id}`,
      })
    );
  }
  revalidatePath(`/responsable/missions/${t.interventionId}`);
  return { ok: true, resultat, valeur, commentaire };
}
