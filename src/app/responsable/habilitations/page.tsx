import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { Download, GraduationCap } from "lucide-react";
import { db } from "@/db";
import { formationsParticipants, formationsSessions, habilitationsCatalogue, habilitationsTechnicien, technicienFiches, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { Btn, Card, Field, Pill, inputClass } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { CATEGORIES_HABILITATION, EXIGENCES_MISSION, STATUT_HAB, habilitationsCourantes } from "@/lib/habilitations";
import { creerSession, deciderCertificat, enregistrerCatalogue } from "./actions";
import { ACCEPT_FICHIERS_JOINTS } from "@/lib/fichiers";

// Phase 19 : Habilitations & formations — matrice des compétences, catalogue,
// sessions de formation, certificats déposés par les techniciens à valider.

const ONGLETS = [
  { id: "matrice", label: "Matrice des compétences" },
  { id: "a_valider", label: "Certificats à valider" },
  { id: "sessions", label: "Formations (planning)" },
  { id: "catalogue", label: "Catalogue" },
] as const;

const LIEUX: Record<string, string> = { terrain: "Terrain", bureau: "Bureau", ecole: "École / organisme" };

async function techniciensActifs() {
  return db
    .select({ id: users.id, nom: users.nom })
    .from(users)
    .leftJoin(technicienFiches, eq(technicienFiches.technicienId, users.id))
    .where(sql`${users.role} = 'technicien' and ${users.actif} = 1 and coalesce(${technicienFiches.statutRh}::text, '') <> 'sorti_effectifs'`)
    .orderBy(asc(users.nom));
}

export default async function HabilitationsPage({ searchParams }: { searchParams: Promise<{ onglet?: string; technicien?: string }> }) {
  const user = await requireUser(ROLES_BUREAU);
  const { onglet: o, technicien: techPre } = await searchParams;
  const onglet = ONGLETS.some((x) => x.id === o) ? (o as (typeof ONGLETS)[number]["id"]) : "matrice";
  const gestion = user.role === "administrateur" || user.role === "responsable_qualite";

  const [catalogue, techs, habs, enAttente] = await Promise.all([
    db.select().from(habilitationsCatalogue).orderBy(desc(habilitationsCatalogue.actif), asc(habilitationsCatalogue.nom)),
    techniciensActifs(),
    habilitationsCourantes(),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(habilitationsTechnicien)
      .where(eq(habilitationsTechnicien.statut, "en_attente"))
      .then((r) => r[0]?.n ?? 0),
  ]);
  const actifs = catalogue.filter((c) => c.actif);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold font-display flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-blue" /> Formations &amp; habilitations
          </h1>
          <p className="text-sm text-ink-soft">
            Planifier les formations, valider les certificats, suivre les compétences — ISO 9001 §7.2. Les documents à lire sont dans la{" "}
            <Link href="/responsable/documents" className="font-semibold text-blue">Bibliothèque</Link>.
          </p>
        </div>
        <a href="/api/export/matrice-competences" className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold border border-line hover:bg-blue-pale">
          <Download className="w-4 h-4" /> Matrice PDF (audit)
        </a>
      </div>

      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {ONGLETS.map((t) => (
          <Link
            key={t.id}
            href={`/responsable/habilitations?onglet=${t.id}`}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px ${onglet === t.id ? "border-blue text-navy font-bold" : "border-transparent text-ink-soft"}`}
          >
            {t.label}
            {t.id === "a_valider" && enAttente > 0 && <span className="ml-1.5 text-[11px] font-bold text-white bg-red-ink rounded-full px-1.5">{enAttente}</span>}
          </Link>
        ))}
      </div>

      {onglet === "matrice" && (
        <Card className="p-5">
          <div className="flex flex-wrap gap-3 text-xs mb-4">
            {(["valide", "bientot", "expiree", "sans_certificat", "en_attente"] as const).map((k) => (
              <span key={k}>{STATUT_HAB[k].pastille} {STATUT_HAB[k].label}</span>
            ))}
            <span>— Absente</span>
            <span className="font-semibold text-red-ink">* obligatoire pour des missions</span>
          </div>
          {techs.length === 0 || actifs.length === 0 ? (
            <p className="text-sm text-ink-soft">Ajoutez des techniciens et des habilitations au catalogue.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-sm border-collapse min-w-full">
                <thead>
                  <tr>
                    <th className="text-left p-2 sticky left-0 bg-surface min-w-[160px]">Technicien</th>
                    {actifs.map((c) => (
                      <th key={c.id} className="p-2 text-[11px] font-bold text-ink-soft align-bottom min-w-[96px]">
                        {c.nom}
                        {c.obligatoire ? <span className="text-red-ink"> *</span> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {techs.map((t) => (
                    <tr key={t.id} className="border-t border-line">
                      <td className="p-2 sticky left-0 bg-surface">
                        <Link href={`/responsable/techniciens/${t.id}?tab=habilitations`} className="font-semibold text-blue hover:underline">{t.nom}</Link>
                      </td>
                      {actifs.map((c) => {
                        const h = habs
                          .filter((x) => x.technicienId === t.id && x.catalogueId === c.id)
                          .sort((a, b) => b.dateObtention.getTime() - a.dateObtention.getTime())[0];
                        const s = h ? STATUT_HAB[h.etat] : null;
                        return (
                          <td key={c.id} className="p-2 text-center" title={h ? `${s!.label}${h.dateExpiration ? ` — ${formatDate(h.dateExpiration)}` : ""}` : "Absente"}>
                            {s ? (
                              <span className="inline-flex flex-col items-center">
                                <span className="text-base leading-none">{s.pastille}</span>
                                {h!.dateExpiration && <span className="text-[10px] text-ink-soft tabular">{formatDate(h!.dateExpiration)}</span>}
                              </span>
                            ) : (
                              <span className={c.obligatoire ? "text-red-ink font-bold" : "text-ink-soft"}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {onglet === "a_valider" && <CertificatsAValider gestion={gestion} />}
      {onglet === "sessions" && <Sessions gestion={gestion} catalogue={actifs} techs={techs} preselection={techPre} />}

      {onglet === "catalogue" && (
        <div className="flex flex-col gap-3">
          {gestion && (
            <Card className="p-5">
              <details>
                <summary className="font-display font-bold text-sm cursor-pointer select-none text-blue">+ Nouveau type d&apos;habilitation (catalogue)</summary>
                <FormCatalogue />
              </details>
            </Card>
          )}
          {catalogue.map((c) => (
            <Card key={c.id} className={`p-4 ${c.actif ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold">{c.nom} {c.pays ? <span className="text-xs text-ink-soft">({c.pays})</span> : null}</div>
                  <div className="text-xs text-ink-soft">
                    {CATEGORIES_HABILITATION[c.categorie] ?? c.categorie} · {c.validiteMois ? `valable ${c.validiteMois} mois` : "sans échéance"} · alerte {c.alerteJours} j avant
                    {c.certificatObligatoire ? " · certificat obligatoire" : ""}
                  </div>
                  {c.obligatoire ? (
                    <div className="text-xs text-red-ink font-semibold mt-0.5">
                      Obligatoire : {c.typesMission.map((t) => EXIGENCES_MISSION[t] ?? t).join(", ")}
                      {c.marques.length ? ` · marques : ${c.marques.join(", ")}` : ""}
                    </div>
                  ) : (
                    <div className="text-xs text-ink-soft mt-0.5">Non bloquante</div>
                  )}
                  {c.description && <div className="text-xs text-ink-soft mt-1">{c.description}</div>}
                </div>
                {!c.actif && <Pill tone="neutral">Désactivée</Pill>}
              </div>
              {gestion && (
                <details className="mt-2">
                  <summary className="text-xs font-bold text-blue cursor-pointer select-none">Modifier</summary>
                  <FormCatalogue c={c} />
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function FormCatalogue({ c }: { c?: typeof habilitationsCatalogue.$inferSelect }) {
  return (
    <form action={enregistrerCatalogue} className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
      {c && <input type="hidden" name="id" value={c.id} />}
      <Field label="Nom">
        <input name="nom" required defaultValue={c?.nom} className={inputClass} />
      </Field>
      <Field label="Catégorie">
        <select name="categorie" defaultValue={c?.categorie ?? "interne"} className={inputClass}>
          {Object.entries(CATEGORIES_HABILITATION).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </Field>
      <Field label="Validité (mois) — vide = sans échéance">
        <input name="validiteMois" type="number" min={1} defaultValue={c?.validiteMois ?? ""} className={inputClass} />
      </Field>
      <Field label="Alerte avant l'échéance (jours)">
        <input name="alerteJours" type="number" min={1} defaultValue={c?.alerteJours ?? 60} className={inputClass} />
      </Field>
      <Field label="Pays (FR, BE… facultatif)">
        <input name="pays" defaultValue={c?.pays ?? ""} className={inputClass} />
      </Field>
      <Field label="Marques concernées (séparées par des virgules)">
        <input name="marques" defaultValue={c?.marques.join(", ") ?? ""} placeholder="Ex. Schindler, Otis" className={inputClass} />
      </Field>
      <div className="md:col-span-2">
        <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1.5">Obligatoire pour (bloque l&apos;affectation si absente / expirée)</div>
        <div className="flex flex-wrap gap-3">
          {Object.entries(EXIGENCES_MISSION).map(([k, v]) => (
            <label key={k} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="typesMission" value={k} defaultChecked={c?.typesMission.includes(k)} /> {v}
            </label>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="certificatObligatoire" defaultChecked={c ? !!c.certificatObligatoire : true} /> Certificat obligatoire
      </label>
      {c && (
        <Field label="État">
          <select name="actif" defaultValue={c.actif ? "on" : "off"} className={inputClass}>
            <option value="on">Active</option>
            <option value="off">Désactivée</option>
          </select>
        </Field>
      )}
      <div className="md:col-span-2">
        <Field label="Description (facultatif)">
          <textarea name="description" rows={2} defaultValue={c?.description ?? ""} className={inputClass} />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Btn>{c ? "Enregistrer" : "Ajouter au catalogue"}</Btn>
      </div>
    </form>
  );
}

async function CertificatsAValider({ gestion }: { gestion: boolean }) {
  const rows = await db
    .select({ h: habilitationsTechnicien, technicien: users.nom, nom: habilitationsCatalogue.nom })
    .from(habilitationsTechnicien)
    .innerJoin(users, eq(habilitationsTechnicien.technicienId, users.id))
    .leftJoin(habilitationsCatalogue, eq(habilitationsTechnicien.catalogueId, habilitationsCatalogue.id))
    .where(eq(habilitationsTechnicien.statut, "en_attente"))
    .orderBy(asc(habilitationsTechnicien.createdAt));
  if (!rows.length) return <Card className="p-5"><p className="text-sm text-ink-soft">Aucun certificat en attente.</p></Card>;
  return (
    <div className="flex flex-col gap-3">
      {rows.map(({ h, technicien, nom }) => (
        <Card key={h.id} className="p-4 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="font-semibold">{technicien} — {nom}</div>
              <div className="text-xs text-ink-soft">
                Obtenue le {formatDate(h.dateObtention)}{h.dateExpiration ? ` · expire le ${formatDate(h.dateExpiration)}` : ""}
                {h.organisme ? ` · ${h.organisme}` : ""}{h.numeroCertificat ? ` · n° ${h.numeroCertificat}` : ""} · déposé le {formatDateTime(h.createdAt)}
              </div>
            </div>
            {h.certificatUrl && (
              <a href={h.certificatUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue">Voir le certificat</a>
            )}
          </div>
          {gestion && (
            <div className="flex flex-wrap items-end gap-2">
              <form action={deciderCertificat}>
                <input type="hidden" name="habilitationId" value={h.id} />
                <input type="hidden" name="decision" value="valider" />
                <Btn>Valider</Btn>
              </form>
              <form action={deciderCertificat} className="flex items-end gap-2">
                <input type="hidden" name="habilitationId" value={h.id} />
                <input type="hidden" name="decision" value="refuser" />
                <input name="motif" required placeholder="Motif du refus" className={`${inputClass} w-56`} />
                <Btn variant="ghost">Refuser</Btn>
              </form>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

async function Sessions({
  gestion,
  catalogue,
  techs,
  preselection,
}: {
  preselection?: string;
  gestion: boolean;
  catalogue: (typeof habilitationsCatalogue.$inferSelect)[];
  techs: { id: string; nom: string }[];
}) {
  const sessions = await db
    .select({
      s: formationsSessions,
      habilitation: habilitationsCatalogue.nom,
      inscrits: sql<number>`(select count(*)::int from ${formationsParticipants} p where p.session_id = ${formationsSessions.id})`,
      confirmes: sql<number>`(select count(*)::int from ${formationsParticipants} p where p.session_id = ${formationsSessions.id} and p.reponse = 'confirme')`,
      emarges: sql<number>`(select count(*)::int from ${formationsParticipants} p where p.session_id = ${formationsSessions.id} and p.emarge_le is not null)`,
    })
    .from(formationsSessions)
    .leftJoin(habilitationsCatalogue, eq(formationsSessions.catalogueId, habilitationsCatalogue.id))
    .orderBy(desc(formationsSessions.dateDebut))
    .limit(100);
  return (
    <div className="flex flex-col gap-3">
      {gestion && (
        <Card className="p-5">
          <details open={!!preselection || undefined}>
            <summary className="font-display font-bold text-sm cursor-pointer select-none text-blue">+ Planifier une formation</summary>
            <form action={creerSession} className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <Field label="Titre">
                <input name="titre" required className={inputClass} placeholder="Ex. Recyclage habilitation électrique" />
              </Field>
              <Field label="Habilitation délivrée si réussie (facultatif)">
                <select name="catalogueId" defaultValue="" className={inputClass}>
                  <option value="">Aucune</option>
                  {catalogue.map((c) => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </Field>
              <Field label="Date et heure">
                <input type="datetime-local" name="dateDebut" required className={inputClass} />
              </Field>
              <Field label="Durée (heures)">
                <input type="number" name="dureeHeures" min={0} step="0.5" className={inputClass} />
              </Field>
              <Field label="Lieu">
                <select name="lieu" defaultValue="bureau" className={inputClass}>
                  {Object.entries(LIEUX).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Formateur / organisme">
                <input name="organisme" className={inputClass} />
              </Field>
              <div className="md:col-span-2">
                <Field label="Programme (facultatif)">
                  <textarea name="programme" rows={2} className={inputClass} />
                </Field>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1.5">Techniciens inscrits</div>
                <div className="flex flex-wrap gap-3">
                  {techs.map((t) => (
                    <label key={t.id} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" name="technicienIds" value={t.id} defaultChecked={t.id === preselection} /> {t.nom}
                    </label>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2">
                <Field label="Documents de la formation (support, programme… facultatif)">
                  <input type="file" name="documents" multiple accept={ACCEPT_FICHIERS_JOINTS} className="text-sm" />
                </Field>
                <p className="text-xs text-ink-soft mt-1">Rangés aussi dans la Bibliothèque (catégorie « Formations internes ») et sur la fiche de chaque participant.</p>
              </div>
              <div className="md:col-span-2">
                <Btn>Planifier et prévenir les techniciens</Btn>
                <span className="text-xs text-ink-soft ml-3">Notification + email · la formation apparaît dans leur planning · ils confirment leur présence.</span>
              </div>
            </form>
          </details>
        </Card>
      )}
      {sessions.map(({ s, habilitation, inscrits, confirmes, emarges }) => (
        <Link key={s.id} href={`/responsable/habilitations/sessions/${s.id}`} className="block">
          <Card className="p-4 hover:bg-blue-pale/30 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-semibold">{s.titre}</div>
              <div className="text-xs text-ink-soft">
                {formatDateTime(s.dateDebut)} · {LIEUX[s.lieu] ?? s.lieu}{s.organisme ? ` · ${s.organisme}` : ""} · {inscrits} inscrit(s)
                {s.statut === "planifiee" ? ` · ${confirmes}/${inscrits} confirmé(s)${emarges ? ` · ${emarges} présence(s) signée(s)` : ""}` : ""}
                {habilitation ? ` · délivre « ${habilitation} »` : ""}
              </div>
            </div>
            <Pill tone={s.statut === "terminee" ? "ok" : s.statut === "annulee" ? "neutral" : "warn"}>
              {s.statut === "terminee" ? "Validée" : s.statut === "annulee" ? "Annulée" : "Planifiée"}
            </Pill>
          </Card>
        </Link>
      ))}
      {sessions.length === 0 && <Card className="p-5"><p className="text-sm text-ink-soft">Aucune formation planifiée.</p></Card>}
    </div>
  );
}
