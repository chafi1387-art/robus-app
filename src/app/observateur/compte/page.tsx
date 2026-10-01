import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { Card } from "@/components/ui";
import { CarteApplication } from "@/components/app-installable";
import { clePubliqueVapid } from "@/lib/push";
import { formatDate } from "@/lib/format";
import { DROITS, PARAM_TELEPHONE, getParametre, requireObservateur } from "@/lib/observateur";

export default async function CompteObservateurPage() {
  const ctx = await requireObservateur();
  const [[client], telephone] = await Promise.all([
    db.select({ nom: clients.raisonSociale }).from(clients).where(eq(clients.id, ctx.clientId)).limit(1),
    getParametre(PARAM_TELEPHONE),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display font-extrabold text-[21px]">Mon accès</h1>
      <Card className="p-4 text-sm flex flex-col gap-1">
        <div className="font-semibold">{ctx.nom}</div>
        <div className="text-ink-soft">{ctx.email}</div>
        <div className="text-ink-soft">Client : {client?.nom}</div>
        <div className="text-ink-soft">{ctx.dateFin ? `Accès jusqu'au ${formatDate(ctx.dateFin)}` : "Accès permanent"}</div>
      </Card>
      {ctx.droits.has("notifications") && <CarteApplication cleVapid={clePubliqueVapid()} />}
      <Card className="p-4">
        <h2 className="font-display font-bold text-sm mb-2">Ce que ROBUS partage avec vous</h2>
        <ul className="text-sm flex flex-col gap-1.5">
          {DROITS.filter((d) => ctx.droits.has(d.id)).map((d) => (
            <li key={d.id}>✓ {d.label}</li>
          ))}
        </ul>
      </Card>
      {telephone && (
        <a href={`tel:${telephone.replace(/[^+0-9]/g, "")}`} className="bg-red-ink text-white font-display font-bold rounded-xl py-3 text-center">
          Appeler ROBUS — {telephone}
        </a>
      )}
      <Link href="/mot-de-passe-oublie" className="text-sm font-semibold text-blue text-center">Changer mon mot de passe</Link>
    </div>
  );
}
