import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { QrCode } from "lucide-react";
import { db } from "@/db";
import { clients, journalActivite, observateurAppareils, observateurs, reinitialisationsMotDePasse, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { Btn, Card, Pill } from "@/components/ui";
import { FormulaireObservateur } from "@/components/formulaire-observateur";
import { formatDate, formatDateTime } from "@/lib/format";
import { DROIT_HISTO_12_MOIS, DROITS, MODELES, getAppareilsDuClient } from "@/lib/observateur";
import { basculerAccesObservateur, modifierObservateur, renvoyerInvitation } from "../actions";

const INVITATION: Record<string, { tone: "ok" | "crit" | "warn"; texte: string }> = {
  ok: { tone: "ok", texte: "Invitation envoyée par email." },
  echec: { tone: "crit", texte: "L'email d'invitation n'est pas parti — vérifiez l'adresse puis renvoyez l'invitation." },
  non_configure: { tone: "warn", texte: "Envoi d'email non configuré sur le serveur." },
};

export default async function ObservateurPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cree?: string; invitation?: string; enregistre?: string; erreur?: string }>;
}) {
  const user = await requireUser(ROLES_BUREAU);
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ obs: observateurs, nom: users.nom, email: users.email, telephone: users.telephone, actif: users.actif, userId: users.id, client: clients.raisonSociale })
    .from(observateurs)
    .innerJoin(users, eq(observateurs.userId, users.id))
    .innerJoin(clients, eq(observateurs.clientId, clients.id))
    .where(eq(observateurs.id, id))
    .limit(1);
  if (!row) notFound();

  const [appareils, liens, [activation], journal] = await Promise.all([
    getAppareilsDuClient(row.obs.clientId),
    db.select({ appareilId: observateurAppareils.appareilId }).from(observateurAppareils).where(eq(observateurAppareils.observateurId, id)),
    db
      .select({ le: reinitialisationsMotDePasse.utiliseLe })
      .from(reinitialisationsMotDePasse)
      .where(and(eq(reinitialisationsMotDePasse.userId, row.userId), isNotNull(reinitialisationsMotDePasse.utiliseLe)))
      .orderBy(desc(reinitialisationsMotDePasse.utiliseLe))
      .limit(1),
    db
      .select({ action: journalActivite.action, details: journalActivite.details, createdAt: journalActivite.createdAt, auteur: users.nom })
      .from(journalActivite)
      .leftJoin(users, eq(journalActivite.utilisateurId, users.id))
      .where(eq(journalActivite.entiteId, id))
      .orderBy(desc(journalActivite.createdAt))
      .limit(15),
  ]);
  const gestion = user.role === "administrateur" || user.role === "responsable_qualite";
  // eslint-disable-next-line react-hooks/purity
  const expire = row.obs.dateFin && row.obs.dateFin.getTime() <= Date.now();
  const inv = sp.invitation ? INVITATION[sp.invitation] : null;
  const idsAutorises = new Set(liens.map((l) => l.appareilId));

  return (
    <div className="flex flex-col gap-4">
      <Link href="/responsable/observateurs" className="text-xs text-blue font-semibold">&larr; Observateurs</Link>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold font-display">{row.nom}</h1>
          <p className="text-sm text-ink-soft">
            {row.email}
            {row.telephone ? ` · ${row.telephone}` : ""} · Client{" "}
            <Link href={`/responsable/clients/${row.obs.clientId}`} className="font-semibold text-blue">{row.client}</Link>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {row.actif !== 1 ? <Pill tone="crit">Accès retiré</Pill> : expire ? <Pill tone="warn">Accès expiré</Pill> : <Pill tone="ok">Accès actif</Pill>}
          <Pill tone={activation ? "ok" : "warn"}>{activation ? `Mot de passe créé le ${formatDate(activation.le)}` : "Invitation pas encore acceptée"}</Pill>
        </div>
      </div>

      {sp.cree && <div className="text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">Observateur créé.</div>}
      {inv && <div className={`text-sm rounded-lg px-3 py-2 ${inv.tone === "ok" ? "bg-green-fill text-green-ink" : inv.tone === "crit" ? "bg-red-fill text-red-ink" : "bg-orange-fill text-orange-ink"}`}>{inv.texte}</div>}
      {sp.enregistre && <div className="text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">Droits enregistrés.</div>}
      {sp.erreur && <div className="text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">{sp.erreur}</div>}

      {gestion && (
        <div className="flex gap-2 flex-wrap">
          <form action={renvoyerInvitation}>
            <input type="hidden" name="observateurId" value={id} />
            <Btn variant="ghost">Renvoyer l&apos;invitation</Btn>
          </form>
          <form action={basculerAccesObservateur}>
            <input type="hidden" name="observateurId" value={id} />
            <Btn variant="ghost">{row.actif === 1 ? "Retirer l'accès" : "Rétablir l'accès"}</Btn>
          </form>
        </div>
      )}

      <Card className="p-5">
        <h2 className="font-display font-bold text-sm mb-4">Ce qu&apos;il peut voir</h2>
        {gestion ? (
          <FormulaireObservateur
            action={modifierObservateur}
            droits={DROITS.map((d) => ({ id: d.id, label: d.label, aide: d.aide }))}
            modeles={Object.fromEntries(Object.entries(MODELES).map(([k, v]) => [k, { label: v.label, droits: [...v.droits], joursAcces: v.joursAcces }]))}
            appareils={appareils.map((a) => ({ id: a.id, numeroInterne: a.numeroInterne, adresse: a.adresse, marque: a.marque }))}
            clientId={row.obs.clientId}
            observateurId={id}
            initial={{
              modele: row.obs.modele ?? "personnalise",
              droits: row.obs.droits.filter((d) => d !== DROIT_HISTO_12_MOIS),
              appareilIds: liens.map((l) => l.appareilId),
              dateFin: row.obs.dateFin ? row.obs.dateFin.toISOString().slice(0, 10) : "",
              histo12: row.obs.droits.includes(DROIT_HISTO_12_MOIS),
            }}
            creation={false}
          />
        ) : (
          <ul className="text-sm list-disc pl-5">
            {DROITS.filter((d) => row.obs.droits.includes(d.id)).map((d) => (
              <li key={d.id}>{d.label}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-display font-bold text-sm mb-3">Étiquettes QR des appareils autorisés</h2>
        <div className="flex flex-wrap gap-2">
          {appareils
            .filter((a) => idsAutorises.has(a.id))
            .map((a) => (
              <Link key={a.id} href={`/responsable/appareils/${a.id}/qr`} className="inline-flex items-center gap-1.5 text-sm font-semibold border border-line rounded-lg px-3 py-1.5 hover:bg-blue-pale">
                <QrCode className="w-4 h-4" /> {a.numeroInterne}
              </Link>
            ))}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-display font-bold text-sm mb-3">Historique des accès</h2>
        <div className="flex flex-col divide-y divide-line text-sm">
          {journal.map((j, i) => (
            <div key={i} className="py-2 flex gap-3">
              <span className="w-36 shrink-0 text-ink-soft tabular">{formatDateTime(j.createdAt)}</span>
              <span className="flex-1 min-w-0">
                <span className="font-semibold">{j.action.replaceAll("_", " ")}</span>
                {j.auteur ? <span className="text-ink-soft"> · {j.auteur}</span> : null}
                {j.details ? <span className="block text-xs text-ink-soft truncate">{j.details}</span> : null}
              </span>
            </div>
          ))}
          {journal.length === 0 && <p className="text-ink-soft">Aucune action enregistrée.</p>}
        </div>
      </Card>
    </div>
  );
}
