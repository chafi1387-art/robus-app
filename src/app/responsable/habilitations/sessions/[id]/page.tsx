import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { formationsParticipants, formationsSessions, habilitationsCatalogue, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { Btn, Card, Pill, inputClass } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { cloturerSession, evaluerEfficacite } from "../../actions";

const EFFICACITE: Record<string, { label: string; tone: "ok" | "warn" | "crit" }> = {
  efficace: { label: "Efficace", tone: "ok" },
  partielle: { label: "Partiellement efficace", tone: "warn" },
  non_efficace: { label: "Non efficace", tone: "crit" },
};

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(ROLES_BUREAU);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ s: formationsSessions, habilitation: habilitationsCatalogue.nom })
    .from(formationsSessions)
    .leftJoin(habilitationsCatalogue, eq(formationsSessions.catalogueId, habilitationsCatalogue.id))
    .where(eq(formationsSessions.id, id))
    .limit(1);
  if (!row) notFound();
  const s = row.s;
  const participants = await db
    .select({ p: formationsParticipants, nom: users.nom })
    .from(formationsParticipants)
    .innerJoin(users, eq(formationsParticipants.technicienId, users.id))
    .where(eq(formationsParticipants.sessionId, id))
    .orderBy(asc(users.nom));
  const gestion = user.role === "administrateur" || user.role === "responsable_qualite";
  const terminee = s.statut === "terminee";

  return (
    <div className="flex flex-col gap-4">
      <Link href="/responsable/habilitations?onglet=sessions" className="text-xs text-blue font-semibold">&larr; Formations</Link>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold font-display">{s.titre}</h1>
          <p className="text-sm text-ink-soft">
            {formatDateTime(s.dateDebut)}{s.dureeHeures ? ` · ${s.dureeHeures} h` : ""}{s.organisme ? ` · ${s.organisme}` : ""}
            {row.habilitation ? ` · délivre « ${row.habilitation} »` : ""}
          </p>
        </div>
        <Pill tone={terminee ? "ok" : "warn"}>{terminee ? "Terminée" : "Planifiée"}</Pill>
      </div>
      {s.programme && <Card className="p-4 text-sm whitespace-pre-wrap">{s.programme}</Card>}

      <Card className="p-5">
        <h2 className="font-display font-bold text-sm mb-3">Participants ({participants.length})</h2>
        {!terminee && gestion ? (
          <form action={cloturerSession} className="flex flex-col gap-3">
            <input type="hidden" name="sessionId" value={s.id} />
            {participants.map(({ p, nom }) => (
              <div key={p.id} className="flex items-center gap-4 flex-wrap border-b border-line pb-2">
                <span className="font-semibold w-44">{nom}</span>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name={`present_${p.id}`} defaultChecked /> Présent
                </label>
                <select name={`resultat_${p.id}`} defaultValue="reussi" className={`${inputClass} w-44`}>
                  <option value="reussi">Réussi</option>
                  <option value="a_refaire">À refaire</option>
                </select>
              </div>
            ))}
            <Btn className="self-start">Enregistrer les résultats{row.habilitation ? " et délivrer l'habilitation" : ""}</Btn>
          </form>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {participants.map(({ p, nom }) => (
              <div key={p.id} className="py-3 flex flex-col gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold w-44">{nom}</span>
                  {terminee ? (
                    <>
                      <Pill tone={p.present ? "ok" : "crit"}>{p.present ? "Présent" : "Absent"}</Pill>
                      {p.resultat && <Pill tone={p.resultat === "reussi" ? "ok" : "warn"}>{p.resultat === "reussi" ? "Réussi" : "À refaire"}</Pill>}
                      {p.habilitationId && <Pill tone="ok">Habilitation délivrée</Pill>}
                      {p.efficacite && (
                        <Pill tone={EFFICACITE[p.efficacite]?.tone ?? "warn"}>
                          {EFFICACITE[p.efficacite]?.label} · {formatDate(p.efficaciteLe)}
                        </Pill>
                      )}
                    </>
                  ) : (
                    <Pill tone="neutral">Inscrit</Pill>
                  )}
                </div>
                {p.efficaciteCommentaire && <p className="text-xs text-ink-soft">{p.efficaciteCommentaire}</p>}
                {terminee && gestion && p.present === 1 && (
                  <form action={evaluerEfficacite} className="flex items-end gap-2 flex-wrap">
                    <input type="hidden" name="participantId" value={p.id} />
                    <input type="hidden" name="sessionId" value={s.id} />
                    <select name="efficacite" defaultValue={p.efficacite ?? "efficace"} className={`${inputClass} w-56`}>
                      {Object.entries(EFFICACITE).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                    <input name="commentaire" defaultValue={p.efficaciteCommentaire ?? ""} placeholder="Constat sur le terrain…" className={`${inputClass} w-72`} />
                    <Btn variant="ghost">{p.efficacite ? "Mettre à jour" : "Évaluer l'efficacité"}</Btn>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
        {terminee && <p className="text-xs text-ink-soft mt-3">ISO 9001 §7.2 c : évaluez l&apos;efficacité de la formation quelques semaines après (observation sur le terrain).</p>}
      </Card>
    </div>
  );
}
