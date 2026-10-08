import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { AlertTriangle, CalendarClock, ChevronRight, FileText, History, MapPin, ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { appareils, documentsClient, garantieFormules, garanties, prestationAppareils, prestations, projetAppareils, projets, users } from "@/db/schema";
import { Card, StatutAppareilPill } from "@/components/ui";
import { EtapesSuivi } from "@/components/etapes-suivi";
import { RafraichissementAuto } from "@/components/rafraichissement-auto";
import { devisDeLObservateur } from "@/lib/devis";
import { ListeDevisObservateur } from "@/components/liste-devis-observateur";
import { formatDate, formatDateTime } from "@/lib/format";
import { ETAPES, adressesAppareils, etapeObservateur, exigerAppareil, requireObservateur } from "@/lib/observateur";
import { interventionsEnCours, interventionsTerminees, prenom, prochainesVisites } from "@/lib/observateur-donnees";
import { creerDemandeObservateur } from "../../actions";
import { TYPES_DOCUMENT_CLIENT } from "@/lib/documents-client";
import { passagesDAppareils } from "@/lib/garantie-passages";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { EnvoiFichiers } from "@/components/envoi-fichiers";

const TYPE: Record<string, string> = { preventive: "Maintenance préventive", corrective: "Dépannage", systematique: "Contrôle systématique" };

export default async function AppareilObservateurPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ panne?: string; erreur?: string }>;
}) {
  const ctx = await requireObservateur();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  exigerAppareil(ctx, id);
  const d = ctx.droits;

  // Projets de CE client qui contiennent cet appareil (garantie, documents).
  const projetsClient = db
    .select({ id: projets.id })
    .from(projetAppareils)
    .innerJoin(projets, eq(projetAppareils.projetId, projets.id))
    .where(and(eq(projetAppareils.appareilId, id), eq(projets.clientId, ctx.clientId)));

  const [[a], adresses, enCours, terminees, visites, garantiesRows, docs, [moi]] = await Promise.all([
    db.select().from(appareils).where(eq(appareils.id, id)).limit(1),
    adressesAppareils([id]),
    d.has("temps_reel") ? interventionsEnCours([id]) : Promise.resolve([]),
    d.has("historique") ? interventionsTerminees(ctx, [id], 100) : Promise.resolve([]),
    d.has("prochaines_visites") ? prochainesVisites([id]) : Promise.resolve([]),
    d.has("contrat")
      ? db
          .select({ g: garanties, formule: garantieFormules.nom, projet: projets.titre })
          .from(garanties)
          .innerJoin(projets, eq(garanties.projetId, projets.id))
          .leftJoin(garantieFormules, eq(garanties.formuleId, garantieFormules.id))
          .where(inArray(garanties.projetId, projetsClient))
      : Promise.resolve([]),
    d.has("documents")
      ? db
          .select({ id: documentsClient.id, titre: documentsClient.titre, type: documentsClient.type, message: documentsClient.message, createdAt: documentsClient.createdAt })
          .from(documentsClient)
          .where(and(eq(documentsClient.appareilId, id), isNull(documentsClient.archiveLe)))
          .orderBy(desc(documentsClient.createdAt))
      : Promise.resolve([]),
    db.select({ telephone: users.telephone }).from(users).where(eq(users.id, ctx.userId)).limit(1),
  ]);
  if (!a) notFound();
  // Phase 24 : contrats de maintenance (prestations à passages) du client qui couvrent cet appareil.
  const contrats = d.has("contrat")
    ? await db
        .select({ id: prestations.id, titre: prestations.description, dateDebut: prestations.dateDebut, dateFin: prestations.dateFin, statut: prestations.statutContrat })
        .from(prestationAppareils)
        .innerJoin(prestations, eq(prestationAppareils.prestationId, prestations.id))
        .innerJoin(projets, eq(prestations.projetId, projets.id))
        .where(and(eq(prestationAppareils.appareilId, id), eq(projets.clientId, ctx.clientId), eq(prestations.mode, "contrat")))
        .orderBy(desc(prestations.dateDebut))
    : [];
  const passages = d.has("contrat") && (garantiesRows.length || contrats.length) ? await passagesDAppareils([id]) : [];
  const mesDevis = await devisDeLObservateur(ctx.userId, id);
  const adresse = adresses.get(id);
  const rapportsVisibles = d.has("rapports");

  return (
    <div className="flex flex-col gap-4">
      <Link href="/observateur" className="text-xs text-blue font-semibold">&larr; Mes ascenseurs</Link>
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="font-display font-extrabold text-[22px] text-navy">{a.numeroInterne}</h1>
          {d.has("fiche") && <StatutAppareilPill statut={a.statut} />}
        </div>
        {adresse && <p className="text-sm text-ink-soft flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {adresse}</p>}
        <div className="mt-1"><RafraichissementAuto /></div>
      </div>

      <ListeDevisObservateur devis={mesDevis} />

      {sp.panne === "1" && (
        <div className="text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">Panne signalée. ROBUS a été prévenu et va organiser l&apos;intervention.</div>
      )}

      {enCours.map((i) => {
        const etape = etapeObservateur(i);
        return (
          <Card key={i.id} className="p-4 border-[1.5px] border-blue/50">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h2 className="font-display font-bold text-sm">{TYPE[i.type] ?? "Intervention"}</h2>
              <span className="text-xs font-bold text-blue">{ETAPES[etape]}</span>
            </div>
            <p className="text-[13px] text-ink-soft mb-3">
              {etape === 0 && "Votre demande a bien été reçue par ROBUS."}
              {etape === 1 && `Prévue le ${formatDateTime(i.dateProgrammee)}${prenom(i.technicien) ? ` avec ${prenom(i.technicien)}` : ""}.`}
              {etape === 2 && `${prenom(i.technicien) ?? "Le technicien"} est sur place depuis ${formatDateTime(i.dateDebut).split(" ")[1] ?? ""}.`}
            </p>
            <EtapesSuivi etape={etape} />
          </Card>
        );
      })}

      {d.has("signaler_panne") && (
        <Card className="p-4" >
          <details id="panne" open={!!sp.erreur || undefined}>
            <summary className="font-display font-bold text-sm cursor-pointer select-none flex items-center gap-2 text-red-ink">
              <AlertTriangle className="w-4 h-4" /> Signaler une panne
            </summary>
            {sp.erreur && <div className="mt-3 text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">{sp.erreur}</div>}
            <form action={creerDemandeObservateur} className="flex flex-col gap-3 mt-3">
              <input type="hidden" name="appareilId" value={id} />
              <input type="hidden" name="type" value="panne" />
              <input type="hidden" name="depuis" value={`/observateur/appareils/${id}`} />
              <label className="flex items-center gap-2.5 rounded-xl bg-red-fill text-red-ink px-3 py-3 font-bold text-[15px]">
                <input type="checkbox" name="personneBloquee" className="w-5 h-5" /> Une personne est bloquée dans la cabine
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Que se passe-t-il ?</span>
                <textarea name="description" required minLength={5} maxLength={1000} rows={3} className="rounded-lg border border-line px-3 py-2.5 text-[15px]" placeholder="Ex. l'ascenseur est bloqué au 3e étage, porte ouverte…" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Téléphone pour vous rappeler</span>
                <input name="telephone" defaultValue={moi?.telephone ?? ""} inputMode="tel" className="rounded-lg border border-line px-3 py-2.5 text-[15px]" />
              </label>
              <EnvoiFichiers type="photo" max={5} libelle="Photos (facultatif)" />
              <BoutonEnvoi type="submit" className="bg-red-ink text-white font-display font-bold rounded-xl py-3" enCours="Envoi à ROBUS…">Envoyer à ROBUS</BoutonEnvoi>
            </form>
            <Link href={`/observateur/demandes/nouvelle?appareil=${id}`} className="block text-center text-sm font-semibold text-blue mt-3">Autre demande (intervention, question, document)…</Link>
          </details>
        </Card>
      )}

      {d.has("fiche") && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Fiche de l&apos;appareil</h2>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            {[
              ["Marque", a.marque],
              ["Modèle", a.modele],
              ["Type", a.typeAppareil],
              ["Année", a.anneeInstallation ? String(a.anneeInstallation) : null],
              ["Charge", a.charge ? `${a.charge} kg` : null],
              ["Vitesse", a.vitesse ? `${a.vitesse} m/s` : null],
              ["Niveaux", a.niveaux ? String(a.niveaux) : null],
              ["Portes", a.typePortes],
            ]
              .filter(([, v]) => v)
              .map(([l, v]) => (
                <div key={l as string}>
                  <dt className="text-xs text-ink-soft">{l}</dt>
                  <dd className="font-semibold">{v}</dd>
                </div>
              ))}
          </dl>
        </Card>
      )}

      {d.has("prochaines_visites") && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-blue" /> Prochaines visites</h2>
          {visites.length ? (
            <ul className="text-sm flex flex-col gap-1.5">
              {visites.slice(0, 5).map((v, i) => (
                <li key={i} className="flex justify-between gap-2"><span>{TYPE[v.type] ?? v.type}</span><span className="font-semibold">{formatDate(v.date)}</span></li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">Aucune visite planifiée pour l&apos;instant.</p>
          )}
        </Card>
      )}

      {d.has("contrat") && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-blue" /> Contrat et garantie</h2>
          {garantiesRows.length ? (
            garantiesRows.map(({ g, formule, projet }) => (
              <div key={g.id} className="text-sm flex flex-col gap-1 py-1">
                <div className="font-semibold">{formule ?? "Garantie"} <span className="text-ink-soft font-normal">· {projet}</span></div>
                <div className="text-ink-soft">Du {formatDate(g.dateDebut)} au {formatDate(g.dateFin)}</div>
                {(() => {
                  const ps = passages.filter((p) => p.garantieId === g.id);
                  if (!ps.length) return <div>Interventions restantes : <span className="font-semibold">{g.interventionsRestantes} / {g.interventionsIncluses}</span></div>;
                  const faits = ps.filter((p) => p.etat === "realise").length;
                  const prochain = ps.find((p) => p.etat !== "realise");
                  return (
                    <div>
                      Passages réalisés : <span className="font-semibold">{faits} / {ps[0].total}</span>
                      {prochain ? <> · prochain passage vers le <span className="font-semibold">{formatDate(prochain.mDate ?? prochain.datePrevue)}</span></> : null}
                    </div>
                  );
                })()}
              </div>
            ))
          ) : contrats.length ? null : (
            <p className="text-sm text-ink-soft">Aucun contrat de garantie enregistré pour cet appareil.</p>
          )}
          {contrats.map((c) => {
            const ps = passages.filter((p) => p.prestationId === c.id);
            const faits = ps.filter((p) => p.etat === "realise").length;
            const prochain = ps.find((p) => p.etat !== "realise");
            return (
              <div key={c.id} className="text-sm flex flex-col gap-1 py-1 border-t border-line first:border-0 mt-1 pt-2" data-contrat-observateur>
                <div className="font-semibold">{c.titre ?? "Contrat de maintenance"}</div>
                <div className="text-ink-soft">
                  Du {c.dateDebut ? formatDate(c.dateDebut) : "—"} au {c.dateFin ? formatDate(c.dateFin) : "—"}
                  {c.statut === "renouvele" ? " · renouvelé" : ""}
                </div>
                {ps.length > 0 && (
                  <div>
                    Passages réalisés : <span className="font-semibold">{faits} / {ps[0].total}</span>
                    {prochain ? <> · prochain passage vers le <span className="font-semibold">{formatDate(prochain.mDate ?? prochain.datePrevue)}</span></> : null}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {d.has("historique") && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2 flex items-center gap-2"><History className="w-4 h-4 text-blue" /> Historique des interventions</h2>
          <div className="flex flex-col divide-y divide-line">
            {terminees.map((i) => {
              const dispo = rapportsVisibles && i.valideeLe;
              const contenu = (
                <>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{TYPE[i.type] ?? i.type}</div>
                    <div className="text-xs text-ink-soft">
                      {formatDate(i.dateFin ?? i.dateProgrammee)}
                      {prenom(i.technicien) ? ` · ${prenom(i.technicien)}` : ""}
                      {rapportsVisibles ? (dispo ? " · rapport disponible" : " · rapport en cours de validation") : ""}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-ink-soft shrink-0" />
                </>
              );
              return (
                <Link key={i.id} href={`/observateur/interventions/${i.id}`} className="py-2.5 flex items-center justify-between gap-2">
                  {contenu}
                </Link>
              );
            })}
            {terminees.length === 0 && <p className="text-sm text-ink-soft py-1">Aucune intervention terminée.</p>}
          </div>
        </Card>
      )}

      {d.has("documents") && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2 flex items-center gap-2"><FileText className="w-4 h-4 text-blue" /> Documents</h2>
          <div className="flex flex-col divide-y divide-line">
            {docs.map((doc) => (
              <a key={doc.id} href={`/observateur/documents/${doc.id}`} target="_blank" rel="noreferrer" className="py-2.5 flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-blue block truncate">{doc.titre}</span>
                  <span className="text-xs text-ink-soft">{TYPES_DOCUMENT_CLIENT[doc.type] ?? "Document"}{doc.message ? ` · ${doc.message}` : ""}</span>
                </span>
                <span className="text-xs text-ink-soft shrink-0">{formatDate(doc.createdAt)}</span>
              </a>
            ))}
            {docs.length === 0 && <p className="text-sm text-ink-soft py-1">Aucun document partagé pour cet ascenseur.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
