import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appareils, interventions, projets, signalements } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { formatDateTime } from "@/lib/format";
import { Card, Pill } from "@/components/ui";
import { GaleriePhotos } from "@/components/galerie-photos";
import { GRAVITES_SIGNALEMENT, STATUTS_SIGNALEMENT, TYPES_SIGNALEMENT } from "@/lib/signalements-types";

// Phase 21 : détail d'un signalement côté technicien (statut + réponse du bureau).
export default async function SignalementTechnicienPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ envoye?: string }>;
}) {
  const user = await requireUser(["technicien"]);
  const { id } = await params;
  const { envoye } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ s: signalements, appareil: appareils.numeroInterne, projetRef: projets.reference, dateMission: interventions.dateProgrammee })
    .from(signalements)
    .leftJoin(appareils, eq(signalements.appareilId, appareils.id))
    .leftJoin(projets, eq(signalements.projetId, projets.id))
    .leftJoin(interventions, eq(signalements.interventionId, interventions.id))
    .where(and(eq(signalements.id, id), eq(signalements.technicienId, user.id)))
    .limit(1);
  if (!row) notFound();
  const s = row.s;
  const t = TYPES_SIGNALEMENT[s.type];
  const st = STATUTS_SIGNALEMENT[s.statut] ?? STATUTS_SIGNALEMENT.nouveau;
  const etapes = ["Envoyé", "Pris en charge", "Clôturé"];
  const etape = s.statut === "cloture" ? 2 : s.statut === "pris_en_charge" ? 1 : 0;
  return (
    <div className="flex flex-col gap-4">
      <Link href="/technicien/signalements" className="text-xs text-blue font-semibold">&larr; Mes signalements</Link>
      {envoye && (
        <div className="text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2 font-semibold">
          Signalement envoyé — le bureau est prévenu. Vous recevrez sa réponse ici.
        </div>
      )}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{s.numero}</div>
            <h1 className="font-display font-extrabold text-lg text-navy">{t?.icone} {t?.label ?? s.type}</h1>
            <div className="text-[12.5px] text-ink-soft">{formatDateTime(s.createdAt)}</div>
          </div>
          <Pill tone={st.tone}>{st.label}</Pill>
        </div>
        <ol className="flex items-start mt-4">
          {etapes.map((e, i) => (
            <li key={e} className="flex-1 flex flex-col items-center text-center relative">
              {i > 0 && <span className={`absolute top-[9px] right-1/2 w-full h-[3px] ${i <= etape ? "bg-blue" : "bg-line"}`} />}
              <span className={`relative z-10 w-5 h-5 rounded-full border-[3px] ${i <= etape ? "bg-blue border-blue" : "bg-surface border-line"}`} />
              <span className={`mt-1.5 text-[11px] ${i === etape ? "font-bold text-navy" : "text-ink-soft"}`}>{e}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <Pill tone={GRAVITES_SIGNALEMENT[s.gravite]?.tone ?? "neutral"}>Gravité : {GRAVITES_SIGNALEMENT[s.gravite]?.label ?? s.gravite}</Pill>
          {s.blesse === 1 && <Pill tone="crit">Personne blessée</Pill>}
          {s.bloquant === 1 && <Pill tone="warn">{t?.questionBloquant ?? "Bloquant"}</Pill>}
        </div>
        <p className="text-sm mt-3 whitespace-pre-wrap">{s.description}</p>
        {(row.appareil || s.lieu) && (
          <div className="text-[13px] text-ink-soft mt-2">
            {row.appareil ? `Mission : ${row.appareil}${row.projetRef ? ` · ${row.projetRef}` : ""}${row.dateMission ? ` · ${formatDateTime(row.dateMission)}` : ""}` : ""}
            {row.appareil && s.lieu ? " — " : ""}
            {s.lieu ? `Lieu : ${s.lieu}` : ""}
          </div>
        )}
        {s.photos.length > 0 && (
          <div className="mt-3">
            <GaleriePhotos photos={s.photos.map((url) => ({ url }))} taille="sm" />
          </div>
        )}
        {s.fichiers.map((f) => (
          <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="block text-sm font-semibold text-blue mt-1.5">📎 {f.nom}</a>
        ))}
      </Card>
      <Card className="p-4">
        <h2 className="font-display font-bold text-sm mb-2">Réponse du bureau</h2>
        {s.reponse ? (
          <>
            <p className="text-sm whitespace-pre-wrap">{s.reponse}</p>
            {s.reponseLe && <p className="text-xs text-ink-soft mt-1">{formatDateTime(s.reponseLe)}</p>}
          </>
        ) : (
          <p className="text-sm text-ink-soft">{s.statut === "pris_en_charge" ? "Le bureau s'en occupe." : "En attente de lecture par le bureau."}</p>
        )}
      </Card>
    </div>
  );
}
