import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  CheckCircle2, Clock, Eye, FileText, HandHelping, Mail, MapPin, Octagon, PenLine, Play, Send, ShieldCheck, Wrench,
} from "lucide-react";
import { db } from "@/db";
import {
  appareils,
  clients,
  demandesAide,
  interventions,
  missionJournal,
  mouvementsStock,
  nonConformites,
  pieces,
  projets,
  rapportPhotos,
  rapports,
  users,
} from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { formatDateTime } from "@/lib/format";
import { Btn, Card, PrioritePill, StatutInterventionPill, TypeInterventionPill } from "@/components/ui";
import { SuiviEnvoi } from "@/components/suivi-envoi";
import { GaleriePhotos } from "@/components/galerie-photos";
import { RafraichissementAuto } from "@/components/rafraichissement-auto";
import { validerRapport } from "../actions";

// Phase 18 : la mission vue par le bureau — fil en direct (photos, notes,
// pièces, alertes), galerie plein écran, rapport et validation.

type Evenement = { quand: Date; icone: React.ReactNode; titre: string; detail?: string | null; photos?: string[]; ton?: "crit" | "ok" };

function heure(d: Date) {
  return d.toLocaleString("fr-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function duree(depuis: Date) {
  const min = Math.max(0, Math.round((Date.now() - depuis.getTime()) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

export default async function MissionBureauPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(ROLES_BUREAU);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [row] = await db
    .select({
      m: interventions,
      numero: appareils.numeroInterne,
      appareilId: appareils.id,
      projetRef: projets.reference,
      projetTitre: projets.titre,
      adresse: projets.adresse,
      client: clients.raisonSociale,
      technicien: users.nom,
    })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .leftJoin(clients, eq(projets.clientId, clients.id))
    .leftJoin(users, eq(interventions.technicienId, users.id))
    .where(eq(interventions.id, id))
    .limit(1);
  if (!row) notFound();
  const m = row.m;

  const [fil, piecesSorties, aides, ncs, [rapport], valideur] = await Promise.all([
    db.select().from(missionJournal).where(eq(missionJournal.interventionId, id)).orderBy(asc(missionJournal.createdAt)),
    db
      .select({ quantite: mouvementsStock.quantite, createdAt: mouvementsStock.createdAt, nom: pieces.nom, reference: pieces.reference })
      .from(mouvementsStock)
      .innerJoin(pieces, eq(mouvementsStock.pieceId, pieces.id))
      .where(and(eq(mouvementsStock.interventionId, id), eq(mouvementsStock.type, "sortie"))),
    db.select().from(demandesAide).where(eq(demandesAide.interventionId, id)),
    db.select({ titre: nonConformites.titre, gravite: nonConformites.gravite, createdAt: nonConformites.createdAt }).from(nonConformites).where(eq(nonConformites.interventionId, id)),
    db.select().from(rapports).where(eq(rapports.interventionId, id)).limit(1),
    m.valideeParId ? db.select({ nom: users.nom }).from(users).where(eq(users.id, m.valideeParId)).limit(1).then((r) => r[0]?.nom ?? null) : Promise.resolve(null),
  ]);
  const photosRapport = rapport
    ? await db.select().from(rapportPhotos).where(eq(rapportPhotos.rapportId, rapport.id)).orderBy(asc(rapportPhotos.createdAt))
    : [];

  const enDirect = m.statut === "en_cours";
  const ev: Evenement[] = [];
  if (m.envoyeeLe) ev.push({ quand: m.envoyeeLe, icone: <Send className="w-4 h-4" />, titre: `Envoyée à ${row.technicien ?? "—"}` });
  if (m.vueLe) ev.push({ quand: m.vueLe, icone: <Eye className="w-4 h-4" />, titre: "Vue par le technicien" });
  if (m.accepteeLe) ev.push({ quand: m.accepteeLe, icone: <CheckCircle2 className="w-4 h-4" />, titre: "Acceptée" });
  if (m.dateDebut) ev.push({ quand: m.dateDebut, icone: <Play className="w-4 h-4" />, titre: "Intervention commencée" });
  for (const f of fil) {
    ev.push({
      quand: f.createdAt,
      icone: <span className="text-[13px]">📷</span>,
      titre: f.photos.length ? `${f.photos.length} photo${f.photos.length > 1 ? "s" : ""}` : "Note",
      detail: f.texte,
      photos: f.photos,
    });
  }
  for (const p of piecesSorties) ev.push({ quand: p.createdAt, icone: <Wrench className="w-4 h-4" />, titre: `Pièce utilisée : ${p.nom} ×${p.quantite}`, detail: p.reference });
  for (const a of aides) ev.push({ quand: a.createdAt, icone: <HandHelping className="w-4 h-4" />, titre: "Demande d'aide", detail: a.message, ton: "crit" });
  for (const n of ncs) ev.push({ quand: n.createdAt, icone: <Octagon className="w-4 h-4" />, titre: `Non-conformité (${n.gravite}) : ${n.titre}`, ton: "crit" });
  if (m.dateFin) ev.push({ quand: m.dateFin, icone: <FileText className="w-4 h-4" />, titre: "Terminée — rapport envoyé", ton: "ok" });
  if (rapport?.modifieLe) ev.push({ quand: rapport.modifieLe, icone: <PenLine className="w-4 h-4" />, titre: `Rapport corrigé par le technicien${rapport.nbModifications > 1 ? ` (${rapport.nbModifications} fois)` : ""}` });
  if (m.valideeLe) ev.push({ quand: m.valideeLe, icone: <ShieldCheck className="w-4 h-4" />, titre: `Rapport validé${valideur ? ` par ${valideur}` : ""}`, ton: "ok" });
  ev.sort((a, b) => a.quand.getTime() - b.quand.getTime());

  // Toutes les photos : rapport (inclut celles du fil une fois terminé) sinon fil.
  const toutesPhotos = photosRapport.length
    ? photosRapport.map((p) => ({ url: p.url }))
    : fil.flatMap((f) => f.photos.map((url) => ({ url, legende: f.texte })));
  const retour = m.projetId ? `/responsable/projets/${m.projetId}?tab=missions` : "/responsable/interventions";
  const peutValider = m.statut === "terminee" && (user.role === "administrateur" || user.role === "responsable_qualite");

  return (
    <div className="flex flex-col gap-4">
      <Link href={retour} className="text-xs text-blue font-semibold">
        &larr; {m.projetId ? `Projet ${row.projetRef ?? ""}` : "Planning des missions"}
      </Link>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display font-extrabold text-2xl text-navy">{row.numero}</h1>
              {enDirect && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-white bg-red-ink rounded-full px-2.5 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> En direct
                </span>
              )}
            </div>
            <div className="text-sm text-ink-soft mt-0.5">
              {[row.client, row.projetTitre].filter(Boolean).join(" · ")}
            </div>
            {row.adresse && (
              <div className="text-sm text-ink-soft flex items-center gap-1 mt-0.5">
                <MapPin className="w-3.5 h-3.5" /> {row.adresse}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              <TypeInterventionPill type={m.type} />
              <PrioritePill priorite={m.priorite} />
              <StatutInterventionPill statut={m.statut} />
            </div>
            <SuiviEnvoi m={m} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
          <Info label="Technicien" valeur={row.technicien ?? "Non affecté"} />
          <Info label="Programmée" valeur={formatDateTime(m.dateProgrammee)} />
          <Info label={enDirect ? "Sur place depuis" : "Commencée"} valeur={m.dateDebut ? (enDirect ? duree(m.dateDebut) : formatDateTime(m.dateDebut)) : "—"} />
          <Info label="Photos" valeur={String(toutesPhotos.length)} />
        </div>
        {m.description && <p className="text-sm mt-3 bg-blue-pale/50 rounded-lg px-3 py-2">{m.description}</p>}
        {!m.technicienId && (
          <Link href="/responsable/interventions" className="inline-block mt-3 text-sm font-bold text-blue">Affecter un technicien dans le Planning des missions →</Link>
        )}
        {enDirect && (
          <div className="mt-3">
            <RafraichissementAuto secondes={15} />
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="p-5 lg:col-span-3">
          <h2 className="font-display font-bold text-sm mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue" /> Fil de la mission
          </h2>
          {ev.length === 0 ? (
            <p className="text-sm text-ink-soft">Rien pour l&apos;instant — la mission n&apos;a pas encore été envoyée.</p>
          ) : (
            <ol className="relative border-l-2 border-line ml-2 flex flex-col gap-4">
              {ev.map((e, i) => (
                <li key={i} className="pl-5 relative">
                  <span
                    className={`absolute -left-[13px] top-0 w-6 h-6 rounded-full flex items-center justify-center ${
                      e.ton === "crit" ? "bg-red-fill text-red-ink" : e.ton === "ok" ? "bg-green-fill text-green-ink" : "bg-blue-pale text-blue"
                    }`}
                  >
                    {e.icone}
                  </span>
                  <div className="text-[11px] text-ink-soft tabular">{heure(e.quand)}</div>
                  <div className="text-sm font-semibold">{e.titre}</div>
                  {e.detail && <div className="text-sm text-ink-soft whitespace-pre-wrap">{e.detail}</div>}
                  {e.photos && e.photos.length > 0 && (
                    <div className="mt-1.5">
                      <GaleriePhotos photos={e.photos.map((url) => ({ url, legende: e.detail }))} taille="sm" />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Photos ({toutesPhotos.length})</h2>
            {toutesPhotos.length ? (
              <GaleriePhotos photos={toutesPhotos} />
            ) : (
              <p className="text-sm text-ink-soft">Aucune photo pour l&apos;instant.</p>
            )}
            <p className="text-[11px] text-ink-soft mt-2">Cliquez sur une photo pour l&apos;agrandir.</p>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h2 className="font-display font-bold text-sm">Rapport</h2>
              {rapport && (
                <a href={`/api/rapports/pdf/intervention/${m.id}`} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue hover:underline">
                  PDF
                </a>
              )}
            </div>
            {!rapport ? (
              <p className="text-sm text-ink-soft">{enDirect ? "En cours — le rapport arrivera à la fin de l'intervention." : "Pas encore de rapport."}</p>
            ) : (
              <dl className="text-sm flex flex-col gap-2">
                <div>
                  <dt className="text-xs text-ink-soft">Travaux réalisés</dt>
                  <dd className="whitespace-pre-wrap">{rapport.travauxRealises}</dd>
                </div>
                {rapport.observations && (
                  <div>
                    <dt className="text-xs text-ink-soft">Observations</dt>
                    <dd className="whitespace-pre-wrap">{rapport.observations}</dd>
                  </div>
                )}
                <div className="flex justify-between"><dt className="text-ink-soft">Temps passé</dt><dd>{rapport.tempsPasseMinutes != null ? `${rapport.tempsPasseMinutes} min` : "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">Heure réelle</dt><dd>{formatDateTime(rapport.heureReelle)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">Envoyé le</dt><dd>{formatDateTime(rapport.dateEnvoi)}</dd></div>
                {rapport.modifieLe && (
                  <div className="flex justify-between"><dt className="text-ink-soft">Corrigé le</dt><dd>{formatDateTime(rapport.modifieLe)}</dd></div>
                )}
              </dl>
            )}
            {peutValider && (
              <form action={validerRapport} className="mt-4 pt-3 border-t border-line">
                <input type="hidden" name="interventionId" value={m.id} />
                <Btn className="w-full justify-center">
                  <ShieldCheck className="w-4 h-4" /> Valider le rapport
                </Btn>
                <p className="text-[11px] text-ink-soft mt-1.5 flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Verrouille le rapport et le rend visible aux observateurs du client.
                </p>
              </form>
            )}
            {m.valideeLe && (
              <p className="text-xs font-semibold text-green-ink mt-3 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" /> Validé le {formatDateTime(m.valideeLe)}{valideur ? ` par ${valideur}` : ""}
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Info({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="rounded-xl bg-bg px-3 py-2">
      <div className="text-[11px] text-ink-soft">{label}</div>
      <div className="font-semibold truncate">{valeur}</div>
    </div>
  );
}
