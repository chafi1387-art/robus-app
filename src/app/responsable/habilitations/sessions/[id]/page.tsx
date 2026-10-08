import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq, sql } from "drizzle-orm";
import { Download } from "lucide-react";
import { db } from "@/db";
import { documentsFormations, formationsConsultations, formationsParticipants, formationsSessions, habilitationsCatalogue, technicienFiches, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { Btn, Card, Field, Pill, inputClass } from "@/components/ui";
import { formatDate, formatDateTime, toDatetimeLocalValue } from "@/lib/format";
import { ACCEPT_FICHIERS_JOINTS } from "@/lib/fichiers";
import { LIEUX_FORMATION } from "@/lib/formations";
import {
  ajouterDocumentsSession,
  annulerSession,
  cloturerSession,
  detacherDocumentSession,
  evaluerEfficacite,
  inscrireTechniciens,
  reporterSession,
  retirerParticipant,
} from "../../actions";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { EnvoiFichiers } from "@/components/envoi-fichiers";

// Phase 21 : une formation vue par le bureau — réponses des techniciens,
// signatures de présence, documents, validation finale (admin / RQ),
// attestations et feuille d'émargement (preuves ISO 9001 §7.2).

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
  const [participants, documents, lectures, techs, valideur] = await Promise.all([
    db
      .select({ p: formationsParticipants, nom: users.nom })
      .from(formationsParticipants)
      .innerJoin(users, eq(formationsParticipants.technicienId, users.id))
      .where(eq(formationsParticipants.sessionId, id))
      .orderBy(asc(users.nom)),
    db.select().from(documentsFormations).where(eq(documentsFormations.sessionId, id)).orderBy(desc(documentsFormations.createdAt)),
    db
      .select({ documentId: formationsConsultations.documentId, technicienId: formationsConsultations.technicienId })
      .from(formationsConsultations)
      .innerJoin(documentsFormations, eq(formationsConsultations.documentId, documentsFormations.id))
      .where(eq(documentsFormations.sessionId, id)),
    db
      .select({ id: users.id, nom: users.nom })
      .from(users)
      .leftJoin(technicienFiches, eq(technicienFiches.technicienId, users.id))
      .where(sql`${users.role} = 'technicien' and ${users.actif} = 1 and coalesce(${technicienFiches.statutRh}::text, '') <> 'sorti_effectifs'`)
      .orderBy(asc(users.nom)),
    s.clotureeParId ? db.select({ nom: users.nom }).from(users).where(eq(users.id, s.clotureeParId)).limit(1).then((r) => r[0]?.nom ?? null) : Promise.resolve(null),
  ]);
  const gestion = user.role === "administrateur" || user.role === "responsable_qualite";
  const planifiee = s.statut === "planifiee";
  const terminee = s.statut === "terminee";
  // eslint-disable-next-line react-hooks/purity
  const aVenir = s.dateDebut.getTime() > Date.now() + 12 * 3600 * 1000;
  const inscrits = new Set(participants.map((p) => p.p.technicienId));
  const nonInscrits = techs.filter((t) => !inscrits.has(t.id));
  const lusPar = (techId: string) => lectures.filter((l) => l.technicienId === techId).length;
  const nbConfirmes = participants.filter(({ p }) => p.reponse === "confirme").length;
  const nbEmarges = participants.filter(({ p }) => p.emargeLe).length;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/responsable/habilitations?onglet=sessions" className="text-xs text-blue font-semibold">&larr; Formations</Link>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold font-display">🎓 {s.titre}</h1>
          <p className="text-sm text-ink-soft">
            {formatDateTime(s.dateDebut)}
            {s.dureeHeures ? ` · ${s.dureeHeures} h` : ""} · {LIEUX_FORMATION[s.lieu] ?? s.lieu}
            {s.organisme ? ` · ${s.organisme}` : ""}
            {row.habilitation ? ` · délivre « ${row.habilitation} »` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a href={`/api/export/emargement/${s.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold border border-line hover:bg-blue-pale">
            <Download className="w-4 h-4" /> Feuille d&apos;émargement (PDF)
          </a>
          <Pill tone={terminee ? "ok" : s.statut === "annulee" ? "neutral" : "warn"}>
            {terminee ? `Validée${valideur ? ` par ${valideur}` : ""}` : s.statut === "annulee" ? "Annulée" : "Planifiée"}
          </Pill>
        </div>
      </div>
      {s.statut === "annulee" && <Card className="p-4 text-sm text-red-ink">Annulée : {s.motifAnnulation}</Card>}
      {s.programme && <Card className="p-4 text-sm whitespace-pre-wrap">{s.programme}</Card>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h2 className="font-display font-bold text-sm">Participants ({participants.length})</h2>
            {planifiee && (
              <span className="text-xs text-ink-soft">
                {nbConfirmes}/{participants.length} confirmé(s) · {nbEmarges} présence(s) signée(s)
              </span>
            )}
          </div>

          {planifiee && gestion && !aVenir ? (
            <form action={cloturerSession} className="flex flex-col gap-3">
              <input type="hidden" name="sessionId" value={s.id} />
              <p className="text-xs text-ink-soft -mt-1">Validation finale : cochez les présents (pré-cochés = présence signée par le technicien) et le résultat.</p>
              {participants.map(({ p, nom }) => (
                <div key={p.id} className="flex items-center gap-4 flex-wrap border-b border-line pb-2">
                  <span className="font-semibold w-44">{nom}</span>
                  <EtatParticipant p={p} />
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name={`present_${p.id}`} defaultChecked={!!p.emargeLe} /> Présent
                  </label>
                  <select name={`resultat_${p.id}`} defaultValue="reussi" className={`${inputClass} w-44`}>
                    <option value="reussi">Réussi</option>
                    <option value="a_refaire">À refaire</option>
                  </select>
                </div>
              ))}
              <Btn className="self-start">Valider la formation{row.habilitation ? " et délivrer l'habilitation" : ""}</Btn>
            </form>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {participants.map(({ p, nom }) => (
                <div key={p.id} className="py-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/responsable/techniciens/${p.technicienId}?tab=habilitations`} className="font-semibold w-44 text-blue hover:underline">{nom}</Link>
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
                        {p.present === 1 && (
                          <a href={`/api/export/attestation-formation/${p.id}`} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue">Attestation PDF</a>
                        )}
                      </>
                    ) : (
                      <EtatParticipant p={p} />
                    )}
                    {documents.length > 0 && <span className="text-xs text-ink-soft">· documents lus {lusPar(p.technicienId)}/{documents.length}</span>}
                    {planifiee && gestion && (
                      <form action={retirerParticipant} className="ml-auto">
                        <input type="hidden" name="sessionId" value={s.id} />
                        <input type="hidden" name="participantId" value={p.id} />
                        <BoutonEnvoi type="submit" className="text-xs font-semibold text-red-ink">Retirer</BoutonEnvoi>
                      </form>
                    )}
                  </div>
                  {p.reponse === "indisponible" && p.reponseMotif && <p className="text-xs text-red-ink">Motif : {p.reponseMotif}</p>}
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
              {participants.length === 0 && <p className="text-sm text-ink-soft py-2">Aucun participant.</p>}
            </div>
          )}
          {planifiee && aVenir && <p className="text-sm text-ink-soft mt-3">La validation (présence et résultats) s&apos;ouvre le {formatDate(s.dateDebut)}. Les techniciens signent leur présence sur place dans l&apos;application.</p>}
          {terminee && <p className="text-xs text-ink-soft mt-3">ISO 9001 §7.2 c : évaluez l&apos;efficacité quelques semaines après (observation sur le terrain).</p>}

          {planifiee && gestion && nonInscrits.length > 0 && (
            <details className="mt-4 pt-3 border-t border-line">
              <summary className="text-sm font-bold text-blue cursor-pointer select-none">+ Inscrire des techniciens</summary>
              <form action={inscrireTechniciens} className="flex flex-col gap-2 mt-2">
                <input type="hidden" name="sessionId" value={s.id} />
                <div className="flex flex-wrap gap-3">
                  {nonInscrits.map((t) => (
                    <label key={t.id} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" name="technicienIds" value={t.id} /> {t.nom}
                    </label>
                  ))}
                </div>
                <Btn variant="ghost" className="self-start">Inscrire et prévenir</Btn>
              </form>
            </details>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-2">Documents ({documents.length})</h2>
            <div className="flex flex-col divide-y divide-line">
              {documents.map((d) => (
                <div key={d.id} className="py-2 flex items-center justify-between gap-2">
                  {d.urlFichier ? (
                    <a href={d.urlFichier} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue truncate">📄 {d.titre}</a>
                  ) : (
                    <span className="text-sm truncate">{d.titre}</span>
                  )}
                  {gestion && (
                    <form action={detacherDocumentSession}>
                      <input type="hidden" name="sessionId" value={s.id} />
                      <input type="hidden" name="documentId" value={d.id} />
                      <BoutonEnvoi type="submit" className="text-xs font-semibold text-red-ink whitespace-nowrap">Retirer</BoutonEnvoi>
                    </form>
                  )}
                </div>
              ))}
              {documents.length === 0 && <p className="text-sm text-ink-soft py-1">Aucun document.</p>}
            </div>
            {gestion && s.statut !== "annulee" && (
              <form action={ajouterDocumentsSession} className="flex flex-col gap-2 mt-3 pt-3 border-t border-line">
                <input type="hidden" name="sessionId" value={s.id} />
                <EnvoiFichiers type="fichier" name="documents" dossier="formations" requis />
                <input name="titreDocument" placeholder="Titre (si un seul fichier)" className={inputClass} />
                <label className="flex items-center gap-2 text-sm">
                  <select name="lectureObligatoire" defaultValue="on" className={`${inputClass} !py-1 !text-xs w-auto`}>
                    <option value="on">Lecture obligatoire</option>
                    <option value="off">Pour information</option>
                  </select>
                </label>
                {planifiee && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="prevenir" defaultChecked /> Prévenir les participants
                  </label>
                )}
                <Btn variant="ghost" className="self-start">Ajouter</Btn>
              </form>
            )}
          </Card>

          {planifiee && gestion && (
            <Card className="p-5 flex flex-col gap-3">
              <details>
                <summary className="text-sm font-bold text-blue cursor-pointer select-none">Déplacer la formation</summary>
                <form action={reporterSession} className="flex flex-col gap-2 mt-2">
                  <input type="hidden" name="sessionId" value={s.id} />
                  <Field label="Nouvelle date et heure">
                    <input type="datetime-local" name="dateDebut" required defaultValue={toDatetimeLocalValue(s.dateDebut)} className={inputClass} />
                  </Field>
                  <Field label="Lieu">
                    <select name="lieu" defaultValue={s.lieu} className={inputClass}>
                      {Object.entries(LIEUX_FORMATION).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Btn variant="ghost" className="self-start">Déplacer et prévenir</Btn>
                </form>
              </details>
              <details className="border-t border-line pt-3">
                <summary className="text-sm font-bold text-red-ink cursor-pointer select-none">Annuler la formation</summary>
                <form action={annulerSession} className="flex flex-col gap-2 mt-2">
                  <input type="hidden" name="sessionId" value={s.id} />
                  <input name="motif" required placeholder="Motif de l'annulation" className={inputClass} />
                  <Btn variant="ghost" className="self-start">Annuler et prévenir</Btn>
                </form>
              </details>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function EtatParticipant({ p }: { p: typeof formationsParticipants.$inferSelect }) {
  if (p.emargeLe) return <Pill tone="ok">Présence signée {formatDateTime(p.emargeLe).split(" ")[1]}</Pill>;
  if (p.reponse === "confirme") return <Pill tone="ok">Confirmé</Pill>;
  if (p.reponse === "indisponible") return <Pill tone="crit">Indisponible</Pill>;
  return <Pill tone="warn">Sans réponse</Pill>;
}
