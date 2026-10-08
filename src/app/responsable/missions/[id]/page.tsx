import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  Ban, CheckCircle2, Clock, Eye, ListChecks, TriangleAlert, FileText, HandHelping, Mail, MapPin, Octagon, PenLine, Play, Send, ShieldCheck, StickyNote, Wrench, FileSignature,
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
  missionNotes,
  rapportPhotos,
  rapports,
  rapportVersions,
  technicienFiches,
  users,
} from "@/db/schema";
import { signalementsDe } from "@/lib/signalements";
import { occupationsTechnicien } from "@/lib/disponibilite";
import { TYPES_SIGNALEMENT } from "@/lib/signalements-types";
import { STATUTS_NON_COMMENCES, libelleRefus } from "@/lib/missions";
import { ListeSignalements } from "@/components/liste-signalements";
import { checklistsMission, modelesActifs } from "@/lib/checklists";
import { compter, libelleLimites } from "@/lib/checklists-regles";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { formatDateTime, toDatetimeLocalValue } from "@/lib/format";
import { piecesNettes } from "@/lib/pieces-mission";
import { Btn, Card, Field, Pill, PrioritePill, StatutInterventionPill, TypeInterventionPill, inputClass } from "@/components/ui";
import { SuiviEnvoi } from "@/components/suivi-envoi";
import { GaleriePhotos } from "@/components/galerie-photos";
import { EnvoiFichiers } from "@/components/envoi-fichiers";
import { TuilePhoto } from "@/components/tuile-photo";
import { RafraichissementAuto } from "@/components/rafraichissement-auto";
import { CarteDevisMission, PassagesPrecedents } from "@/components/carte-devis-mission";
import { devisDeMission, passagesDeMission } from "@/lib/devis";
import {
  actionNoteMission,
  ajouterNoteMission,
  ajouterPhotosBureau,
  ajouterChecklistMission,
  corrigerPieceBureau,
  deciderMissionRefusee,
  retirerChecklistMission,
  traiterTacheNonConforme,
  modifierRapportBureau,
  retirerOuRemplacerPhotoBureau,
  validerRapport,
} from "../actions";
import { BoutonEnvoi } from "@/components/bouton-envoi";

const ACCEPT_FICHIERS = "application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Phase 18 : la mission vue par le bureau — fil en direct (photos, notes,
// pièces, alertes), galerie plein écran, rapport et validation.

const TYPE_NOTE: Record<string, { label: string; icone: string }> = {
  commentaire: { label: "Commentaire", icone: "💬" },
  piece_manquante: { label: "Pièce manquante", icone: "🔴" },
  document: { label: "Document", icone: "📄" },
  rapport_bureau: { label: "Rapport du bureau", icone: "📝" },
};
const LIBELLE_VERSION: Record<string, string> = {
  rapport_modifie: "Rapport modifié",
  photos_ajoutees: "Photos ajoutées",
  photo_remplacee: "Photo remplacée",
  photo_retiree: "Photo retirée",
  pieces_corrigees: "Pièces corrigées",
};
const STATUT_APPAREIL: Record<string, string> = {
  en_service: "En service",
  sous_surveillance: "Sous surveillance",
  en_panne: "En panne",
  hors_service: "Hors service",
  en_travaux: "En travaux",
};

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
  const [photosRapport, notes, versions, pNettes, stockPieces] = await Promise.all([
    rapport ? db.select().from(rapportPhotos).where(eq(rapportPhotos.rapportId, rapport.id)).orderBy(asc(rapportPhotos.createdAt)) : Promise.resolve([]),
    db
      .select({ n: missionNotes, auteur: users.nom })
      .from(missionNotes)
      .leftJoin(users, eq(missionNotes.auteurId, users.id))
      .where(eq(missionNotes.interventionId, id))
      .orderBy(desc(missionNotes.createdAt)),
    db
      .select({ v: rapportVersions, auteur: users.nom })
      .from(rapportVersions)
      .leftJoin(users, eq(rapportVersions.auteurId, users.id))
      .where(eq(rapportVersions.interventionId, id))
      .orderBy(desc(rapportVersions.createdAt)),
    piecesNettes(id),
    db.select({ id: pieces.id, nom: pieces.nom, reference: pieces.reference, stock: pieces.quantiteStock }).from(pieces).orderBy(asc(pieces.nom)),
  ]);
  const gestion = user.role === "administrateur" || user.role === "responsable_qualite";
  const valide = ["validee", "cloturee"].includes(m.statut);
  const nonCommencee = (STATUTS_NON_COMMENCES as readonly string[]).includes(m.statut);
  // Phase 21 : signalements liés, disponibilité du technicien ce jour-là, choix pour une réaffectation.
  const [devisM, passagesM] = await Promise.all([devisDeMission(id), passagesDeMission(id)]);
  const [sigs, occupation, techniciensActifs, checklistsM, modelesCl] = await Promise.all([
    signalementsDe({ interventionId: id }),
    m.technicienId && m.dateProgrammee && nonCommencee ? occupationsTechnicien(m.technicienId, m.dateProgrammee, id) : Promise.resolve(null),
    m.refuseeLe && nonCommencee
      ? db
          .select({ id: users.id, nom: users.nom })
          .from(users)
          .leftJoin(technicienFiches, eq(technicienFiches.technicienId, users.id))
          .where(sql`${users.role} = 'technicien' and ${users.actif} = 1 and coalesce(${technicienFiches.statutRh}::text, '') <> 'sorti_effectifs'`)
          .orderBy(asc(users.nom))
      : Promise.resolve([] as { id: string; nom: string }[]),
    checklistsMission(id),
    gestion && !valide && m.statut !== "terminee" ? modelesActifs() : Promise.resolve([]),
  ]);
  const compteCl = compter(checklistsM.flatMap((c) => c.taches));

  const enDirect = m.statut === "en_cours";
  const ev: Evenement[] = [];
  if (m.envoyeeLe) ev.push({ quand: m.envoyeeLe, icone: <Send className="w-4 h-4" />, titre: `Envoyée à ${row.technicien ?? "—"}` });
  if (m.vueLe) ev.push({ quand: m.vueLe, icone: <Eye className="w-4 h-4" />, titre: "Vue par le technicien" });
  if (m.accepteeLe) ev.push({ quand: m.accepteeLe, icone: <CheckCircle2 className="w-4 h-4" />, titre: "Acceptée" });
  if (m.refuseeLe) ev.push({ quand: m.refuseeLe, icone: <Ban className="w-4 h-4" />, titre: `Refusée : ${libelleRefus(m.refusMotif)}`, detail: m.refusCommentaire, ton: "crit" });
  for (const sg of sigs) ev.push({ quand: sg.createdAt, icone: <TriangleAlert className="w-4 h-4" />, titre: `Signalement ${sg.numero} : ${TYPES_SIGNALEMENT[sg.type]?.label ?? sg.type}`, detail: sg.description, ton: "crit" });
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
  for (const { v, auteur } of versions) {
    ev.push({ quand: v.createdAt, icone: <PenLine className="w-4 h-4" />, titre: `${LIBELLE_VERSION[v.quoi] ?? "Rapport modifié"} par ${auteur ?? "le bureau"}`, detail: v.motif ? `Motif : ${v.motif}` : null });
  }
  for (const { n, auteur } of notes) {
    ev.push({ quand: n.createdAt, icone: <StickyNote className="w-4 h-4" />, titre: `${TYPE_NOTE[n.type]?.label ?? "Note"} — ${auteur ?? "bureau"}`, detail: n.titre ?? n.texte, ton: n.type === "piece_manquante" && !n.regleLe ? "crit" : undefined });
  }
  // Phase 25b : devis et passages précédents dans le fil de la mission.
  for (const dv of devisM) {
    ev.push({ quand: dv.createdAt, icone: <FileSignature className="w-4 h-4" />, titre: dv.statut === "a_preparer" || dv.besoinTechnicien ? `Devis ${dv.numero} demandé` : `Devis ${dv.numero} créé`, detail: dv.besoinTechnicien });
    if (dv.dateEnvoi) ev.push({ quand: dv.dateEnvoi, icone: <Send className="w-4 h-4" />, titre: `Devis ${dv.numero} envoyé au client` });
    if (dv.decideLe) ev.push({ quand: dv.decideLe, icone: <FileSignature className="w-4 h-4" />, titre: `Devis ${dv.numero} ${dv.statut === "refuse" ? "refusé" : "accepté"} par ${dv.decideParNom ?? "le client"}`, detail: dv.motifRefus, ton: dv.statut === "refuse" ? "crit" : "ok" });
    if (dv.travauxPlanifiesLe) ev.push({ quand: dv.travauxPlanifiesLe, icone: <Wrench className="w-4 h-4" />, titre: `Travaux du devis ${dv.numero} planifiés — la mission repart` });
  }
  for (const { p, technicien } of passagesM) {
    if (p.dateFin) ev.push({ quand: p.dateFin, icone: <FileText className="w-4 h-4" />, titre: `Passage ${p.numero} terminé${technicien ? ` (${technicien})` : ""} — rapport archivé`, ton: "ok" });
  }
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
          <Link href={`/responsable/interventions?affecter=${m.id}#m-${m.id}`} className="inline-block mt-3 text-sm font-bold text-blue">Affecter un technicien dans le Planning des missions →</Link>
        )}
        {enDirect && (
          <div className="mt-3">
            <RafraichissementAuto secondes={15} />
          </div>
        )}
        {occupation && (occupation.formations.length > 0 || occupation.signalementsBloquants.length > 0 || occupation.sousTraitance.length > 0 || occupation.autresMissions > 0) && (
          <div className="mt-3 text-sm bg-orange-fill text-orange-ink rounded-lg px-3 py-2 flex flex-col gap-0.5">
            <span className="font-bold">Ce jour-là, {row.technicien} a aussi :</span>
            {occupation.formations.map((f) => (
              <span key={f.id}>🎓 Formation « {f.titre} » à {formatDateTime(f.dateDebut).split(" ")[1]}</span>
            ))}
            {occupation.autresMissions > 0 && <span>🔧 {occupation.autresMissions} autre(s) mission(s)</span>}
            {occupation.sousTraitance.length > 0 && <span>⏱ Sous-traitance déclarée ({occupation.sousTraitance.map((h) => (h.heureDebut ? `${h.heureDebut}–${h.heureFin}` : `${Math.round(h.minutes / 6) / 10} h`)).join(", ")})</span>}
            {occupation.signalementsBloquants.map((b) => (
              <Link key={b.id} href={`/responsable/signalements/${b.id}`} className="underline">⚠️ Signalement bloquant en cours ({b.numero})</Link>
            ))}
          </div>
        )}
      </Card>

      {m.refuseeLe && nonCommencee && (
        <Card className="p-5 border-red border-[1.5px]">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-display font-bold text-[15px] text-red-ink flex items-center gap-2">
                <Ban className="w-4 h-4" /> Mission refusée par {row.technicien}
              </h2>
              <p className="text-sm mt-1">
                <span className="font-semibold">{libelleRefus(m.refusMotif)}</span>
                {m.refusCommentaire ? ` — ${m.refusCommentaire}` : ""}
              </p>
              <p className="text-xs text-ink-soft mt-0.5">Le {formatDateTime(m.refuseeLe)}. La mission attend votre décision.</p>
            </div>
          </div>
          {gestion ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
              <form action={deciderMissionRefusee} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                <input type="hidden" name="interventionId" value={m.id} />
                <input type="hidden" name="decision" value="reaffecter" />
                <div className="text-sm font-bold">Réaffecter</div>
                <select name="technicienId" required defaultValue="" className={inputClass}>
                  <option value="" disabled>Choisir un technicien…</option>
                  {techniciensActifs.filter((t) => t.id !== m.technicienId).map((t) => (
                    <option key={t.id} value={t.id}>{t.nom}</option>
                  ))}
                </select>
                <input type="datetime-local" name="dateProgrammee" defaultValue={toDatetimeLocalValue(m.dateProgrammee)} className={inputClass} />
                <Btn className="justify-center">Réaffecter et envoyer</Btn>
              </form>
              <form action={deciderMissionRefusee} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                <input type="hidden" name="interventionId" value={m.id} />
                <input type="hidden" name="decision" value="renvoyer" />
                <div className="text-sm font-bold">Maintenir avec {row.technicien}</div>
                <input type="datetime-local" name="dateProgrammee" defaultValue={toDatetimeLocalValue(m.dateProgrammee)} className={inputClass} />
                <input name="message" placeholder="Message (ex. vu au téléphone, nouvelle heure)…" className={inputClass} />
                <Btn variant="ghost" className="justify-center">Renvoyer (à accepter)</Btn>
              </form>
              <form action={deciderMissionRefusee} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                <input type="hidden" name="interventionId" value={m.id} />
                <input type="hidden" name="decision" value="liberer" />
                <div className="text-sm font-bold">Remettre « à affecter »</div>
                <p className="text-xs text-ink-soft flex-1">La mission quitte son planning ; vous l&apos;affecterez plus tard.</p>
                <Btn variant="ghost" className="justify-center">Remettre à affecter</Btn>
              </form>
            </div>
          ) : (
            <p className="text-sm text-ink-soft mt-3">L&apos;administrateur ou le responsable qualité doit décider.</p>
          )}
        </Card>
      )}

      {(checklistsM.length > 0 || modelesCl.length > 0) && (
        <Card className="p-5">
          <div id="checklist" className="scroll-mt-24" />
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h2 className="font-display font-bold text-sm flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-blue" /> Checklists
              {compteCl.total > 0 && (
                <span className="font-normal text-ink-soft">
                  — {compteCl.faites}/{compteCl.total} remplie(s){compteCl.nok ? ` · ` : ""}
                  {compteCl.nok ? <span className="text-red-ink font-semibold">{compteCl.nok} ✗ non conforme(s)</span> : null}
                </span>
              )}
            </h2>
            {modelesCl.length > 0 && (
              <form action={ajouterChecklistMission} className="flex items-center gap-2">
                <input type="hidden" name="interventionId" value={m.id} />
                <select name="modeleId" required defaultValue="" className={`${inputClass} !py-1.5 !text-sm w-60`}>
                  <option value="" disabled>Ajouter une checklist…</option>
                  {modelesCl.filter((x) => !checklistsM.some((c) => c.modeleId === x.id)).map((x) => (
                    <option key={x.id} value={x.id}>{x.nom} ({x.nbTaches})</option>
                  ))}
                </select>
                <Btn variant="ghost">Ajouter</Btn>
              </form>
            )}
          </div>
          {checklistsM.length === 0 && <p className="text-sm text-ink-soft">Aucune checklist sur cette mission.</p>}
          <div className="flex flex-col gap-4">
            {checklistsM.map((c) => (
              <div key={c.id}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="text-sm font-bold">
                    {c.nom} <span className="text-xs text-ink-soft font-normal">· version {c.versionModele} · {c.compte.faites}/{c.compte.total}</span>
                  </div>
                  {gestion && c.compte.faites === 0 && !valide && m.statut !== "terminee" && (
                    <form action={retirerChecklistMission}>
                      <input type="hidden" name="interventionId" value={m.id} />
                      <input type="hidden" name="missionChecklistId" value={c.id} />
                      <BoutonEnvoi type="submit" className="text-xs font-semibold text-red-ink">Retirer</BoutonEnvoi>
                    </form>
                  )}
                </div>
                <div className="flex flex-col divide-y divide-line border border-line rounded-xl">
                  {c.taches.map((t, i) => (
                    <div key={t.id}>
                      {t.section && t.section !== c.taches[i - 1]?.section && (
                        <div className="px-3 pt-2 text-[11px] font-bold uppercase tracking-wide text-ink-soft">{t.section}</div>
                      )}
                      <div className={`px-3 py-2 flex items-start gap-3 text-sm ${t.resultat === "nok" ? "bg-red-fill/40" : ""}`}>
                        <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 font-bold ${t.resultat === "ok" ? "bg-green-ink text-white" : t.resultat === "nok" ? "bg-red text-white" : "bg-line text-ink-soft"}`}>
                          {t.resultat === "ok" ? "✓" : t.resultat === "nok" ? "✗" : "–"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div>
                            {t.libelle}
                            {t.obligatoire ? <span className="text-red-ink"> *</span> : null}
                            {t.type === "mesure" && <span className="text-xs text-ink-soft"> · {libelleLimites(t)}</span>}
                          </div>
                          {t.valeur && (
                            <div className={`text-xs font-semibold ${t.resultat === "nok" ? "text-red-ink" : "text-green-ink"}`}>
                              Relevé : {Number(t.valeur).toLocaleString("fr-BE")} {t.unite ?? ""}
                            </div>
                          )}
                          {t.commentaire && <div className="text-xs text-ink-soft">« {t.commentaire} »</div>}
                          {t.resultat === "nok" && gestion && !t.traiteLe && (
                            <div className="flex gap-2 mt-1.5">
                              <form action={traiterTacheNonConforme}>
                                <input type="hidden" name="tacheId" value={t.id} />
                                <input type="hidden" name="decision" value="nc" />
                                <BoutonEnvoi type="submit" className="text-xs font-bold text-red-ink border border-red/40 rounded-lg px-2.5 py-1">Ouvrir une non-conformité</BoutonEnvoi>
                              </form>
                              <form action={traiterTacheNonConforme}>
                                <input type="hidden" name="tacheId" value={t.id} />
                                <input type="hidden" name="decision" value="vu" />
                                <BoutonEnvoi type="submit" className="text-xs font-semibold border border-line rounded-lg px-2.5 py-1">Marquer traité</BoutonEnvoi>
                              </form>
                            </div>
                          )}
                          {t.resultat === "nok" && t.traiteLe && (
                            <div className="text-xs text-green-ink mt-0.5">{t.nonConformiteId ? "Non-conformité ouverte" : "Traité"} le {formatDateTime(t.traiteLe)}</div>
                          )}
                        </div>
                        {t.rempliLe && <span className="text-[11px] text-ink-soft tabular whitespace-nowrap">{heure(t.rempliLe)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <CarteDevisMission interventionId={m.id} devis={devisM} peutCreer={!!m.projetId} />
      <PassagesPrecedents passages={passagesM} />

      {sigs.length > 0 && (
        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-2 flex items-center gap-2">
            <TriangleAlert className="w-4 h-4 text-red-ink" /> Signalements liés à cette mission ({sigs.length})
          </h2>
          <ListeSignalements lignes={sigs} />
        </Card>
      )}

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
          <Card className="p-5 scroll-mt-20" >
            <div id="photos" className="scroll-mt-24" />
            <h2 className="font-display font-bold text-sm mb-3">Photos ({toutesPhotos.length})</h2>
            {toutesPhotos.length ? (
              <GaleriePhotos photos={toutesPhotos} />
            ) : (
              <p className="text-sm text-ink-soft">Aucune photo pour l&apos;instant.</p>
            )}
            <p className="text-[11px] text-ink-soft mt-2">Cliquez sur une photo pour l&apos;agrandir.</p>
            {gestion && rapport && (
              <details className="mt-3 pt-3 border-t border-line">
                <summary className="text-sm font-bold text-blue cursor-pointer select-none">Gérer les photos du rapport</summary>
                <div className="flex flex-col gap-3 mt-3">
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {photosRapport.map((ph, i) => (
                      <TuilePhoto
                        key={ph.id}
                        url={ph.url}
                        alt={`Photo ${i + 1}`}
                        action={retirerOuRemplacerPhotoBureau}
                        champs={{ interventionId: m.id, photoId: ph.id }}
                        retirable={photosRapport.length > 1}
                        remplacable
                        motifRequis={valide}
                      />
                    ))}
                  </div>
                  <p className="text-[11px] text-ink-soft">↻ remplace la photo, ✕ la retire (au moins une photo reste ; le fichier d&apos;origine reste archivé).</p>
                  <form action={ajouterPhotosBureau} className="flex flex-col gap-2 pt-2 border-t border-line">
                    <input type="hidden" name="interventionId" value={m.id} />
                    <EnvoiFichiers type="photo" requis />
                    {valide && <input name="motif" required placeholder="Motif (rapport validé)" className={inputClass} />}
                    <Btn variant="ghost" className="self-start" enCours="Ajout…">Ajouter les photos</Btn>
                  </form>
                </div>
              </details>
            )}
          </Card>

          <Card className="p-5">
            <div id="rapport" className="scroll-mt-24" />
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <h2 className="font-display font-bold text-sm">Rapport</h2>
              <div className="flex items-center gap-2">
                {rapport?.corrigeBureauLe && <Pill tone="warn">Corrigé par le bureau</Pill>}
                {rapport && (
                  <a href={`/api/rapports/pdf/intervention/${m.id}`} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue hover:underline">
                    PDF
                  </a>
                )}
              </div>
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
                <div className="flex justify-between"><dt className="text-ink-soft">État de l&apos;appareil</dt><dd>{STATUT_APPAREIL[rapport.statutFinalAppareil ?? ""] ?? "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">Envoyé le</dt><dd>{formatDateTime(rapport.dateEnvoi)}</dd></div>
                {rapport.modifieLe && (
                  <div className="flex justify-between"><dt className="text-ink-soft">Corrigé par le technicien</dt><dd>{formatDateTime(rapport.modifieLe)}</dd></div>
                )}
                {rapport.corrigeBureauLe && (
                  <div className="flex justify-between"><dt className="text-ink-soft">Corrigé par le bureau</dt><dd>{formatDateTime(rapport.corrigeBureauLe)}</dd></div>
                )}
              </dl>
            )}
            {gestion && rapport && (
              <details className="mt-3 pt-3 border-t border-line">
                <summary className="text-sm font-bold text-blue cursor-pointer select-none">Modifier le rapport</summary>
                <form action={modifierRapportBureau} className="flex flex-col gap-3 mt-3">
                  <input type="hidden" name="interventionId" value={m.id} />
                  <Field label="Travaux réalisés">
                    <textarea name="travauxRealises" required rows={4} defaultValue={rapport.travauxRealises ?? ""} className={inputClass} />
                  </Field>
                  <Field label="Observations">
                    <textarea name="observations" rows={2} defaultValue={rapport.observations ?? ""} className={inputClass} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Temps passé (min)">
                      <input name="tempsPasseMinutes" type="number" min={0} defaultValue={rapport.tempsPasseMinutes ?? ""} className={inputClass} />
                    </Field>
                    <Field label="Heure réelle">
                      <input name="heureReelle" type="datetime-local" defaultValue={toDatetimeLocalValue(rapport.heureReelle ?? m.dateProgrammee)} className={inputClass} />
                    </Field>
                  </div>
                  <Field label="État de l'appareil après l'intervention">
                    <select name="statutFinalAppareil" defaultValue={rapport.statutFinalAppareil ?? "en_service"} className={inputClass}>
                      {Object.entries(STATUT_APPAREIL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={valide ? "Motif de la modification (obligatoire : rapport validé)" : "Motif (facultatif)"}>
                    <input name="motif" required={valide} className={inputClass} />
                  </Field>
                  <Btn className="self-start">Enregistrer (l&apos;ancienne version est conservée)</Btn>
                </form>
              </details>
            )}
            {versions.length > 0 && (
              <details className="mt-3 pt-3 border-t border-line">
                <summary className="text-xs font-bold text-ink-soft cursor-pointer select-none">Historique des modifications ({versions.length})</summary>
                <ol className="flex flex-col gap-3 mt-2">
                  {versions.map(({ v, auteur }) => (
                    <li key={v.id} className="text-xs">
                      <div className="font-semibold">{formatDateTime(v.createdAt)} · {LIBELLE_VERSION[v.quoi] ?? v.quoi} · {auteur ?? "—"}</div>
                      {v.motif && <div className="text-ink-soft">Motif : {v.motif}</div>}
                      <Diff avant={v.avant as Instantane | null} apres={v.apres as Instantane | null} />
                    </li>
                  ))}
                </ol>
              </details>
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

          <Card className="p-5">
            <div id="pieces" className="scroll-mt-24" />
            <h2 className="font-display font-bold text-sm mb-2">Pièces utilisées</h2>
            <div className="flex flex-col divide-y divide-line">
              {pNettes.filter((p) => p.quantite !== 0).map((p) => (
                <div key={p.pieceId} className="py-2 flex items-center justify-between gap-2 text-sm flex-wrap">
                  <span>{p.quantite} × {p.nom} <span className="text-xs text-ink-soft">({p.reference})</span></span>
                  {gestion && (
                    <form action={corrigerPieceBureau} className="flex items-center gap-1.5">
                      <input type="hidden" name="interventionId" value={m.id} />
                      <input type="hidden" name="pieceId" value={p.pieceId} />
                      <input type="number" name="quantite" min={0} defaultValue={p.quantite} className={`${inputClass} !py-1 !text-xs w-16`} />
                      {valide && <input name="motif" required placeholder="Motif" className={`${inputClass} !py-1 !text-xs w-24`} />}
                      <BoutonEnvoi type="submit" className="text-xs font-bold text-blue">Corriger</BoutonEnvoi>
                    </form>
                  )}
                </div>
              ))}
              {pNettes.every((p) => p.quantite === 0) && <p className="text-sm text-ink-soft py-1">Aucune pièce déclarée.</p>}
            </div>
            {gestion && (
              <form action={corrigerPieceBureau} className="flex items-end gap-2 flex-wrap mt-3 pt-3 border-t border-line">
                <input type="hidden" name="interventionId" value={m.id} />
                <Field label="Ajouter une pièce">
                  <select name="pieceId" required defaultValue="" className={`${inputClass} max-w-[220px]`}>
                    <option value="" disabled>Choisir…</option>
                    {stockPieces.map((p) => (
                      <option key={p.id} value={p.id}>{p.reference} — {p.nom} ({p.stock})</option>
                    ))}
                  </select>
                </Field>
                <Field label="Qté">
                  <input type="number" name="quantite" min={1} defaultValue={1} required className={`${inputClass} w-16`} />
                </Field>
                {valide && (
                  <Field label="Motif">
                    <input name="motif" required className={`${inputClass} w-32`} />
                  </Field>
                )}
                <Btn variant="ghost">Ajouter</Btn>
              </form>
            )}
            <p className="text-[11px] text-ink-soft mt-2">Chaque correction crée un mouvement de stock (aucune donnée effacée).</p>
          </Card>
        </div>
      </div>

      <Card className="p-5">
        <div id="notes" className="scroll-mt-24" />
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <h2 className="font-display font-bold text-sm flex items-center gap-2"><StickyNote className="w-4 h-4 text-blue" /> Notes internes &amp; rapports du bureau</h2>
          <span className="text-[11px] text-ink-soft">Jamais visibles par le technicien ; visibles par le client seulement si vous cochez « Visible par le client » sur un rapport du bureau.</span>
        </div>
        {gestion && (
          <form action={ajouterNoteMission} className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 p-3 rounded-xl bg-bg">
            <input type="hidden" name="interventionId" value={m.id} />
            <Field label="Type">
              <select name="type" defaultValue="commentaire" className={inputClass}>
                {Object.entries(TYPE_NOTE).map(([k, v]) => (
                  <option key={k} value={k}>{v.icone} {v.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Titre (obligatoire pour un rapport du bureau)">
              <input name="titre" maxLength={200} className={inputClass} placeholder="Ex. Contacteur à commander" />
            </Field>
            <div className="md:col-span-2">
              <Field label="Texte">
                <textarea name="texte" rows={3} className={inputClass} placeholder="Votre commentaire, la pièce manquante, votre rapport…" />
              </Field>
            </div>
            <EnvoiFichiers type="fichier" name="fichiers" dossier="missions" libelle="Fichiers joints (PDF, Word, Excel, photos — 20 Mo max)" />
            <label className="flex items-center gap-2 text-sm self-end pb-2">
              <input type="checkbox" name="visibleClient" /> Visible par le client <span className="text-xs text-ink-soft">(rapport du bureau seulement)</span>
            </label>
            <div className="md:col-span-2">
              <Btn>Ajouter</Btn>
            </div>
          </form>
        )}
        <div className="flex flex-col divide-y divide-line mt-3">
          {notes.map(({ n, auteur }) => {
            const t = TYPE_NOTE[n.type] ?? TYPE_NOTE.commentaire;
            return (
              <div key={n.id} className={`py-3 flex flex-col gap-1.5 ${n.archiveLe ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <span>{t.icone}</span>
                  <span className="font-semibold">{t.label}</span>
                  <span className="text-xs text-ink-soft">· {auteur ?? "—"} · {formatDateTime(n.createdAt)}</span>
                  {n.type === "piece_manquante" && <Pill tone={n.regleLe ? "ok" : "crit"}>{n.regleLe ? `Réglé le ${formatDateTime(n.regleLe)}` : "À régler"}</Pill>}
                  {n.type === "rapport_bureau" && <Pill tone={n.visibleClient ? "ok" : "neutral"}>{n.visibleClient ? "Visible par le client" : "Interne"}</Pill>}
                  {n.archiveLe && <Pill tone="neutral">Archivé</Pill>}
                </div>
                {n.titre && <div className="text-sm font-semibold">{n.titre}</div>}
                {n.texte && <div className="text-sm whitespace-pre-wrap">{n.texte}</div>}
                {n.fichiers.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {n.fichiers.map((f) => (
                      <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue border border-line rounded-lg px-2 py-1 hover:bg-blue-pale">
                        📎 {f.nom}
                      </a>
                    ))}
                  </div>
                )}
                {gestion && (
                  <div className="flex gap-3 text-xs font-bold">
                    {n.type === "piece_manquante" && (
                      <form action={actionNoteMission}>
                        <input type="hidden" name="interventionId" value={m.id} />
                        <input type="hidden" name="noteId" value={n.id} />
                        <input type="hidden" name="action" value="regle" />
                        <BoutonEnvoi type="submit" className="text-green-ink">{n.regleLe ? "Rouvrir" : "Réglé ✓"}</BoutonEnvoi>
                      </form>
                    )}
                    {n.type === "rapport_bureau" && (
                      <form action={actionNoteMission}>
                        <input type="hidden" name="interventionId" value={m.id} />
                        <input type="hidden" name="noteId" value={n.id} />
                        <input type="hidden" name="action" value="visible" />
                        <BoutonEnvoi type="submit" className="text-blue">{n.visibleClient ? "Rendre interne" : "Rendre visible au client"}</BoutonEnvoi>
                      </form>
                    )}
                    <form action={actionNoteMission}>
                      <input type="hidden" name="interventionId" value={m.id} />
                      <input type="hidden" name="noteId" value={n.id} />
                      <input type="hidden" name="action" value="archiver" />
                      <BoutonEnvoi type="submit" className="text-ink-soft">{n.archiveLe ? "Désarchiver" : "Archiver"}</BoutonEnvoi>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
          {notes.length === 0 && <p className="text-sm text-ink-soft py-1">Aucune note pour l&apos;instant.</p>}
        </div>
      </Card>
    </div>
  );
}

type Instantane = {
  travauxRealises: string | null;
  observations: string | null;
  tempsPasseMinutes: number | null;
  heureReelle: string | null;
  statutFinalAppareil: string | null;
  photos: string[];
  pieces: string[];
};

/** Avant / après lisible pour l'historique (seuls les champs qui ont changé). */
function Diff({ avant, apres }: { avant: Instantane | null; apres: Instantane | null }) {
  if (!avant || !apres) return null;
  const lignes: [string, string, string][] = [];
  const champ = (l: string, a: unknown, b: unknown) => {
    const sa = Array.isArray(a) ? a.join(", ") : a == null ? "—" : String(a);
    const sb = Array.isArray(b) ? b.join(", ") : b == null ? "—" : String(b);
    if (sa !== sb) lignes.push([l, sa, sb]);
  };
  champ("Travaux", avant.travauxRealises, apres.travauxRealises);
  champ("Observations", avant.observations, apres.observations);
  champ("Temps (min)", avant.tempsPasseMinutes, apres.tempsPasseMinutes);
  champ("Heure réelle", avant.heureReelle?.slice(0, 16).replace("T", " "), apres.heureReelle?.slice(0, 16).replace("T", " "));
  champ("État appareil", avant.statutFinalAppareil, apres.statutFinalAppareil);
  if (avant.photos.length !== apres.photos.length || avant.photos.some((u, i) => u !== apres.photos[i])) {
    lignes.push(["Photos", `${avant.photos.length}`, `${apres.photos.length}${avant.photos.length === apres.photos.length ? " (remplacée)" : ""}`]);
  }
  champ("Pièces", avant.pieces, apres.pieces);
  if (!lignes.length) return null;
  return (
    <table className="mt-1 w-full text-[11px]">
      <tbody>
        {lignes.map(([l, a, b]) => (
          <tr key={l} className="align-top">
            <td className="pr-2 text-ink-soft whitespace-nowrap">{l}</td>
            <td className="pr-2 line-through text-red-ink/80 break-words">{a}</td>
            <td className="text-green-ink break-words">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
