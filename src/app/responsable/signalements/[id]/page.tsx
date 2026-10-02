import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { appareils, clients, interventions, journalActivite, projets, signalements, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { formatDateTime } from "@/lib/format";
import { Btn, Card, Pill, StatutInterventionPill, inputClass } from "@/components/ui";
import { GaleriePhotos } from "@/components/galerie-photos";
import { GRAVITES_SIGNALEMENT, STATUTS_SIGNALEMENT, TYPES_SIGNALEMENT } from "@/lib/signalements-types";
import { STATUTS_NON_COMMENCES } from "@/lib/missions";
import {
  cloturerSignalement,
  creerNcDepuisSignalement,
  libererMissionSignalement,
  prendreEnChargeSignalement,
  repondreSignalement,
  rouvrirSignalement,
} from "../actions";

// Phase 21 : fiche d'un signalement — tout le contexte (technicien, mission,
// projet, appareil), les pièces jointes et les décisions du bureau.
const ACTIONS_JOURNAL: Record<string, string> = {
  cree: "Signalement envoyé par le technicien",
  pris_en_charge: "Pris en charge",
  reponse: "Réponse envoyée au technicien",
  cloture: "Clôturé",
  rouvert: "Rouvert",
  non_conformite_creee: "Non-conformité créée",
};

export default async function SignalementBureauPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(ROLES_BUREAU);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const technicien = alias(users, "technicien");
  const [row] = await db
    .select({
      s: signalements,
      technicien: technicien.nom,
      technicienTel: technicien.telephone,
      appareil: appareils.numeroInterne,
      projetRef: projets.reference,
      projetTitre: projets.titre,
      adresse: projets.adresse,
      client: clients.raisonSociale,
      mStatut: interventions.statut,
      mDate: interventions.dateProgrammee,
      mTechnicienId: interventions.technicienId,
    })
    .from(signalements)
    .innerJoin(technicien, eq(signalements.technicienId, technicien.id))
    .leftJoin(appareils, eq(signalements.appareilId, appareils.id))
    .leftJoin(projets, eq(signalements.projetId, projets.id))
    .leftJoin(clients, eq(projets.clientId, clients.id))
    .leftJoin(interventions, eq(signalements.interventionId, interventions.id))
    .where(eq(signalements.id, id))
    .limit(1);
  if (!row) notFound();
  const s = row.s;
  const historique = await db
    .select({ action: journalActivite.action, details: journalActivite.details, createdAt: journalActivite.createdAt, auteur: users.nom })
    .from(journalActivite)
    .leftJoin(users, eq(journalActivite.utilisateurId, users.id))
    .where(and(eq(journalActivite.entite, "signalement"), sql`${journalActivite.entiteId} = ${id}`))
    .orderBy(desc(journalActivite.createdAt))
    .limit(30);
  const t = TYPES_SIGNALEMENT[s.type];
  const st = STATUTS_SIGNALEMENT[s.statut] ?? STATUTS_SIGNALEMENT.nouveau;
  const g = GRAVITES_SIGNALEMENT[s.gravite];
  const gestion = user.role === "administrateur" || user.role === "responsable_qualite";
  const missionLibre = !!s.interventionId && !!row.mStatut && (STATUTS_NON_COMMENCES as readonly string[]).includes(row.mStatut) && row.mTechnicienId === s.technicienId;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/responsable/signalements" className="text-xs text-blue font-semibold">&larr; Signalements</Link>

      <Card className={`p-5 ${s.gravite === "critique" && s.statut !== "cloture" ? "border-red border-[1.5px]" : ""}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{s.numero} · {formatDateTime(s.createdAt)}</div>
            <h1 className="font-display font-extrabold text-2xl text-navy">{t?.icone} {t?.label ?? s.type}</h1>
            <div className="text-sm text-ink-soft mt-0.5">
              Signalé par{" "}
              <Link href={`/responsable/techniciens/${s.technicienId}?tab=signalements`} className="font-semibold text-blue hover:underline">{row.technicien}</Link>
              {row.technicienTel && (
                <>
                  {" · "}
                  <a href={`tel:${row.technicienTel}`} className="font-semibold text-blue">{row.technicienTel}</a>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 justify-end">
            <Pill tone={st.tone}>{st.label}</Pill>
            {g && <Pill tone={g.tone}>Gravité {g.label.toLowerCase()}</Pill>}
            {s.blesse === 1 && <Pill tone="crit">Personne blessée</Pill>}
            {s.bloquant === 1 && <Pill tone="warn">{t?.questionBloquant ?? "Bloquant"}</Pill>}
          </div>
        </div>
        <p className="text-[15px] mt-4 whitespace-pre-wrap">{s.description}</p>
        {s.lieu && <p className="text-sm text-ink-soft mt-2">Lieu : {s.lieu}</p>}
        {s.photos.length > 0 && (
          <div className="mt-3">
            <GaleriePhotos photos={s.photos.map((url) => ({ url }))} />
          </div>
        )}
        {s.fichiers.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            {s.fichiers.map((f) => (
              <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue">📎 {f.nom}</a>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        <div className="lg:col-span-3 flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Mission et projet liés</h2>
            {s.interventionId ? (
              <div className="flex flex-col gap-1.5 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/responsable/missions/${s.interventionId}`} className="font-semibold text-blue hover:underline">Mission {row.appareil ?? ""}</Link>
                  {row.mStatut && <StatutInterventionPill statut={row.mStatut} />}
                  {row.mDate && <span className="text-ink-soft">prévue le {formatDateTime(row.mDate)}</span>}
                </div>
                {s.projetId && (
                  <div>
                    Projet{" "}
                    <Link href={`/responsable/projets/${s.projetId}`} className="font-semibold text-blue hover:underline">
                      {row.projetRef} — {row.projetTitre}
                    </Link>
                    {row.client ? <span className="text-ink-soft"> · {row.client}</span> : null}
                  </div>
                )}
                {row.adresse && <div className="text-ink-soft">{row.adresse}</div>}
                {s.appareilId && (
                  <Link href={`/responsable/appareils/${s.appareilId}`} className="text-blue font-semibold hover:underline">Fiche de l&apos;appareil {row.appareil}</Link>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink-soft">Aucune mission liée (signalement général : véhicule, météo…).</p>
            )}
            {gestion && missionLibre && (
              <form action={libererMissionSignalement} className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-3 flex-wrap">
                <input type="hidden" name="signalementId" value={s.id} />
                <span className="text-xs text-ink-soft">La mission n&apos;est pas commencée : vous pouvez la retirer au technicien.</span>
                <Btn variant="ghost">Remettre la mission « à affecter »</Btn>
              </form>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Historique</h2>
            <ol className="flex flex-col gap-2">
              {historique.map((h, i) => (
                <li key={i} className="text-sm">
                  <span className="text-xs text-ink-soft tabular">{formatDateTime(h.createdAt)}</span> ·{" "}
                  <span className="font-semibold">{ACTIONS_JOURNAL[h.action] ?? h.action}</span>
                  {h.auteur ? <span className="text-ink-soft"> — {h.auteur}</span> : null}
                  {h.details && h.action !== "cree" && h.action !== "non_conformite_creee" && <div className="text-ink-soft whitespace-pre-wrap">{h.details}</div>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-2">Réponse au technicien</h2>
            {s.reponse ? (
              <div className="text-sm bg-blue-pale/50 rounded-lg px-3 py-2 mb-3 whitespace-pre-wrap">
                {s.reponse}
                {s.reponseLe && <div className="text-xs text-ink-soft mt-1">{formatDateTime(s.reponseLe)}</div>}
              </div>
            ) : (
              <p className="text-sm text-ink-soft mb-3">Pas encore de réponse.</p>
            )}
            {s.statut === "nouveau" && (
              <form action={prendreEnChargeSignalement} className="flex flex-col gap-2 mb-3">
                <input type="hidden" name="signalementId" value={s.id} />
                <textarea name="message" rows={2} placeholder="Message au technicien (facultatif) : « On s'en occupe, appelle-moi »…" className={inputClass} />
                <Btn className="justify-center">Prendre en charge</Btn>
              </form>
            )}
            {s.statut === "pris_en_charge" && (
              <form action={repondreSignalement} className="flex flex-col gap-2 mb-3">
                <input type="hidden" name="signalementId" value={s.id} />
                <textarea name="message" rows={2} required placeholder="Votre réponse au technicien…" className={inputClass} />
                <Btn variant="ghost" className="justify-center">Envoyer la réponse</Btn>
              </form>
            )}
            {gestion && s.statut !== "cloture" && (
              <form action={cloturerSignalement} className="flex flex-col gap-2 pt-3 border-t border-line">
                <input type="hidden" name="signalementId" value={s.id} />
                <textarea name="message" rows={2} required placeholder="Mesure prise / conclusion (obligatoire)…" className={inputClass} />
                <Btn className="justify-center">Clôturer le signalement</Btn>
              </form>
            )}
            {gestion && s.statut === "cloture" && (
              <form action={rouvrirSignalement}>
                <input type="hidden" name="signalementId" value={s.id} />
                <p className="text-xs text-ink-soft mb-2">Clôturé le {formatDateTime(s.clotureLe)}.</p>
                <Btn variant="ghost">Rouvrir</Btn>
              </form>
            )}
          </Card>

          {(t?.nc || s.nonConformiteId) && (
            <Card className="p-5">
              <h2 className="font-display font-bold text-sm mb-2">Qualité / sécurité (ISO)</h2>
              {s.nonConformiteId ? (
                <Link href="/responsable/non-conformites" className="text-sm font-semibold text-blue">Non-conformité créée — suivre l&apos;action corrective →</Link>
              ) : gestion ? (
                <form action={creerNcDepuisSignalement}>
                  <input type="hidden" name="signalementId" value={s.id} />
                  <p className="text-xs text-ink-soft mb-2">Ouvre une non-conformité liée (analyse des causes, action corrective).</p>
                  <Btn variant="ghost">Créer une non-conformité</Btn>
                </form>
              ) : (
                <p className="text-sm text-ink-soft">Aucune non-conformité.</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
