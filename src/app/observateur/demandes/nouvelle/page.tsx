import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { appareils } from "@/db/schema";
import { Card } from "@/components/ui";
import { requireObservateur } from "@/lib/observateur";
import { TYPES_DEMANDE } from "@/lib/demandes";
import { creerDemandeObservateur } from "../../actions";
import { ChoixTypeDemande } from "@/components/choix-type-demande";

export default async function NouvelleDemandePage({ searchParams }: { searchParams: Promise<{ appareil?: string; type?: string; erreur?: string }> }) {
  const ctx = await requireObservateur();
  const sp = await searchParams;
  const liste = ctx.appareilIds.length
    ? await db.select({ id: appareils.id, numero: appareils.numeroInterne }).from(appareils).where(inArray(appareils.id, ctx.appareilIds)).orderBy(appareils.numeroInterne)
    : [];
  const peutPanne = ctx.droits.has("signaler_panne");
  const types = Object.entries(TYPES_DEMANDE)
    .filter(([k]) => peutPanne || (k !== "panne" && k !== "intervention"))
    .map(([id, t]) => ({ id, label: t.label, icone: t.icone }));
  const champ = "w-full rounded-xl border border-line px-3 py-3 text-[15px] bg-surface";
  return (
    <div className="flex flex-col gap-4">
      <Link href="/observateur/demandes" className="text-xs text-blue font-semibold">&larr; Mes demandes</Link>
      <h1 className="font-display font-extrabold text-[21px]">Nouvelle demande</h1>
      {sp.erreur && <div className="text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">{sp.erreur}</div>}
      <Card className="p-4">
        <form action={creerDemandeObservateur} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Ascenseur</span>
            <select name="appareilId" required defaultValue={sp.appareil && ctx.appareilIds.includes(sp.appareil) ? sp.appareil : liste.length === 1 ? liste[0].id : ""} className={champ}>
              <option value="" disabled>Choisir…</option>
              {liste.map((a) => (
                <option key={a.id} value={a.id}>{a.numero}</option>
              ))}
            </select>
          </label>
          <ChoixTypeDemande types={types} initial={sp.type && types.some((t) => t.id === sp.type) ? sp.type : types[0]?.id ?? "question"} />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Votre message</span>
            <textarea name="description" required minLength={5} maxLength={2000} rows={4} className={champ} placeholder="Décrivez la situation…" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Photos (facultatif, 5 max)</span>
            <input type="file" name="photos" multiple accept="image/jpeg,image/png,image/webp" className="text-sm" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Téléphone pour vous joindre</span>
            <input name="telephone" inputMode="tel" className={champ} />
          </label>
          <button type="submit" className="bg-blue text-white font-display font-bold rounded-xl py-3.5">Envoyer à ROBUS</button>
          <p className="text-xs text-ink-soft text-center">Vous serez prévenu par email et notification à chaque étape.</p>
        </form>
      </Card>
    </div>
  );
}
