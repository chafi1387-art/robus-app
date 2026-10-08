import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, observateurs, users } from "@/db/schema";
import { PARAM_CONTACT_EMAIL, PARAM_CONTACT_NOM, PARAM_CONTACT_TEL, PARAM_RESUME_MENSUEL } from "@/lib/demandes";
import { basculerResumeMensuel } from "../actions";
import { Card } from "@/components/ui";
import { CarteApplication } from "@/components/app-installable";
import { clePubliqueVapid } from "@/lib/push";
import { formatDate } from "@/lib/format";
import { DROITS, PARAM_TELEPHONE, getParametre, requireObservateur } from "@/lib/observateur";
import { BoutonEnvoi } from "@/components/bouton-envoi";

export default async function CompteObservateurPage() {
  const ctx = await requireObservateur();
  const [[client], telephone, contactNom, contactTel, contactEmail, resumeGlobal, [obs]] = await Promise.all([
    db
      .select({ nom: clients.raisonSociale, gestionnaire: users.nom, gestionnaireEmail: users.email, gestionnaireTel: users.telephone })
      .from(clients)
      .leftJoin(users, eq(clients.commercialResponsableId, users.id))
      .where(eq(clients.id, ctx.clientId))
      .limit(1),
    getParametre(PARAM_TELEPHONE),
    getParametre(PARAM_CONTACT_NOM),
    getParametre(PARAM_CONTACT_TEL),
    getParametre(PARAM_CONTACT_EMAIL),
    getParametre(PARAM_RESUME_MENSUEL),
    db.select({ resume: observateurs.resumeMensuel }).from(observateurs).where(eq(observateurs.id, ctx.observateurId)).limit(1),
  ]);
  // Contact ROBUS : gestionnaire du client si défini, sinon contact général.
  const contact = {
    nom: client?.gestionnaire ?? contactNom ?? "Service client ROBUS",
    tel: client?.gestionnaireTel ?? contactTel,
    email: client?.gestionnaireEmail ?? contactEmail,
  };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display font-extrabold text-[21px]">Mon accès</h1>
      <Card className="p-4 text-sm flex flex-col gap-1">
        <div className="font-semibold">{ctx.nom}</div>
        <div className="text-ink-soft">{ctx.email}</div>
        <div className="text-ink-soft">Client : {client?.nom}</div>
        <div className="text-ink-soft">{ctx.dateFin ? `Accès jusqu'au ${formatDate(ctx.dateFin)}` : "Accès permanent"}</div>
      </Card>
      <Card className="p-4">
        <h2 className="font-display font-bold text-sm mb-2">Votre contact ROBUS</h2>
        <div className="text-sm font-semibold">{contact.nom}</div>
        <div className="flex flex-col gap-1 mt-1 text-sm">
          {contact.tel && <a href={`tel:${contact.tel.replace(/[^+0-9]/g, "")}`} className="text-blue font-semibold">📞 {contact.tel}</a>}
          {contact.email && <a href={`mailto:${contact.email}`} className="text-blue font-semibold">✉️ {contact.email}</a>}
        </div>
        <Link href="/observateur/demandes/nouvelle" className="inline-block mt-3 text-sm font-bold text-blue">Envoyer une demande →</Link>
      </Card>
      {ctx.droits.has("notifications") && <CarteApplication cleVapid={clePubliqueVapid()} />}
      {resumeGlobal !== "0" && (
        <Card className="p-4 flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-semibold">Résumé mensuel par email</div>
            <div className="text-xs text-ink-soft">Interventions du mois, prochaines visites, demandes en cours — le 1er du mois.</div>
          </div>
          <form action={basculerResumeMensuel}>
            <BoutonEnvoi type="submit" className={`text-xs font-bold rounded-full px-3 py-1.5 ${obs?.resume ? "bg-green-fill text-green-ink" : "bg-bg text-ink-soft border border-line"}`}>
              {obs?.resume ? "Activé" : "Désactivé"}
            </BoutonEnvoi>
          </form>
        </Card>
      )}
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
