import { Card, Pill, Btn, Field, inputClass } from "@/components/ui";
import { FileField } from "@/components/file-field";
import { db } from "@/db";
import { auditeurs, audits, documentsFormations } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { desc, eq, asc } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import { createAudit, updateAuditResultats } from "./actions";
import { createDocument } from "../documents/actions";
import { FICHIER_MAX_BYTES, FICHIER_TYPES } from "@/lib/document-file-rules";

const TYPE_LABEL: Record<string, string> = {
  interne: "Interne",
  externe: "Externe",
};

const STATUT_LABEL: Record<string, string> = {
  planifie: "Planifié",
  en_cours: "En cours",
  termine: "Terminé",
};

const STATUT_TONE: Record<string, "ok" | "warn" | "crit" | "neutral"> = {
  planifie: "neutral",
  en_cours: "warn",
  termine: "ok",
};

// Phase 9a : catégorie d'un document — même liste que Documents & formations
// et la fiche Projet (dupliquée localement, comme dans ces deux pages, pour
// rester simple sans faire dépendre les pages les unes des autres).
const CATEGORIES_DOC = [
  "securite",
  "installation",
  "maintenance",
  "depannage",
  "marques",
  "procedures_robus",
  "videos",
  "fournisseur_iso",
] as const;
const CATEGORIE_DOC_LABEL: Record<string, string> = {
  securite: "Sécurité",
  installation: "Installation",
  maintenance: "Maintenance",
  depannage: "Dépannage",
  marques: "Marques",
  procedures_robus: "Procédures Robus",
  videos: "Vidéos",
  fournisseur_iso: "Fournisseur / ISO 9001",
};

async function getAudits() {
  return db
    .select({
      id: audits.id,
      type: audits.type,
      statut: audits.statut,
      titre: audits.titre,
      datePlanifiee: audits.datePlanifiee,
      dateRealisation: audits.dateRealisation,
      constats: audits.constats,
      actionsSuivi: audits.actionsSuivi,
      auditeurNom: auditeurs.nom,
      auditeurOrganisme: auditeurs.organisme,
    })
    .from(audits)
    .leftJoin(auditeurs, eq(audits.auditeurFicheId, auditeurs.id))
    .orderBy(desc(audits.datePlanifiee));
}

async function getAuditeurs() {
  return db
    .select({ id: auditeurs.id, nom: auditeurs.nom, organisme: auditeurs.organisme })
    .from(auditeurs)
    .orderBy(asc(auditeurs.nom));
}

async function getDocumentsParAudit() {
  return db
    .select({
      id: documentsFormations.id,
      auditId: documentsFormations.auditId,
      titre: documentsFormations.titre,
      categorie: documentsFormations.categorie,
      urlFichier: documentsFormations.urlFichier,
      createdAt: documentsFormations.createdAt,
    })
    .from(documentsFormations)
    .orderBy(desc(documentsFormations.createdAt));
}

export default async function AuditsPage() {
  await requireUser(ROLES_BUREAU);
  const [rows, auditeursOptions, documentsRows] = await Promise.all([
    getAudits(),
    getAuditeurs(),
    getDocumentsParAudit(),
  ]);

  const documentsParAudit = new Map<string, (typeof documentsRows)[number][]>();
  for (const d of documentsRows) {
    if (!d.auditId) continue;
    const liste = documentsParAudit.get(d.auditId) ?? [];
    liste.push(d);
    documentsParAudit.set(d.auditId, liste);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold font-display">Audits internes &amp; externes</h1>
          <p className="text-sm text-ink-soft">{rows.length} audit(s) enregistré(s)</p>
        </div>
        <a href="/responsable/auditeurs" className="text-xs font-bold text-blue hover:underline">
          Gérer les auditeurs →
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-col divide-y divide-line">
            {rows.map((a) => {
              const documentsAudit = documentsParAudit.get(a.id) ?? [];
              return (
                <div key={a.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Pill tone="neutral">{TYPE_LABEL[a.type] ?? a.type}</Pill>
                        <Pill tone={STATUT_TONE[a.statut] ?? "neutral"}>
                          {STATUT_LABEL[a.statut] ?? a.statut}
                        </Pill>
                      </div>
                      <div className="font-semibold text-sm mt-1.5">{a.titre}</div>
                      <div className="text-xs text-ink-soft mt-0.5">
                        Planifié : {formatDate(a.datePlanifiee)} · Réalisé : {formatDate(a.dateRealisation)}
                        {" · "}Auditeur :{" "}
                        {a.auditeurNom
                          ? `${a.auditeurNom}${a.auditeurOrganisme ? ` (${a.auditeurOrganisme})` : ""}`
                          : "Non assigné"}
                      </div>
                    </div>
                  </div>

                  {(a.statut === "planifie" || a.statut === "en_cours") && (
                    <form
                      action={updateAuditResultats}
                      className="mt-3 flex flex-col gap-2 bg-blue-pale/40 rounded-xl p-3"
                    >
                      <input type="hidden" name="auditId" value={a.id} />
                      <Field label="Constats">
                        <textarea
                          name="constats"
                          rows={2}
                          defaultValue={a.constats ?? ""}
                          className={inputClass}
                          placeholder="Constats de l'audit..."
                        />
                      </Field>
                      <Field label="Actions de suivi">
                        <textarea
                          name="actionsSuivi"
                          rows={2}
                          defaultValue={a.actionsSuivi ?? ""}
                          className={inputClass}
                          placeholder="Actions correctives / préventives..."
                        />
                      </Field>
                      <div className="flex items-center gap-3 mt-1">
                        <Btn variant="ghost" type="submit">
                          Enregistrer
                        </Btn>
                        <button
                          type="submit"
                          name="terminer"
                          value="true"
                          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold font-display bg-blue text-white hover:bg-blue-light transition-colors"
                        >
                          Marquer terminé
                        </button>
                      </div>
                    </form>
                  )}

                  {a.statut === "termine" && (a.constats || a.actionsSuivi) && (
                    <div className="mt-3 text-xs text-ink-soft bg-blue-pale/40 rounded-xl p-3 flex flex-col gap-1">
                      {a.constats && (
                        <div>
                          <span className="font-semibold text-ink">Constats : </span>
                          {a.constats}
                        </div>
                      )}
                      {a.actionsSuivi && (
                        <div>
                          <span className="font-semibold text-ink">Actions de suivi : </span>
                          {a.actionsSuivi}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Phase 9a : Documents rattachés à cet audit précis. */}
                  <div className="mt-3">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-blue mb-1.5">
                      Documents ({documentsAudit.length})
                    </div>
                    {documentsAudit.length > 0 && (
                      <div className="flex flex-col gap-1 mb-2">
                        {documentsAudit.map((d) => (
                          <div key={d.id} className="flex items-center gap-2 text-xs">
                            <Pill tone="neutral">{CATEGORIE_DOC_LABEL[d.categorie] ?? d.categorie}</Pill>
                            {d.urlFichier ? (
                              <a
                                href={d.urlFichier}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue font-semibold hover:underline truncate"
                              >
                                {d.titre}
                              </a>
                            ) : (
                              <span className="truncate">{d.titre}</span>
                            )}
                            <span className="text-ink-soft whitespace-nowrap">{formatDate(d.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <details>
                      <summary className="text-xs font-bold text-blue cursor-pointer select-none">
                        + Ajouter un document à cet audit
                      </summary>
                      <form
                        action={createDocument}
                        encType="multipart/form-data"
                        className="flex flex-col gap-2 mt-2 max-w-md"
                      >
                        <input type="hidden" name="auditId" value={a.id} />
                        <input type="hidden" name="redirectTo" value="/responsable/audits" />
                        <Field label="Titre">
                          <input
                            name="titre"
                            required
                            className={inputClass}
                            placeholder="Rapport final, plan d'action..."
                          />
                        </Field>
                        <Field label="Catégorie">
                          <select name="categorie" className={inputClass} defaultValue="procedures_robus">
                            {CATEGORIES_DOC.map((c) => (
                              <option key={c} value={c}>
                                {CATEGORIE_DOC_LABEL[c]}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Type de contenu">
                          <select name="typeContenu" className={inputClass} defaultValue="document">
                            <option value="document">Document (PDF / notice)</option>
                            <option value="video">Vidéo</option>
                          </select>
                        </Field>
                        <p className="text-xs text-ink-soft -mt-1">
                          Soit un lien externe, soit un fichier uploadé — au choix.
                        </p>
                        <Field label="URL du fichier (lien externe)">
                          <input name="urlFichier" className={inputClass} placeholder="https://..." />
                        </Field>
                        <FileField
                          label="Ou déposer un fichier (PDF / vidéo, 200 Mo max)"
                          name="fichier"
                          accept={Object.keys(FICHIER_TYPES).join(",")}
                          maxBytes={FICHIER_MAX_BYTES}
                        />
                        <Btn variant="ghost" className="self-start !text-xs" type="submit">
                          Ajouter
                        </Btn>
                      </form>
                    </details>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun audit pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">Nouvel audit</h2>
          <form action={createAudit} className="flex flex-col gap-3">
            <Field label="Type d'audit">
              <select name="type" className={inputClass} defaultValue="interne">
                <option value="interne">Interne</option>
                <option value="externe">Externe</option>
              </select>
            </Field>
            <Field label="Titre">
              <input
                name="titre"
                required
                className={inputClass}
                placeholder="Audit qualité annuel..."
              />
            </Field>
            <Field label="Date planifiée">
              <input type="date" name="datePlanifiee" className={inputClass} />
            </Field>
            <Field label="Auditeur">
              <select name="auditeurFicheId" className={inputClass} defaultValue="">
                <option value="">Non assigné</option>
                {auditeursOptions.map((au) => (
                  <option key={au.id} value={au.id}>
                    {au.nom}
                    {au.organisme ? ` (${au.organisme})` : ""}
                  </option>
                ))}
              </select>
              {auditeursOptions.length === 0 && (
                <p className="text-xs text-ink-soft mt-1">
                  Aucun auditeur enregistré —{" "}
                  <a href="/responsable/auditeurs" className="text-blue font-semibold hover:underline">
                    créez-en un
                  </a>
                  .
                </p>
              )}
            </Field>
            <Btn>Créer l&apos;audit</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
