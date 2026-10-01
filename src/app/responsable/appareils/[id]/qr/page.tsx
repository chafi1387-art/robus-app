import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/db";
import { appareils } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { PARAM_TELEPHONE, adressesAppareils, assurerQrCode, getParametre, urlQr } from "@/lib/observateur";
import { BoutonImprimer } from "@/components/bouton-imprimer";

// Phase 18 : étiquette à coller dans la cabine. Le QR code ouvre /a/<code> :
// connexion (email + mot de passe) puis directement la fiche de CET appareil.
export default async function EtiquetteQrPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(ROLES_BUREAU);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [a] = await db.select({ id: appareils.id, numero: appareils.numeroInterne }).from(appareils).where(eq(appareils.id, id)).limit(1);
  if (!a) notFound();
  const code = await assurerQrCode(a.id);
  const lien = urlQr(code!);
  const [svg, telephone, adresses] = await Promise.all([
    QRCode.toString(lien, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#003366", light: "#ffffff" } }),
    getParametre(PARAM_TELEPHONE),
    adressesAppareils([a.id]),
  ]);
  const adresse = adresses.get(a.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/responsable/appareils/${a.id}`} className="text-xs text-blue font-semibold">&larr; Appareil {a.numero}</Link>
        <BoutonImprimer />
      </div>
      {!telephone && (
        <p className="text-sm bg-orange-fill text-orange-ink rounded-lg px-3 py-2 print:hidden">
          Aucun téléphone d&apos;urgence renseigné — ajoutez-le dans <Link href="/responsable/observateurs" className="font-bold underline">Observateurs</Link> pour qu&apos;il figure sur l&apos;étiquette.
        </p>
      )}
      <div className="mx-auto w-[90mm] border-2 border-navy rounded-2xl overflow-hidden bg-white text-navy shadow-sm print:shadow-none" style={{ breakInside: "avoid" }}>
        <div className="bg-navy text-white px-4 py-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-robus.png" alt="ROBUS" className="h-7 w-auto object-contain" />
          <div className="font-display font-extrabold tracking-wide text-sm">Suivi de l&apos;ascenseur</div>
        </div>
        <div className="p-4 flex flex-col items-center gap-2 text-center">
          <div className="w-[52mm] h-[52mm]" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="font-display font-extrabold text-xl">N° {a.numero}</div>
          {adresse && <div className="text-xs text-[#4b5a6b]">{adresse}</div>}
          <div className="text-[11px] text-[#4b5a6b] leading-snug">Scannez pour suivre les interventions<br />ou signaler une panne.</div>
          {telephone && (
            <div className="mt-1 w-full rounded-xl bg-[#fdecea] text-[#a3261b] py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide">Urgence ROBUS</div>
              <div className="font-display font-extrabold text-lg">{telephone}</div>
            </div>
          )}
        </div>
      </div>
      <p className="text-center text-xs text-ink-soft break-all print:hidden">Lien du QR code : {lien}</p>
    </div>
  );
}
