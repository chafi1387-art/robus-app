import Link from "next/link";
import { and, asc, eq, gte, inArray, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { appareils, clients, interventions, projets } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { formatDateTime } from "@/lib/format";
import { TYPES_SIGNALEMENT } from "@/lib/signalements-types";
import { envoyerSignalement } from "../signalements/actions";

// Phase 21 : « Signaler » — 1) le type (grandes tuiles), 2) un petit rapport
// avec photos / document, lié automatiquement à la mission si on vient d'une
// mission. Le plus simple possible.
export default async function SignalerPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; mission?: string; erreur?: string }>;
}) {
  const user = await requireUser(["technicien"]);
  const sp = await searchParams;
  const missionParam = sp.mission && /^[0-9a-f-]{36}$/i.test(sp.mission) ? sp.mission : "";
  const type = sp.type && TYPES_SIGNALEMENT[sp.type] ? sp.type : null;
  const suffixe = missionParam ? `&mission=${missionParam}` : "";

  if (!type) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="font-display font-extrabold text-xl text-navy">Signaler un problème</h1>
          <p className="text-sm text-ink-soft">Choisissez ce qui se passe. Le bureau est prévenu tout de suite.</p>
        </div>
        <div className="rounded-xl bg-red-fill text-red-ink text-sm font-semibold px-3 py-2.5">
          Blessé grave ou danger immédiat : appelez d&apos;abord les secours du pays où vous êtes, puis signalez.
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {Object.entries(TYPES_SIGNALEMENT).map(([k, t]) => (
            <Link
              key={k}
              href={`/technicien/signaler?type=${k}${suffixe}`}
              className={`rounded-2xl border bg-surface p-3.5 flex flex-col gap-1 active:bg-blue-pale ${k === "accident" ? "border-red/60 border-[1.5px]" : "border-line"}`}
            >
              <span className="text-2xl leading-none">{t.icone}</span>
              <span className="font-display font-bold text-[14.5px] text-navy leading-tight">{t.label}</span>
              <span className="text-[11.5px] text-ink-soft leading-snug">{t.aide}</span>
            </Link>
          ))}
        </div>
        <Link href="/technicien/signalements" className="text-center text-sm font-bold text-blue py-2">
          Mes signalements →
        </Link>
      </div>
    );
  }

  const t = TYPES_SIGNALEMENT[type];
  // Missions proposées : en cours, et celles d'hier à dans 7 jours.
  const maintenant = new Date();
  const depuis = new Date(maintenant.getTime() - 2 * 86400000);
  const jusqua = new Date(maintenant.getTime() + 7 * 86400000);
  const missions = await db
    .select({
      id: interventions.id,
      statut: interventions.statut,
      dateProgrammee: interventions.dateProgrammee,
      numero: appareils.numeroInterne,
      client: clients.raisonSociale,
    })
    .from(interventions)
    .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
    .leftJoin(projets, eq(interventions.projetId, projets.id))
    .leftJoin(clients, eq(projets.clientId, clients.id))
    .where(
      and(
        eq(interventions.technicienId, user.id),
        or(
          eq(interventions.statut, "en_cours"),
          missionParam ? eq(interventions.id, missionParam) : undefined,
          and(
            inArray(interventions.statut, ["creee", "planifiee", "affectee", "terminee"]),
            gte(interventions.dateProgrammee, depuis),
            lt(interventions.dateProgrammee, jusqua)
          )
        )
      )
    )
    .orderBy(asc(interventions.dateProgrammee))
    .limit(30);
  const parDefaut = missions.find((m) => m.id === missionParam)?.id ?? missions.find((m) => m.statut === "en_cours")?.id ?? "";

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/technicien/signaler${missionParam ? `?mission=${missionParam}` : ""}`} className="text-xs text-blue font-semibold">
        &larr; Changer de type
      </Link>
      <div className="flex items-center gap-3">
        <span className="text-3xl">{t.icone}</span>
        <div>
          <h1 className="font-display font-extrabold text-xl text-navy leading-tight">{t.label}</h1>
          <p className="text-[13px] text-ink-soft">{t.aide}</p>
        </div>
      </div>
      {type === "accident" && (
        <div className="rounded-xl bg-red-fill text-red-ink text-sm font-semibold px-3 py-2.5">
          Blessé grave : appelez d&apos;abord les secours du pays où vous êtes.
        </div>
      )}
      {sp.erreur && <div className="text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">{sp.erreur}</div>}

      <form action={envoyerSignalement} className="flex flex-col gap-3.5">
        <input type="hidden" name="type" value={type} />
        {t.questionBlesse && (
          <label className="flex items-center gap-3 rounded-xl border-[1.5px] border-red/50 bg-surface px-3.5 py-3 text-[15px] font-semibold">
            <input type="checkbox" name="blesse" className="w-5 h-5 accent-red" /> {t.questionBlesse}
          </label>
        )}
        <label className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] font-semibold">
          <input type="checkbox" name="bloquant" className="w-5 h-5" /> {t.questionBloquant}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Que s&apos;est-il passé ?</span>
          <textarea
            name="description"
            required
            minLength={5}
            rows={4}
            maxLength={4000}
            placeholder="Quelques mots suffisent : quoi, où, conséquences…"
            className="rounded-xl border border-line px-3 py-2.5 text-[15px] bg-surface"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Mission concernée</span>
          <select name="interventionId" defaultValue={parDefaut} className="rounded-xl border border-line px-3 py-3 text-[15px] bg-surface">
            <option value="">Aucune mission</option>
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.statut === "en_cours" ? "En cours · " : ""}
                {m.numero}
                {m.client ? ` · ${m.client}` : ""}
                {m.dateProgrammee ? ` · ${formatDateTime(m.dateProgrammee)}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Lieu (facultatif)</span>
          <input name="lieu" maxLength={200} placeholder="Adresse, route, étage…" className="rounded-xl border border-line px-3 py-3 text-[15px] bg-surface" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Photos (facultatif)</span>
          <input
            type="file"
            name="photos"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue file:text-white file:font-bold file:px-3 file:py-2"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Document (constat, PV, devis… facultatif)</span>
          <input
            type="file"
            name="fichiers"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#e9eef4] file:text-ink file:font-bold file:px-3 file:py-2"
          />
        </label>

        <button type="submit" className="bg-red text-white font-display font-extrabold text-[16px] rounded-xl py-3.5 mt-1">
          Envoyer au bureau
        </button>
        <p className="text-xs text-ink-soft text-center -mt-1">Le bureau reçoit une notification et un email immédiatement.</p>
      </form>
    </div>
  );
}
