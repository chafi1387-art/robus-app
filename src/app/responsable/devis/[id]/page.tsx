import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { Ban, Check, Eye, Mail, Send, UserRound, Wrench } from "lucide-react";
import { db } from "@/db";
import { pieces, technicienFiches, users } from "@/db/schema";
import { Card, Field, Pill, inputClass } from "@/components/ui";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EditeurDevis } from "@/components/editeur-devis";
import { DevisVue } from "@/components/devis-vue";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { formatDateTime, toDatetimeLocalValue } from "@/lib/format";
import { ETAPES_DEVIS, STATUTS_DEVIS, destinatairesPossibles, etapeDevis, expire, lireDevis, montant } from "@/lib/devis";
import { annulerDevis, deciderDevisBureau, enregistrerDevis, planifierTravaux } from "../actions";

function demainNeufHeures() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

// Phase 25b : le devis d'une mission, de A à Z (préparer → envoyer → réponse → travaux).
export default async function DevisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(ROLES_BUREAU);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const dv = await lireDevis(id);
  if (!dv) notFound();
  const d = dv.d;
  const modifiable = d.statut === "a_preparer" || d.statut === "brouillon";
  const ouvert = modifiable || d.statut === "envoye";
  const [possibles, listePieces, techniciens, [demandeur]] = await Promise.all([
    destinatairesPossibles(d.appareilId, d.clientId),
    modifiable ? db.select({ id: pieces.id, reference: pieces.reference, nom: pieces.nom }).from(pieces).where(eq(pieces.actif, 1)).orderBy(asc(pieces.nom)) : Promise.resolve([]),
    d.statut === "accepte"
      ? db
          .select({ id: users.id, nom: users.nom })
          .from(users)
          .leftJoin(technicienFiches, eq(technicienFiches.technicienId, users.id))
          .where(sql`${users.role} = 'technicien' and ${users.actif} = 1 and coalesce(${technicienFiches.statutRh}::text, '') <> 'sorti_effectifs'`)
          .orderBy(asc(users.nom))
      : Promise.resolve([] as { id: string; nom: string }[]),
    d.demandeParId ? db.select({ nom: users.nom }).from(users).where(eq(users.id, d.demandeParId)).limit(1) : Promise.resolve([]),
  ]);
  const st = STATUTS_DEVIS[d.statut] ?? { label: d.statut, ton: "neutral" as const };
  const etape = etapeDevis(d);
  const envoyes = dv.destinataires.filter((x) => x.envoyeLe);
  const enAttente = dv.destinataires.filter((x) => !x.envoyeLe);
  const choisi = (u: string | null, e: string | null) => enAttente.find((x) => (u && x.userId === u) || (e && x.email === e));
  const dejaEnvoye = (u: string | null, e: string | null) => envoyes.find((x) => (u && x.userId === u) || (e && x.email === e));
  const retour = d.interventionId ? `/responsable/missions/${d.interventionId}#devis` : "/responsable/devis";
  const checkbox = "w-4 h-4 accent-[var(--blue)]";
  const libres = enAttente.filter((x) => x.canal === "email" && !possibles.contacts.some((c) => c.email.toLowerCase() === x.email));

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <Link href={retour} className="text-xs text-blue font-semibold">
        &larr; {d.interventionId ? `Mission ${dv.numeroAppareil ?? ""}` : "Tous les devis"}
      </Link>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Devis {d.numero}</div>
            <h1 className="font-display font-extrabold text-2xl text-navy">{d.titre ?? "Devis"}</h1>
            <div className="text-sm text-ink-soft">
              {[dv.client, dv.numeroAppareil ? `Ascenseur ${dv.numeroAppareil}` : null, dv.projetRef].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Pill tone={st.ton}>{d.statut === "accepte" ? (d.travauxPlanifiesLe ? "Accepté — travaux planifiés" : "Accepté — travaux à planifier") : st.label}</Pill>
            {dv.montantHt !== null && <span className="font-display font-extrabold text-xl text-navy tabular-nums">{montant(dv.montantHt)}</span>}
          </div>
        </div>
        {/* Les 5 étapes */}
        <ol className="grid grid-cols-5 gap-1 mt-4" aria-label="Étapes du devis">
          {ETAPES_DEVIS.map((e, i) => {
            const fait = i < etape || etape === 5;
            const courant = i === etape;
            const refus = d.statut === "refuse" && i === 3;
            return (
              <li key={e} className="flex flex-col gap-1">
                <span className={`h-1.5 rounded-full ${refus ? "bg-red" : fait ? "bg-green" : courant ? "bg-blue" : "bg-line"}`} />
                <span className={`text-[11px] ${courant ? "font-bold text-navy" : "text-ink-soft"}`}>
                  {i + 1}. {refus ? "Refusé" : e}
                </span>
              </li>
            );
          })}
        </ol>
        {d.besoinTechnicien && (
          <div className="mt-4 rounded-xl bg-orange-fill text-orange-ink px-3.5 py-2.5 text-sm">
            <div className="font-bold flex items-center gap-1.5">
              <Wrench className="w-4 h-4" /> Besoin signalé{demandeur ? ` par ${demandeur.nom}` : ""} :
            </div>
            <div className="whitespace-pre-wrap">{d.besoinTechnicien}</div>
          </div>
        )}
        {d.statut === "refuse" && (
          <p className="mt-4 rounded-xl bg-red-fill text-red-ink px-3.5 py-2.5 text-sm">
            Refusé par <strong>{d.decideParNom}</strong> le {formatDateTime(d.decideLe)}
            {d.motifRefus ? ` — « ${d.motifRefus} »` : ""}.
          </p>
        )}
        {(d.statut === "accepte" || d.statut === "realise") && (
          <p className="mt-4 rounded-xl bg-green-fill text-green-ink px-3.5 py-2.5 text-sm">
            Accepté par <strong>{d.decideParNom}</strong> le {formatDateTime(d.decideLe)} (
            {d.decideCanal === "bureau" ? "saisi par le bureau" : d.decideCanal === "email" ? "lien email" : "espace client"}).
            {d.travauxPlanifiesLe && ` Travaux planifiés le ${formatDateTime(d.travauxPlanifiesLe)}.`}
            {d.realiseLe && ` Travaux réalisés le ${formatDateTime(d.realiseLe)}.`}
          </p>
        )}
        {expire(d) && <p className="mt-4 rounded-xl bg-orange-fill text-orange-ink px-3.5 py-2.5 text-sm font-semibold">Validité dépassée : le client ne peut plus accepter en ligne. Vous pouvez saisir une réponse ou annuler le devis.</p>}
      </Card>

      {ouvert && (
        <form action={enregistrerDevis} className="flex flex-col gap-4">
          <input type="hidden" name="devisId" value={d.id} />
          {modifiable && (
            <Card className="p-5 flex flex-col gap-4">
              <h2 className="font-display font-bold text-[15px]">1–2. Contenu du devis</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <Field label="Titre">
                    <input name="titre" maxLength={200} defaultValue={d.titre ?? ""} className={inputClass} />
                  </Field>
                </div>
                <Field label="Validité (jours)">
                  <input name="validiteJours" type="number" min={1} max={365} defaultValue={d.validiteJours} className={inputClass} />
                </Field>
              </div>
              <EditeurDevis
                modeInitial={d.mode === "document" ? "document" : "lignes"}
                lignesInitiales={dv.lignes.map((l) => ({ designation: l.designation, quantite: l.quantite, prixUnitaireHt: l.prixUnitaireHt }))}
                document={d.documentUrl ? { url: d.documentUrl, nom: d.documentNom } : null}
                montantDocument={d.mode === "document" ? d.montantHt : null}
                besoin={d.besoinTechnicien}
                pieces={listePieces.map((p) => ({ id: p.id, label: `${p.reference} — ${p.nom}` }))}
              />
              <Field label="Message au client (facultatif)">
                <textarea name="message" rows={2} maxLength={4000} defaultValue={d.message ?? ""} className={inputClass} placeholder="Ex. Suite à la visite du 08/10, voici notre proposition pour remettre l'ascenseur en service." />
              </Field>
            </Card>
          )}

          <Card className="p-5 flex flex-col gap-3">
            <h2 className="font-display font-bold text-[15px]">3. À qui envoyer ?</h2>
            <p className="text-xs text-ink-soft -mt-2">
              Pour chaque personne : <strong>voit le prix</strong> ou non, et <strong>peut accepter</strong> le devis ou le reçoit seulement pour information.
            </p>

            <div className="flex flex-col gap-1">
              <div className="text-xs font-bold uppercase tracking-wide text-ink-soft flex items-center gap-1.5">
                <UserRound className="w-3.5 h-3.5" /> Espace observateur (application)
              </div>
              {possibles.observateurs.length === 0 && <p className="text-sm text-ink-soft">Aucun observateur sur cet ascenseur.</p>}
              {possibles.observateurs.map((o) => {
                const env = dejaEnvoye(o.userId, null);
                const c = choisi(o.userId, null);
                const decideDefaut = o.modele !== "gardien";
                return (
                  <div key={o.userId} className="flex items-center gap-3 flex-wrap rounded-lg border border-line px-3 py-2">
                    <label className="flex items-center gap-2 flex-1 min-w-[180px] text-sm font-semibold">
                      <input type="checkbox" name={`obs_${o.userId}`} defaultChecked={!!c || !!env} disabled={!!env} className={checkbox} />
                      {o.nom} <span className="text-xs font-normal text-ink-soft">({o.modele ?? "observateur"}{o.clientId === d.clientId ? "" : " — autre société"})</span>
                    </label>
                    {env ? (
                      <span className="text-xs text-green-ink font-semibold">Déjà envoyé</span>
                    ) : (
                      <>
                        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={`obsprix_${o.userId}`} defaultChecked={c ? c.prixVisible === 1 : decideDefaut} className={checkbox} /> Voit le prix</label>
                        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={`obsdecide_${o.userId}`} defaultChecked={c ? c.peutDecider === 1 : decideDefaut} className={checkbox} /> Peut accepter</label>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-xs font-bold uppercase tracking-wide text-ink-soft flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Par email (lien personnel, sans compte)
              </div>
              {possibles.contacts.map((c, i) => {
                const env = dejaEnvoye(null, c.email.toLowerCase());
                const ch = choisi(null, c.email.toLowerCase());
                return (
                  <div key={c.email + i} className="flex items-center gap-3 flex-wrap rounded-lg border border-line px-3 py-2">
                    <label className="flex items-center gap-2 flex-1 min-w-[180px] text-sm font-semibold">
                      <input type="checkbox" name={`contact_${i}`} defaultChecked={!!ch || !!env} disabled={!!env} className={checkbox} />
                      {c.nom} <span className="text-xs font-normal text-ink-soft">{c.email}{c.fonction ? ` · ${c.fonction}` : ""}</span>
                    </label>
                    {env ? (
                      <span className="text-xs text-green-ink font-semibold">Déjà envoyé</span>
                    ) : (
                      <>
                        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={`contactprix_${i}`} defaultChecked={ch ? ch.prixVisible === 1 : true} className={checkbox} /> Voit le prix</label>
                        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={`contactdecide_${i}`} defaultChecked={ch ? ch.peutDecider === 1 : true} className={checkbox} /> Peut accepter</label>
                      </>
                    )}
                  </div>
                );
              })}
              {[...libres, null].slice(0, 3).map((libre, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap rounded-lg border border-dashed border-line px-3 py-2">
                  <input name={`libre_email_${i}`} type="email" defaultValue={libre?.email ?? ""} placeholder="autre.adresse@exemple.be" className={`${inputClass} !py-1.5 flex-1 min-w-[200px]`} />
                  <input name={`libre_nom_${i}`} defaultValue={libre?.nom ?? ""} placeholder="Nom (facultatif)" className={`${inputClass} !py-1.5 w-40`} />
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={`libreprix_${i}`} defaultChecked={libre ? libre.prixVisible === 1 : true} className={checkbox} /> Voit le prix</label>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={`libredecide_${i}`} defaultChecked={libre ? libre.peutDecider === 1 : true} className={checkbox} /> Peut accepter</label>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-line">
              <BoutonEnvoi name="intention" value="enregistrer" className="rounded-lg px-4 py-2 text-sm font-bold font-display border border-line hover:bg-blue-pale" enCours="Enregistrement…">
                {modifiable ? "Enregistrer le brouillon" : "Enregistrer"}
              </BoutonEnvoi>
              <BoutonEnvoi name="intention" value="envoyer" className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold font-display bg-blue text-white hover:bg-blue-light" enCours="Envoi…">
                <Send className="w-4 h-4" /> {envoyes.length ? "Envoyer aux nouveaux destinataires" : "Envoyer le devis"}
              </BoutonEnvoi>
            </div>
          </Card>
        </form>
      )}

      {envoyes.length > 0 && (
        <Card className="p-5">
          <h2 className="font-display font-bold text-[15px] mb-2">Envoyé à</h2>
          <ul className="flex flex-col divide-y divide-line">
            {envoyes.map((x) => (
              <li key={x.id} className="py-2 flex items-center gap-3 flex-wrap text-sm">
                {x.canal === "email" ? <Mail className="w-4 h-4 text-ink-soft" /> : <UserRound className="w-4 h-4 text-ink-soft" />}
                <span className="font-semibold">{x.nom ?? x.email}</span>
                {x.canal === "email" && x.nom && <span className="text-xs text-ink-soft">{x.email}</span>}
                <span className="text-xs text-ink-soft">{x.prixVisible ? "voit le prix" : "sans prix"} · {x.peutDecider ? "peut accepter" : "pour information"}</span>
                <span className="flex-1" />
                {x.envoiEmail === "echec" && <Pill tone="crit">Email non parti</Pill>}
                {x.vuLe ? (
                  <span className="text-xs text-green-ink font-semibold inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> Vu le {formatDateTime(x.vuLe)}</span>
                ) : (
                  <span className="text-xs text-orange-ink font-semibold">Envoyé le {formatDateTime(x.envoyeLe)} · pas encore ouvert</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {d.statut === "envoye" && (
        <Card className="p-5" id="reponse">
          <h2 className="font-display font-bold text-[15px] mb-1">4. Réponse reçue autrement ?</h2>
          <p className="text-xs text-ink-soft mb-3">Accord par téléphone, devis signé sur papier… enregistrez la réponse ici.</p>
          <form action={deciderDevisBureau} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="devisId" value={d.id} />
            <Field label="Réponse de">
              <input name="nom" required minLength={2} placeholder="Nom du client" className={`${inputClass} w-56`} />
            </Field>
            <Field label="Motif (si refus)">
              <input name="motif" maxLength={2000} className={`${inputClass} w-56`} />
            </Field>
            <BoutonEnvoi name="decision" value="accepte" className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-bold bg-green text-white" enCours="…">
              <Check className="w-4 h-4" /> Accepté
            </BoutonEnvoi>
            <BoutonEnvoi name="decision" value="refuse" className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-bold border border-red-ink text-red-ink" enCours="…">
              <Ban className="w-4 h-4" /> Refusé
            </BoutonEnvoi>
          </form>
        </Card>
      )}

      {d.statut === "accepte" && (
        <Card className="p-5 border-[1.5px] border-green" id="travaux">
          <h2 className="font-display font-bold text-[15px] mb-1">5. {d.travauxPlanifiesLe ? "Travaux planifiés — modifier" : "Planifier les travaux"}</h2>
          {d.interventionId ? (
            dv.missionStatut === "en_cours" ? (
              <p className="text-sm text-ink-soft">Le technicien est sur place : vous pourrez planifier les travaux dès que son rapport sera envoyé.</p>
            ) : (
              <>
                <p className="text-xs text-ink-soft mb-3">
                  La <strong>même mission</strong> repart (passage {dv.missionStatut && ["creee", "planifiee", "affectee"].includes(dv.missionStatut) ? dv.missionPassage : (dv.missionPassage ?? 1) + 1}) : le rapport précédent est conservé dans la mission, le technicien choisi reçoit la mission à accepter.
                </p>
                <form action={planifierTravaux} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <input type="hidden" name="devisId" value={d.id} />
                  <Field label="Technicien">
                    <select name="technicienId" required defaultValue={dv.missionTechnicienId ?? ""} className={inputClass}>
                      <option value="" disabled>Choisir…</option>
                      {techniciens.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nom}{t.id === dv.missionTechnicienId ? " (déjà sur la mission)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Date des travaux">
                    <input name="date" type="datetime-local" required defaultValue={toDatetimeLocalValue(demainNeufHeures())} className={inputClass} />
                  </Field>
                  <Field label="Message au technicien (facultatif)">
                    <input name="message" maxLength={1000} className={inputClass} />
                  </Field>
                  <div className="md:col-span-3 flex justify-end">
                    <BoutonEnvoi className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold font-display bg-green text-white" enCours="Envoi au technicien…">
                      <Wrench className="w-4 h-4" /> Redonner la mission pour les travaux
                    </BoutonEnvoi>
                  </div>
                </form>
              </>
            )
          ) : (
            <p className="text-sm text-ink-soft">Devis hors mission : créez une mission dans le projet du client pour réaliser les travaux.</p>
          )}
        </Card>
      )}

      {(dv.lignes.length > 0 || d.documentUrl) && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-[15px]">Aperçu — ce que voit le client</h2>
            <span className="text-xs text-ink-soft">avec les prix</span>
          </div>
          <div className="rounded-xl border border-line p-4 bg-bg/40">
            <DevisVue dv={dv} prixVisible />
          </div>
        </Card>
      )}

      {!["realise", "annule"].includes(d.statut) && (
        <form action={annulerDevis} className="flex justify-end">
          <input type="hidden" name="devisId" value={d.id} />
          <ConfirmSubmitButton confirmMessage={`Annuler le devis ${d.numero} ?`} className="text-xs font-semibold text-red-ink hover:underline">
            Annuler ce devis
          </ConfirmSubmitButton>
        </form>
      )}
    </div>
  );
}
