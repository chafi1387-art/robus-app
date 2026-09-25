import { Card, Pill } from "@/components/ui";
import { db } from "@/db";
import { journalActivite, users } from "@/db/schema";
import { requireUser, Role } from "@/lib/auth-helpers";
import { desc, eq } from "drizzle-orm";
import { formatDateTime } from "@/lib/format";

const ROLES_ADMIN_ONLY: Role[] = ["administrateur"];

const ENTITE_LABEL: Record<string, string> = {
  users: "Utilisateurs",
  non_conformites: "Non-conformités",
  score_iso_saisies: "Score ISO 9001",
  audits: "Audits",
  revues_direction: "Revue de direction",
};

const ACTION_TONE: Record<string, "ok" | "warn" | "crit" | "neutral"> = {
  creation: "ok",
  activation: "ok",
  desactivation: "crit",
  reinitialisation_mot_de_passe: "warn",
  statut_cloturee: "ok",
  statut_ouverte: "crit",
  statut_en_cours: "warn",
  cloture: "ok",
  saisie_mensuelle: "neutral",
  mise_a_jour: "neutral",
};

async function getJournal() {
  return db
    .select({ entree: journalActivite, utilisateur: users.nom })
    .from(journalActivite)
    .leftJoin(users, eq(journalActivite.utilisateurId, users.id))
    .orderBy(desc(journalActivite.createdAt))
    .limit(200);
}

export default async function JournalPage() {
  await requireUser(ROLES_ADMIN_ONLY);
  const lignes = await getJournal();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Journal d&apos;activité</h1>
        <p className="text-sm text-ink-soft">
          Traçabilité inviolable des actions sensibles — comptes, non-conformités, score ISO,
          audits, revues de direction. Historique en lecture seule, 200 dernières entrées.
        </p>
      </div>

      <Card className="p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                <th className="pb-2 pr-3">Date</th>
                <th className="pb-2 pr-3">Domaine</th>
                <th className="pb-2 pr-3">Action</th>
                <th className="pb-2 pr-3">Utilisateur</th>
                <th className="pb-2 pr-3">Détails</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map(({ entree, utilisateur }) => (
                <tr key={entree.id} className="border-b border-line last:border-0 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-ink-soft">
                    {formatDateTime(entree.createdAt)}
                  </td>
                  <td className="py-2 pr-3 font-semibold">
                    {ENTITE_LABEL[entree.entite] ?? entree.entite}
                  </td>
                  <td className="py-2 pr-3">
                    <Pill tone={ACTION_TONE[entree.action] ?? "neutral"}>{entree.action}</Pill>
                  </td>
                  <td className="py-2 pr-3 text-ink-soft">{utilisateur ?? "—"}</td>
                  <td className="py-2 pr-3 text-ink-soft">{entree.details ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {lignes.length === 0 && (
            <p className="text-sm text-ink-soft py-3">Aucune entrée pour l&apos;instant.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
