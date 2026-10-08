import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { Star } from "lucide-react";
import { db } from "@/db";
import { appareils, demandesClient, demandesMessages, interventions, users } from "@/db/schema";
import { Card, Pill } from "@/components/ui";
import { GaleriePhotos } from "@/components/galerie-photos";
import { formatDateTime } from "@/lib/format";
import { requireObservateur } from "@/lib/observateur";
import { ETAPES_DEMANDE, STATUTS_DEMANDE, TYPES_DEMANDE } from "@/lib/demandes";
import { prenom } from "@/lib/observateur-donnees";
import { noterDemande, repondreDemandeClient } from "../../actions";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { EnvoiFichiers } from "@/components/envoi-fichiers";

// Phase 20 : suivi d'une demande par l'observateur (étapes, discussion, note).
export default async function DemandeObservateurPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cree?: string; merci?: string; erreur?: string }>;
}) {
  const ctx = await requireObservateur();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ d: demandesClient, appareil: appareils.numeroInterne })
    .from(demandesClient)
    .innerJoin(appareils, eq(demandesClient.appareilId, appareils.id))
    .where(and(eq(demandesClient.id, id), eq(demandesClient.auteurId, ctx.userId)))
    .limit(1);
  if (!row) notFound();
  const d = row.d;
  const [messages, mission] = await Promise.all([
    db
      .select({ m: demandesMessages, auteur: users.nom })
      .from(demandesMessages)
      .leftJoin(users, eq(demandesMessages.auteurId, users.id))
      .where(eq(demandesMessages.demandeId, id))
      .orderBy(asc(demandesMessages.createdAt)),
    d.interventionId
      ? db
          .select({ date: interventions.dateProgrammee, technicien: users.nom, statut: interventions.statut })
          .from(interventions)
          .leftJoin(users, eq(interventions.technicienId, users.id))
          .where(eq(interventions.id, d.interventionId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  const s = STATUTS_DEMANDE[d.statut];
  const t = TYPES_DEMANDE[d.type];
  const fini = d.statut === "resolue" || d.statut === "cloturee";

  return (
    <div className="flex flex-col gap-4">
      <Link href="/observateur/demandes" className="text-xs text-blue font-semibold">&larr; Mes demandes</Link>
      {sp.cree && (
        <div className="text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">
          Demande envoyée — ROBUS est prévenu{d.type === "panne" ? " immédiatement" : ""}. Vous serez informé à chaque étape.
        </div>
      )}
      {sp.erreur && <div className="text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">{sp.erreur}</div>}

      <Card className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{t?.icone} {t?.label}</div>
            <h1 className="font-display font-extrabold text-xl text-navy">{d.numero}</h1>
            <div className="text-[13px] text-ink-soft">Ascenseur {row.appareil} · {formatDateTime(d.createdAt)}</div>
          </div>
          <Pill tone={s.tone}>{s.label}</Pill>
        </div>
        <ol className="flex items-start mt-4">
          {ETAPES_DEMANDE.map((e, i) => (
            <li key={e} className="flex-1 flex flex-col items-center text-center relative">
              {i > 0 && <span className={`absolute top-[9px] right-1/2 w-full h-[3px] ${i <= s.etape ? "bg-blue" : "bg-line"}`} />}
              <span className={`relative z-10 w-5 h-5 rounded-full border-[3px] ${i <= s.etape ? "bg-blue border-blue" : "bg-surface border-line"}`} />
              <span className={`mt-1.5 text-[10.5px] leading-tight ${i === s.etape ? "font-bold text-navy" : "text-ink-soft"}`}>{e}</span>
            </li>
          ))}
        </ol>
        {mission?.date && !fini && (
          <p className="text-sm mt-4 rounded-xl bg-blue-pale/60 px-3 py-2">
            Intervention prévue le <span className="font-semibold">{formatDateTime(mission.date)}</span>
            {prenom(mission.technicien) ? ` avec ${prenom(mission.technicien)}` : ""}.
          </p>
        )}
        <p className="text-sm mt-3 whitespace-pre-wrap">{d.description}</p>
        {d.photos.length > 0 && (
          <div className="mt-2">
            <GaleriePhotos photos={d.photos.map((url) => ({ url }))} taille="sm" />
          </div>
        )}
        {d.resolution && <p className="text-sm mt-3 bg-green-fill text-green-ink rounded-lg px-3 py-2">{d.resolution}</p>}
      </Card>

      <Card className="p-4">
        <div id="fil" className="scroll-mt-20" />
        <h2 className="font-display font-bold text-sm mb-3">Échanges avec ROBUS</h2>
        <div className="flex flex-col gap-2.5">
          {messages.map(({ m, auteur }) =>
            m.auteurType === "systeme" ? (
              <div key={m.id} className="text-center text-[11.5px] text-ink-soft">
                {formatDateTime(m.createdAt)} · {m.texte}
              </div>
            ) : (
              <div key={m.id} className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${m.auteurType === "client" ? "self-end bg-blue text-white" : "self-start bg-bg"}`}>
                <div className={`text-[11px] mb-0.5 ${m.auteurType === "client" ? "text-white/80" : "text-ink-soft"}`}>
                  {m.auteurType === "client" ? "Vous" : `ROBUS${prenom(auteur) ? ` · ${prenom(auteur)}` : ""}`} · {formatDateTime(m.createdAt)}
                </div>
                {m.texte && <div className="whitespace-pre-wrap">{m.texte}</div>}
                {m.fichiers.map((f) => (
                  <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className={`block text-xs font-semibold underline mt-1 ${m.auteurType === "client" ? "text-white" : "text-blue"}`}>📎 {f.nom}</a>
                ))}
              </div>
            )
          )}
        </div>
        <form action={repondreDemandeClient} className="flex flex-col gap-2 mt-4 pt-3 border-t border-line">
          <input type="hidden" name="demandeId" value={d.id} />
          <textarea name="texte" rows={2} placeholder={fini ? "Un problème persiste ? Écrivez-nous (la demande sera rouverte)…" : "Votre message à ROBUS…"} className="rounded-xl border border-line px-3 py-2.5 text-[15px]" />
          <EnvoiFichiers type="fichier" name="fichiers" dossier="missions" max={5} compact />
          <BoutonEnvoi type="submit" className="self-end bg-blue text-white font-bold text-sm rounded-xl px-4 py-2.5" enCours="Envoi…">Envoyer</BoutonEnvoi>
        </form>
      </Card>

      {fini && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Votre avis sur le traitement</h2>
          {d.noteSatisfaction ? (
            <p className="text-sm text-green-ink">Merci pour votre note ({d.noteSatisfaction}/5) !</p>
          ) : (
            <form action={noterDemande} className="flex flex-col gap-3">
              <input type="hidden" name="demandeId" value={d.id} />
              <div className="flex flex-row-reverse justify-end gap-1">
                {[5, 4, 3, 2, 1].map((n) => (
                  <label key={n} className="cursor-pointer">
                    <input type="radio" name="note" value={n} required className="sr-only peer" />
                    <span className="flex flex-col items-center gap-0.5 rounded-xl border border-line px-2.5 py-2 peer-checked:bg-blue peer-checked:text-white peer-checked:border-blue">
                      <Star className="w-5 h-5" />
                      <span className="text-xs font-bold">{n}</span>
                    </span>
                  </label>
                ))}
              </div>
              <textarea name="commentaire" rows={2} maxLength={1000} placeholder="Un commentaire ? (facultatif)" className="rounded-xl border border-line px-3 py-2.5 text-[15px]" />
              <BoutonEnvoi type="submit" className="bg-blue text-white font-display font-bold rounded-xl py-3">Envoyer ma note{d.statut === "resolue" ? " et clôturer" : ""}</BoutonEnvoi>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
