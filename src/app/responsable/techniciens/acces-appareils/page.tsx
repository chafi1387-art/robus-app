import Link from "next/link";
import { QrCode } from "lucide-react";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { BLOCS_ACCES, reglagesAcces, type BlocAcces } from "@/lib/acces-technicien";
import { Btn, Card } from "@/components/ui";
import { enregistrerAccesTechnicien } from "./actions";

// Phase 22 : réglages de la fiche appareil côté technicien (QR code / recherche).
export default async function AccesAppareilsPage() {
  const user = await requireUser(ROLES_BUREAU);
  const r = await reglagesAcces();
  const gestion = user.role === "administrateur" || user.role === "responsable_qualite";
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <Link href="/responsable/techniciens" className="text-xs text-blue font-semibold">&larr; Équipe technique</Link>
      <div>
        <h1 className="text-2xl font-extrabold font-display flex items-center gap-2">
          <QrCode className="w-6 h-6 text-blue" /> Accès technicien aux appareils
        </h1>
        <p className="text-sm text-ink-soft">
          Ce que voit un technicien connecté quand il scanne l&apos;étiquette QR de la cabine (la même que celle de l&apos;observateur) ou cherche un appareil dans
          son application. L&apos;observateur garde ses propres droits ; les documents client ne sont jamais montrés ici.
        </p>
      </div>
      <form action={enregistrerAccesTechnicien} className="flex flex-col gap-4">
        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Appareils accessibles</h2>
          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-3 text-sm">
              <input type="radio" name="portee" value="tous" defaultChecked={r.portee === "tous"} disabled={!gestion} className="mt-1" />
              <span>
                <span className="font-semibold">Tous les appareils</span>
                <span className="block text-xs text-ink-soft">Recommandé : en dépannage, le technicien découvre souvent l&apos;appareil sur place.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input type="radio" name="portee" value="concernes" defaultChecked={r.portee === "concernes"} disabled={!gestion} className="mt-1" />
              <span>
                <span className="font-semibold">Seulement ceux qui le concernent</span>
                <span className="block text-xs text-ink-soft">Une mission sur l&apos;appareil (passée ou à venir) ou membre de l&apos;équipe d&apos;un de ses projets.</span>
              </span>
            </label>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Informations visibles</h2>
          <div className="flex flex-col divide-y divide-line">
            {(Object.keys(BLOCS_ACCES) as BlocAcces[]).map((k) => (
              <label key={k} className="py-3 flex items-center justify-between gap-4 cursor-pointer">
                <span>
                  <span className="block text-sm font-semibold">{BLOCS_ACCES[k].label}</span>
                  <span className="block text-xs text-ink-soft">{BLOCS_ACCES[k].aide}</span>
                </span>
                <span className="relative inline-flex shrink-0">
                  <input type="checkbox" name={`bloc_${k}`} defaultChecked={r.blocs[k]} disabled={!gestion} className="peer sr-only" />
                  <span className="w-11 h-6 rounded-full bg-line peer-checked:bg-green-ink transition-colors" />
                  <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                </span>
              </label>
            ))}
          </div>
        </Card>
        {gestion ? <Btn className="self-start">Enregistrer</Btn> : <p className="text-sm text-ink-soft">Seuls l&apos;administrateur et le responsable qualité peuvent modifier ces réglages.</p>}
      </form>
      <p className="text-xs text-ink-soft">Chaque consultation d&apos;une fiche par un technicien est enregistrée dans le journal d&apos;activité (traçabilité ISO).</p>
    </div>
  );
}
