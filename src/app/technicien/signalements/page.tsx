import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { appareils, signalements } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { formatDateTime } from "@/lib/format";
import { Pill } from "@/components/ui";
import { STATUTS_SIGNALEMENT, TYPES_SIGNALEMENT } from "@/lib/signalements-types";

// Phase 21 : historique des signalements du technicien.
export default async function MesSignalementsPage() {
  const user = await requireUser(["technicien"]);
  const rows = await db
    .select({ s: signalements, appareil: appareils.numeroInterne })
    .from(signalements)
    .leftJoin(appareils, eq(signalements.appareilId, appareils.id))
    .where(eq(signalements.technicienId, user.id))
    .orderBy(desc(signalements.createdAt))
    .limit(100);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display font-extrabold text-xl text-navy">Mes signalements</h1>
          <p className="text-sm text-ink-soft">Suivi et réponses du bureau.</p>
        </div>
        <Link href="/technicien/signaler" className="bg-red text-white font-bold text-sm rounded-xl px-3.5 py-2.5">+ Signaler</Link>
      </div>
      <div className="flex flex-col gap-2.5">
        {rows.map(({ s, appareil }) => {
          const t = TYPES_SIGNALEMENT[s.type];
          const st = STATUTS_SIGNALEMENT[s.statut] ?? STATUTS_SIGNALEMENT.nouveau;
          return (
            <Link key={s.id} href={`/technicien/signalements/${s.id}`} className="bg-surface border border-line rounded-2xl p-3.5 flex flex-col gap-1 active:bg-blue-pale">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display font-bold text-[15px] text-navy">{t?.icone} {t?.label ?? s.type}</span>
                <Pill tone={st.tone}>{st.label}</Pill>
              </div>
              <div className="text-[12.5px] text-ink-soft">
                {s.numero} · {formatDateTime(s.createdAt)}{appareil ? ` · ${appareil}` : ""}
              </div>
              <div className="text-[13px] line-clamp-2">{s.description}</div>
              {s.reponse && <div className="text-[12.5px] text-green-ink font-semibold">Réponse du bureau ✓</div>}
            </Link>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-ink-soft">Aucun signalement pour l&apos;instant.</p>}
      </div>
    </div>
  );
}
