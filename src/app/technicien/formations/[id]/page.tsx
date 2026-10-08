import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { documentsFormations, formationsConsultations, formationsParticipants, formationsSessions, habilitationsCatalogue, users } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { formatDateTime } from "@/lib/format";
import { Btn, Card, Pill } from "@/components/ui";
import { LIEUX_FORMATION, dateFormation, fenetreEmargement } from "@/lib/formations";
import { consulterDocument, emargerFormation, repondreFormation } from "../actions";
import { BoutonEnvoi } from "@/components/bouton-envoi";

// Phase 21 : une formation vue par le technicien — date, lieu, programme,
// documents, sa réponse, la signature de présence le jour J, le résultat.
export default async function FormationTechnicienPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; erreur?: string }>;
}) {
  const user = await requireUser(["technicien"]);
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ s: formationsSessions, p: formationsParticipants, habilitation: habilitationsCatalogue.nom, formateur: users.nom })
    .from(formationsParticipants)
    .innerJoin(formationsSessions, eq(formationsParticipants.sessionId, formationsSessions.id))
    .leftJoin(habilitationsCatalogue, eq(formationsSessions.catalogueId, habilitationsCatalogue.id))
    .leftJoin(users, eq(formationsSessions.creeParId, users.id))
    .where(and(eq(formationsParticipants.sessionId, id), eq(formationsParticipants.technicienId, user.id)))
    .limit(1);
  if (!row) notFound();
  const { s, p } = row;
  const documents = await db.select().from(documentsFormations).where(eq(documentsFormations.sessionId, id)).orderBy(desc(documentsFormations.createdAt));
  const lus = documents.length
    ? await db
        .select({ documentId: formationsConsultations.documentId })
        .from(formationsConsultations)
        .where(and(eq(formationsConsultations.technicienId, user.id), inArray(formationsConsultations.documentId, documents.map((d) => d.id))))
    : [];
  const dejaLu = new Set(lus.map((l) => l.documentId));
  const aVenir = s.statut === "planifiee";
  // eslint-disable-next-line react-hooks/purity
  const commencee = s.dateDebut.getTime() < Date.now();
  const peutEmarger = aVenir && fenetreEmargement(s.dateDebut) && p.reponse !== "indisponible";

  const etat =
    s.statut === "annulee"
      ? { label: "Annulée", tone: "neutral" as const }
      : s.statut === "terminee"
        ? p.present === 0
          ? { label: "Absent", tone: "crit" as const }
          : p.resultat === "reussi"
            ? { label: "Réussie", tone: "ok" as const }
            : p.resultat === "a_refaire"
              ? { label: "À refaire", tone: "warn" as const }
              : { label: "Terminée", tone: "ok" as const }
        : p.emargeLe
          ? { label: "Présence signée", tone: "ok" as const }
          : p.reponse === "confirme"
            ? { label: "Présence confirmée", tone: "ok" as const }
            : p.reponse === "indisponible"
              ? { label: "Indisponible", tone: "crit" as const }
              : { label: "À confirmer", tone: "warn" as const };

  return (
    <div className="flex flex-col gap-4">
      <Link href="/technicien/formations" className="text-xs text-blue font-semibold">&larr; Mes formations</Link>
      {sp.erreur && <div className="text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">{sp.erreur}</div>}
      {sp.ok === "confirme" && <div className="text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">Présence confirmée — elle est dans votre planning.</div>}
      {sp.ok === "indisponible" && <div className="text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">Le bureau est prévenu de votre indisponibilité.</div>}
      {sp.ok === "emarge" && <div className="text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">Présence signée. Le bureau validera la formation.</div>}

      <Card className="p-4 border-[1.5px] border-[#d9d0ff] bg-[#f8f6ff]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-[#5b3fe0]">🎓 Formation interne</div>
            <h1 className="font-display font-extrabold text-lg text-navy leading-tight">{s.titre}</h1>
          </div>
          <Pill tone={etat.tone}>{etat.label}</Pill>
        </div>
        <div className="text-[15px] font-semibold text-navy mt-2 capitalize">{dateFormation(s.dateDebut)}</div>
        <div className="text-[13px] text-ink-soft">
          {LIEUX_FORMATION[s.lieu] ?? s.lieu}
          {s.dureeHeures ? ` · ${s.dureeHeures} h` : ""}
          {s.organisme ? ` · ${s.organisme}` : ""}
        </div>
        {row.habilitation && <div className="text-[13px] mt-1">Délivre l&apos;habilitation « {row.habilitation} » si réussie.</div>}
        {s.programme && <p className="text-sm mt-3 whitespace-pre-wrap">{s.programme}</p>}
        {s.statut === "annulee" && s.motifAnnulation && <p className="text-sm mt-3 text-red-ink">Annulée : {s.motifAnnulation}</p>}
      </Card>

      {aVenir && !commencee && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Ma présence</h2>
          {p.reponse && (
            <p className="text-sm mb-3">
              Vous avez répondu : <span className="font-semibold">{p.reponse === "confirme" ? "je serai présent" : `indisponible (${p.reponseMotif ?? ""})`}</span>
              {p.reponseLe ? <span className="text-ink-soft"> — {formatDateTime(p.reponseLe)}</span> : null}
            </p>
          )}
          {p.reponse !== "confirme" && (
            <form action={repondreFormation}>
              <input type="hidden" name="sessionId" value={s.id} />
              <input type="hidden" name="reponse" value="confirme" />
              <Btn className="w-full justify-center">Je serai présent</Btn>
            </form>
          )}
          {p.reponse !== "indisponible" && (
            <details className="mt-2">
              <summary className="text-center text-sm font-bold text-red-ink cursor-pointer select-none py-2">Je ne peux pas venir</summary>
              <form action={repondreFormation} className="flex flex-col gap-2 mt-1">
                <input type="hidden" name="sessionId" value={s.id} />
                <input type="hidden" name="reponse" value="indisponible" />
                <textarea name="motif" required rows={2} maxLength={500} placeholder="Pourquoi ? (congé, mission urgente…)" className="rounded-xl border border-line px-3 py-2.5 text-[15px]" />
                <BoutonEnvoi type="submit" className="w-full rounded-xl bg-red text-white font-bold py-3">Prévenir le bureau</BoutonEnvoi>
              </form>
            </details>
          )}
        </Card>
      )}

      {aVenir && (peutEmarger || p.emargeLe) && (
        <Card className="p-4 border-[1.5px] border-green/50">
          <h2 className="font-display font-bold text-sm mb-1">Signature de présence</h2>
          {p.emargeLe ? (
            <p className="text-sm text-green-ink font-semibold">✓ Signée le {formatDateTime(p.emargeLe)}</p>
          ) : (
            <form action={emargerFormation} className="flex flex-col gap-2">
              <input type="hidden" name="sessionId" value={s.id} />
              <p className="text-sm text-ink-soft">À faire sur place, le jour de la formation.</p>
              <Btn className="w-full justify-center">✍️ Je suis présent — je signe</Btn>
            </form>
          )}
        </Card>
      )}

      {s.statut === "terminee" && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Résultat (validé par le bureau)</h2>
          <p className="text-sm">
            {p.present === 0 ? "Absent." : p.resultat === "reussi" ? "Formation réussie." : p.resultat === "a_refaire" ? "Formation à refaire." : "Présent."}
            {p.habilitationId ? " L'habilitation a été ajoutée à votre profil." : ""}
          </p>
          {p.present === 1 && (
            <a href={`/api/export/attestation-formation/${p.id}`} target="_blank" rel="noreferrer" className="inline-block mt-2 text-sm font-bold text-blue">
              📄 Mon attestation de formation (PDF)
            </a>
          )}
        </Card>
      )}

      <Card className="p-4">
        <h2 className="font-display font-bold text-sm mb-2">Documents de la formation ({documents.length})</h2>
        <div className="flex flex-col divide-y divide-line">
          {documents.map((d) => (
            <div key={d.id} className="py-2.5 flex items-center justify-between gap-3">
              {d.urlFichier ? (
                <a href={d.urlFichier} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue truncate">📄 {d.titre}</a>
              ) : (
                <span className="text-sm truncate">{d.titre}</span>
              )}
              {dejaLu.has(d.id) ? (
                <span className="text-xs font-bold text-green-ink whitespace-nowrap">✓ Lu</span>
              ) : (
                <form action={consulterDocument}>
                  <input type="hidden" name="documentId" value={d.id} />
                  <BoutonEnvoi type="submit" className="text-xs font-bold text-blue border border-line rounded-lg px-2.5 py-1.5 whitespace-nowrap">J&apos;ai lu</BoutonEnvoi>
                </form>
              )}
            </div>
          ))}
          {documents.length === 0 && <p className="text-sm text-ink-soft py-1">Le bureau n&apos;a pas encore joint de document.</p>}
        </div>
      </Card>
    </div>
  );
}
