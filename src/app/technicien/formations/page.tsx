import { Card, Pill, Btn } from "@/components/ui";
import { habilitationsCourantes } from "@/lib/habilitations";
import { CATEGORIES_DOCUMENT, CATEGORIE_DOCUMENT_LABEL, estCategorie, libelleCategorie } from "@/lib/documents";
import Link from "next/link";
import { db } from "@/db";
import { documentsFormations, formationsConsultations, formationsParticipants, formationsSessions, habilitationsCatalogue } from "@/db/schema";
import { and, desc, eq, ilike, ne } from "drizzle-orm";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { formatDate, formatDateTime } from "@/lib/format";
import { consulterDocument } from "./actions";

const LIEU_SESSION: Record<string, string> = { terrain: "Sur le terrain", bureau: "Au bureau", ecole: "École / organisme" };

const LIEU_FORMATION_LABEL: Record<string, string> = {
  terrain: "Sur le terrain",
  bureau: "Au bureau",
  ecole: "École / centre de formation",
};

export default async function FormationsPage({
  searchParams,
}: {
  searchParams: Promise<{ categorie?: string; q?: string }>;
}) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const { categorie, q } = await searchParams;
  // Phase 19b : les sessions de formation auxquelles le technicien est inscrit
  // (la notification « Formation planifiée » renvoie ici).
  const mesSessionsP = db
    .select({
      id: formationsSessions.id,
      titre: formationsSessions.titre,
      dateDebut: formationsSessions.dateDebut,
      dureeHeures: formationsSessions.dureeHeures,
      lieu: formationsSessions.lieu,
      organisme: formationsSessions.organisme,
      programme: formationsSessions.programme,
      statut: formationsSessions.statut,
      habilitation: habilitationsCatalogue.nom,
      present: formationsParticipants.present,
      resultat: formationsParticipants.resultat,
      reponse: formationsParticipants.reponse,
      emargeLe: formationsParticipants.emargeLe,
    })
    .from(formationsParticipants)
    .innerJoin(formationsSessions, eq(formationsParticipants.sessionId, formationsSessions.id))
    .leftJoin(habilitationsCatalogue, eq(formationsSessions.catalogueId, habilitationsCatalogue.id))
    .where(and(eq(formationsParticipants.technicienId, user.id), ne(formationsSessions.statut, "annulee")))
    .orderBy(desc(formationsSessions.dateDebut));

  const categorieValide = estCategorie(categorie) ? categorie : undefined;

  const filters = [
    categorieValide ? eq(documentsFormations.categorie, categorieValide) : undefined,
    q ? ilike(documentsFormations.titre, `%${q}%`) : undefined,
  ].filter(Boolean);

  const [mesSessions, documents, habilitations, consultations] = await Promise.all([
    mesSessionsP,
    db
      .select()
      .from(documentsFormations)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(documentsFormations.createdAt)),
    habilitationsCourantes([user.id]),
    db
      .select({ documentId: formationsConsultations.documentId, dateConsultation: formationsConsultations.dateConsultation })
      .from(formationsConsultations)
      .where(eq(formationsConsultations.technicienId, user.id))
      .orderBy(desc(formationsConsultations.dateConsultation)),
  ]);

  const aVenir = mesSessions.filter((x) => x.statut !== "terminee").reverse();
  const passees = mesSessions.filter((x) => x.statut === "terminee");
  const derniereConsultation = new Map<string, Date>();
  for (const c of consultations) {
    if (!derniereConsultation.has(c.documentId)) derniereConsultation.set(c.documentId, c.dateConsultation);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-extrabold font-display">Formations &amp; documentation</h1>
        <p className="text-sm text-ink-soft">Vos formations planifiées, puis les notices, procédures et vidéos.</p>
      </div>

      <section id="sessions" className="scroll-mt-20">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">
          Mes formations à venir ({aVenir.length})
        </h2>
        <div className="flex flex-col gap-2.5">
          {aVenir.map((x) => (
            <Link key={x.id} href={`/technicien/formations/${x.id}`} className="block">
              <Card className="p-4 border-[1.5px] border-[#d9d0ff] bg-[#f8f6ff]">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-display font-bold text-[15px]">🎓 {x.titre}</div>
                  <Pill tone={x.emargeLe || x.reponse === "confirme" ? "ok" : x.reponse === "indisponible" ? "crit" : "warn"}>
                    {x.emargeLe ? "Présence signée" : x.reponse === "confirme" ? "Confirmée" : x.reponse === "indisponible" ? "Indisponible" : "À confirmer"}
                  </Pill>
                </div>
                <div className="text-sm mt-1 font-semibold text-navy">{formatDateTime(x.dateDebut)}{x.dureeHeures ? ` · ${x.dureeHeures} h` : ""}</div>
                <div className="text-[13px] text-ink-soft">
                  {LIEU_SESSION[x.lieu] ?? x.lieu}{x.organisme ? ` · ${x.organisme}` : ""}
                  {x.habilitation ? ` · délivre « ${x.habilitation} »` : ""}
                </div>
              </Card>
            </Link>
          ))}
          {aVenir.length === 0 && <p className="text-sm text-ink-soft">Aucune formation planifiée pour l&apos;instant.</p>}
          {passees.length > 0 && (
            <details className="mt-1">
              <summary className="text-xs font-bold text-blue cursor-pointer select-none">Formations suivies — attestations ({passees.length})</summary>
              <div className="flex flex-col gap-2 mt-2">
                {passees.map((x) => (
                  <Link key={x.id} href={`/technicien/formations/${x.id}`} className="rounded-xl border border-line bg-surface p-3 text-sm flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-semibold">{x.titre}</span>
                      <span className="block text-xs text-ink-soft">{formatDate(x.dateDebut)}</span>
                    </span>
                    <Pill tone={x.present === 0 ? "crit" : x.resultat === "reussi" ? "ok" : "warn"}>
                      {x.present === 0 ? "Absent" : x.resultat === "reussi" ? "Réussie" : x.resultat === "a_refaire" ? "À refaire" : "Terminée"}
                    </Pill>
                  </Link>
                ))}
              </div>
            </details>
          )}
        </div>
      </section>

      <Link href="/technicien/profil#habilitations" className="rounded-2xl border border-line bg-surface px-4 py-3 flex items-center justify-between gap-3">
        <span className="text-sm">
          <span className="font-bold">Mes habilitations</span>
          <span className="block text-ink-soft text-[13px]">
            {habilitations.filter((h) => h.etat === "valide" || h.etat === "bientot").length} valide(s)
            {habilitations.some((h) => h.etat === "expiree" || h.etat === "bientot") ? " · à renouveler bientôt" : ""} — certificats sur votre profil
          </span>
        </span>
        <span className="text-blue font-bold">→</span>
      </Link>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">
          Bibliothèque
        </h2>

        <form method="get" className="flex flex-wrap items-center gap-2 mb-3">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Rechercher un titre..."
            className="flex-1 min-w-[140px] rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-accent focus:border-blue bg-surface"
          />
          <select
            name="categorie"
            defaultValue={categorie ?? ""}
            className="rounded-lg border border-line px-3 py-2 text-sm bg-surface"
          >
            <option value="">Toutes catégories</option>
            {CATEGORIES_DOCUMENT.map((c) => (
              <option key={c} value={c}>
                {CATEGORIE_DOCUMENT_LABEL[c]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="text-sm font-bold rounded-lg px-3 py-2 bg-blue text-white hover:bg-blue-light"
          >
            Filtrer
          </button>
        </form>

        <div className="flex flex-col gap-3">
          {documents.map((d) => {
            const consulteLe = derniereConsultation.get(d.id);
            const hasUrl = !!d.urlFichier;
            return (
              <Card key={d.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display font-bold text-sm">{d.titre}</span>
                      <Pill tone="neutral">{libelleCategorie(d.categorie)}</Pill>
                      {d.estFormation === 1 && <Pill tone="ok">Lecture obligatoire</Pill>}
                    </div>
                    <div className="text-xs text-ink-soft mt-1">
                      {d.typeContenu === "video" ? "Vidéo" : "Document"}
                      {d.marque ? ` · ${d.marque}` : ""}
                      {d.typeAppareilConcerne ? ` · ${d.typeAppareilConcerne}` : ""}
                      {d.lieuFormation ? ` · ${LIEU_FORMATION_LABEL[d.lieuFormation]}` : ""}
                    </div>
                    {consulteLe && (
                      <div className="text-xs text-ink-soft mt-1">
                        Consulté le {formatDate(consulteLe)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {hasUrl && (
                    <a
                      href={d.urlFichier!}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold border border-line text-ink hover:bg-blue-pale"
                    >
                      Voir
                    </a>
                  )}
                  <form action={consulterDocument}>
                    <input type="hidden" name="documentId" value={d.id} />
                    <Btn variant="ghost" className="text-xs px-3 py-1.5">
                      {d.estFormation === 1 ? "J'ai lu et compris" : "J'ai consulté ce document"}
                    </Btn>
                  </form>
                </div>
              </Card>
            );
          })}
          {documents.length === 0 && (
            <p className="text-sm text-ink-soft">Aucun document ne correspond à ces critères.</p>
          )}
        </div>
      </section>
    </div>
  );
}
