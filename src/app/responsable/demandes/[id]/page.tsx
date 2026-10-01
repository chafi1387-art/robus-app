import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { Clock, MapPin, Phone, Mail as MailIcon } from "lucide-react";
import { db } from "@/db";
import { appareils, clients, demandesClient, demandesMessages, interventions, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { Btn, Card, Field, Pill, inputClass } from "@/components/ui";
import { GaleriePhotos } from "@/components/galerie-photos";
import { formatDateTime, toDatetimeLocalValue } from "@/lib/format";
import { adressesAppareils } from "@/lib/observateur";
import { ETAPES_DEMANDE, STATUTS_DEMANDE, TYPES_DEMANDE, delais, echeancePriseEnCharge } from "@/lib/demandes";
import { cloturerDemande, planifierDepuisDemande, prendreEnCharge, repondreDemande, resoudreDemande } from "../actions";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function ecart(ms: number) {
  const min = Math.round(Math.abs(ms) / 60000);
  return min < 60 ? `${min} min` : min < 2880 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${Math.round(min / 1440)} j`;
}

export default async function DemandePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(ROLES_BUREAU);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ d: demandesClient, appareil: appareils.numeroInterne, client: clients.raisonSociale, auteur: users.nom, auteurEmail: users.email, auteurTel: users.telephone })
    .from(demandesClient)
    .innerJoin(appareils, eq(demandesClient.appareilId, appareils.id))
    .leftJoin(clients, eq(demandesClient.clientId, clients.id))
    .leftJoin(users, eq(demandesClient.auteurId, users.id))
    .where(eq(demandesClient.id, id))
    .limit(1);
  if (!row) notFound();
  const d = row.d;
  const [messages, mission, techs, adresses, dl] = await Promise.all([
    db
      .select({ m: demandesMessages, auteur: users.nom })
      .from(demandesMessages)
      .leftJoin(users, eq(demandesMessages.auteurId, users.id))
      .where(eq(demandesMessages.demandeId, id))
      .orderBy(asc(demandesMessages.createdAt)),
    d.interventionId
      ? db
          .select({ id: interventions.id, statut: interventions.statut, date: interventions.dateProgrammee, technicienId: interventions.technicienId, technicien: users.nom })
          .from(interventions)
          .leftJoin(users, eq(interventions.technicienId, users.id))
          .where(eq(interventions.id, d.interventionId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db.select({ id: users.id, nom: users.nom }).from(users).where(and(eq(users.role, "technicien"), eq(users.actif, 1))).orderBy(asc(users.nom)),
    adressesAppareils([d.appareilId]),
    delais(),
  ]);
  const s = STATUTS_DEMANDE[d.statut];
  const t = TYPES_DEMANDE[d.type];
  const echeance = echeancePriseEnCharge(d, dl);
  // eslint-disable-next-line react-hooks/purity
  const reste = echeance.getTime() - Date.now();
  const ouverte = !["resolue", "cloturee"].includes(d.statut);
  const missionModifiable = !mission || ["creee", "planifiee", "affectee"].includes(mission.statut);
  const tel = d.telephone ?? row.auteurTel;
  const email = d.email ?? row.auteurEmail;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/responsable/demandes" className="text-xs text-blue font-semibold">&larr; Demandes clients</Link>

      {d.personneBloquee === 1 && ouverte && (
        <div className="rounded-xl bg-red-ink text-white px-4 py-3 font-display font-extrabold">🚨 URGENT — UNE PERSONNE EST BLOQUÉE DANS LA CABINE</div>
      )}

      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{t?.icone} {t?.label}</div>
            <h1 className="font-display font-extrabold text-2xl text-navy">{d.numero}</h1>
            <p className="text-sm text-ink-soft">
              Ascenseur <Link href={`/responsable/appareils/${d.appareilId}`} className="font-semibold text-blue">{row.appareil}</Link>
              {row.client ? ` · ${row.client}` : ""} · reçue le {formatDateTime(d.createdAt)} {d.origine === "qr" ? "(QR code cabine)" : "(espace client)"}
            </p>
            {adresses.get(d.appareilId) && <p className="text-sm text-ink-soft flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {adresses.get(d.appareilId)}</p>}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Pill tone={s.tone}>{s.label}</Pill>
            {d.statut === "nouvelle" && (
              <span className={`text-xs font-bold flex items-center gap-1 ${reste < 0 ? "text-red-ink" : "text-orange-ink"}`}>
                <Clock className="w-3.5 h-3.5" /> {reste < 0 ? `Délai dépassé de ${ecart(reste)}` : `À prendre en charge dans ${ecart(reste)}`}
              </span>
            )}
            {d.prisEnChargeLe && <span className="text-xs text-ink-soft">Prise en charge en {ecart(d.prisEnChargeLe.getTime() - d.createdAt.getTime())}</span>}
          </div>
        </div>

        <ol className="flex items-start mt-5">
          {ETAPES_DEMANDE.map((e, i) => (
            <li key={e} className="flex-1 flex flex-col items-center text-center relative">
              {i > 0 && <span className={`absolute top-[9px] right-1/2 w-full h-[3px] ${i <= s.etape ? "bg-blue" : "bg-line"}`} />}
              <span className={`relative z-10 w-5 h-5 rounded-full border-[3px] ${i <= s.etape ? "bg-blue border-blue" : "bg-surface border-line"}`} />
              <span className={`mt-1.5 text-[11px] ${i === s.etape ? "font-bold text-navy" : "text-ink-soft"}`}>{e}</span>
            </li>
          ))}
        </ol>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl bg-bg px-3 py-2">
            <div className="text-[11px] text-ink-soft">Demandeur</div>
            <div className="font-semibold">{row.auteur ?? d.nom ?? "—"}</div>
          </div>
          <div className="rounded-xl bg-bg px-3 py-2">
            <div className="text-[11px] text-ink-soft">Téléphone</div>
            {tel ? <a href={`tel:${tel.replace(/[^+0-9]/g, "")}`} className="font-semibold text-blue flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {tel}</a> : <div>—</div>}
          </div>
          <div className="rounded-xl bg-bg px-3 py-2">
            <div className="text-[11px] text-ink-soft">Email</div>
            {email ? <a href={`mailto:${email}`} className="font-semibold text-blue flex items-center gap-1 truncate"><MailIcon className="w-3.5 h-3.5" /> {email}</a> : <div>—</div>}
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-line px-4 py-3 text-sm whitespace-pre-wrap">{d.description}</div>
        {d.photos.length > 0 && (
          <div className="mt-3">
            <GaleriePhotos photos={d.photos.map((url) => ({ url }))} />
          </div>
        )}
        {d.resolution && <p className="mt-3 text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">Résolution : {d.resolution}</p>}
        {d.noteSatisfaction && (
          <p className="mt-2 text-sm">Note du client : <span className="font-bold">{d.noteSatisfaction}/5</span>{d.commentaireSatisfaction ? ` — « ${d.commentaireSatisfaction} »` : ""}</p>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="p-5 lg:col-span-3">
          <div id="fil" className="scroll-mt-24" />
          <h2 className="font-display font-bold text-sm mb-3">Discussion avec le client</h2>
          <div className="flex flex-col gap-3">
            {messages.map(({ m, auteur }) =>
              m.auteurType === "systeme" ? (
                <div key={m.id} className="text-center text-[11.5px] text-ink-soft">
                  {formatDateTime(m.createdAt)} · {m.texte}
                </div>
              ) : (
                <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.auteurType === "bureau" ? "self-end bg-blue text-white" : "self-start bg-bg"}`}>
                  <div className={`text-[11px] mb-0.5 ${m.auteurType === "bureau" ? "text-white/80" : "text-ink-soft"}`}>
                    {m.auteurType === "bureau" ? `ROBUS · ${auteur ?? ""}` : auteur ?? d.nom ?? "Client"} · {formatDateTime(m.createdAt)}
                  </div>
                  {m.texte && <div className="whitespace-pre-wrap">{m.texte}</div>}
                  {m.fichiers.map((f) => (
                    <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className={`block text-xs font-semibold underline mt-1 ${m.auteurType === "bureau" ? "text-white" : "text-blue"}`}>📎 {f.nom}</a>
                  ))}
                </div>
              )
            )}
          </div>
          {d.auteurId || d.email ? (
            <form action={repondreDemande} className="flex flex-col gap-2 mt-4 pt-3 border-t border-line">
              <input type="hidden" name="demandeId" value={d.id} />
              <textarea name="texte" rows={3} placeholder="Votre réponse au client (il la reçoit par email et dans son espace)…" className={inputClass} />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <input type="file" name="fichiers" multiple accept={ACCEPT} className="text-sm" />
                <Btn>Envoyer au client</Btn>
              </div>
            </form>
          ) : (
            <p className="text-xs text-ink-soft mt-4 pt-3 border-t border-line">Demandeur sans compte ni email : contactez-le par téléphone.</p>
          )}
        </Card>

        <div className="lg:col-span-2 flex flex-col gap-4">
          {d.statut === "nouvelle" && (
            <Card className="p-5">
              <form action={prendreEnCharge}>
                <input type="hidden" name="demandeId" value={d.id} />
                <Btn className="w-full justify-center">Prendre en charge</Btn>
              </form>
              <p className="text-[11px] text-ink-soft mt-2">Le client est prévenu immédiatement (email + notification).</p>
            </Card>
          )}

          {(d.type === "panne" || d.type === "intervention" || mission) && (
            <Card className="p-5">
              <h2 className="font-display font-bold text-sm mb-2">Intervention</h2>
              {mission && (
                <p className="text-sm mb-3">
                  <Link href={`/responsable/missions/${mission.id}`} className="font-semibold text-blue">Voir la mission</Link> ·{" "}
                  {mission.technicien ? `${mission.technicien} · ${formatDateTime(mission.date)}` : "à affecter"}
                </p>
              )}
              {ouverte && missionModifiable ? (
                <form action={planifierDepuisDemande} className="flex flex-col gap-3">
                  <input type="hidden" name="demandeId" value={d.id} />
                  <Field label="Technicien">
                    <select name="technicienId" required defaultValue={mission?.technicienId ?? ""} className={inputClass}>
                      <option value="" disabled>Choisir…</option>
                      {techs.map((x) => (
                        <option key={x.id} value={x.id}>{x.nom}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Date et heure">
                    {/* eslint-disable-next-line react-hooks/purity */}
                    <input type="datetime-local" name="dateProgrammee" required defaultValue={toDatetimeLocalValue(mission?.date ?? new Date(Date.now() + (d.type === "panne" ? 3600 * 1000 : 86400 * 1000)))} className={inputClass} />
                  </Field>
                  <Btn>{mission?.technicienId ? "Modifier et renvoyer" : "Planifier et envoyer au technicien"}</Btn>
                  <p className="text-[11px] text-ink-soft">Habilitations contrôlées · le client voit « Intervention planifiée ».</p>
                </form>
              ) : null}
            </Card>
          )}

          {ouverte && (
            <Card className="p-5">
              <h2 className="font-display font-bold text-sm mb-2">Résoudre la demande</h2>
              <form action={resoudreDemande} className="flex flex-col gap-2">
                <input type="hidden" name="demandeId" value={d.id} />
                <textarea name="resolution" required rows={3} placeholder="Ce qui a été fait (envoyé au client)…" className={inputClass} />
                <Btn variant="ghost">Marquer comme résolue</Btn>
              </form>
            </Card>
          )}
          {d.statut === "resolue" && (
            <Card className="p-5">
              <form action={cloturerDemande}>
                <input type="hidden" name="demandeId" value={d.id} />
                <Btn variant="ghost" className="w-full justify-center">Clôturer</Btn>
              </form>
              <p className="text-[11px] text-ink-soft mt-2">Le client peut aussi clôturer en donnant sa note.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
