import Link from "next/link";
import { Card } from "@/components/ui";
import { HabilitationsCartes } from "@/components/habilitations-cartes";
import { habilitationsCourantes } from "@/lib/habilitations";
import { deposerCertificat } from "../formations/actions";
import { Btn, Field, inputClass } from "@/components/ui";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { db } from "@/db";
import {
  appareils,
  documentsFormations,
  formationsConsultations,
  habilitationsCatalogue,
  interventions,
  users,
} from "@/db/schema";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { formatDate, formatDateTime } from "@/lib/format";
import { CarteApplication } from "@/components/app-installable";
import { clePubliqueVapid } from "@/lib/push";

const CATEGORIE_LABEL: Record<string, string> = {
  securite: "Sécurité",
  installation: "Installation",
  maintenance: "Maintenance",
  depannage: "Dépannage",
  marques: "Marques",
  procedures_robus: "Procédures Robus",
  videos: "Vidéos",
  fournisseur_iso: "Fournisseur / ISO 9001",
  formation: "Formations internes",
};

export default async function ProfilPage({ searchParams }: { searchParams: Promise<{ depose?: string; erreurHab?: string }> }) {
  const sp = await searchParams;
  const catalogue = await db.select({ id: habilitationsCatalogue.id, nom: habilitationsCatalogue.nom }).from(habilitationsCatalogue).where(eq(habilitationsCatalogue.actif, 1)).orderBy(habilitationsCatalogue.nom);
  const user = await requireUser(ROLES_TECHNICIEN);

  const [
    [{ n: total }],
    [{ n: terminees }],
    [userRow],
    habilitations,
    consultations,
    historique,
  ] = await Promise.all([
    db.select({ n: count() }).from(interventions).where(eq(interventions.technicienId, user.id)),
    db
      .select({ n: count() })
      .from(interventions)
      .where(
        and(
          eq(interventions.technicienId, user.id),
          sql`${interventions.statut} in ('terminee','validee','cloturee')`
        )
      ),
    db.select({ telephone: users.telephone }).from(users).where(eq(users.id, user.id)).limit(1),
    habilitationsCourantes([user.id]),
    db
      .select({
        documentId: formationsConsultations.documentId,
        dateConsultation: formationsConsultations.dateConsultation,
        titre: documentsFormations.titre,
        estFormation: documentsFormations.estFormation,
      })
      .from(formationsConsultations)
      .innerJoin(documentsFormations, eq(formationsConsultations.documentId, documentsFormations.id))
      .where(eq(formationsConsultations.technicienId, user.id))
      .orderBy(desc(formationsConsultations.dateConsultation))
      .limit(10),
    db
      .select({
        id: interventions.id,
        type: interventions.type,
        statut: interventions.statut,
        dateProgrammee: interventions.dateProgrammee,
        numeroInterne: appareils.numeroInterne,
      })
      .from(interventions)
      .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
      .where(eq(interventions.technicienId, user.id))
      .orderBy(desc(interventions.dateProgrammee))
      .limit(10),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue to-navy text-white flex items-center justify-center font-display font-extrabold text-lg">
          {user.name
            ?.split(" ")
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div>
          <div className="font-display font-extrabold text-lg">{user.name}</div>
          <div className="text-sm text-ink-soft">Technicien</div>
        </div>
      </div>

      <CarteApplication cleVapid={clePubliqueVapid()} />

      <Card className="p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">Coordonnées</h2>
        <div className="text-sm flex flex-col gap-1">
          <div>{user.email}</div>
          <div className="text-ink-soft">{userRow?.telephone || "Téléphone non renseigné"}</div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-xs text-ink-soft">Interventions affectées</div>
          <div className="font-display text-2xl font-extrabold tabular">{Number(total)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-ink-soft">Terminées</div>
          <div className="font-display text-2xl font-extrabold tabular">{Number(terminees)}</div>
        </Card>
      </div>

      <section id="habilitations" className="scroll-mt-20">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">Mes habilitations</h2>
        {sp.depose && <div className="mb-2 text-xs bg-green-fill text-green-ink rounded-lg px-3 py-2">Certificat envoyé — en attente de validation par le bureau.</div>}
        {sp.erreurHab && <div className="mb-2 text-xs bg-red-fill text-red-ink rounded-lg px-3 py-2">{sp.erreurHab}</div>}
        <HabilitationsCartes habilitations={habilitations} />
        <details className="mt-3 rounded-xl border border-line bg-surface p-3.5">
          <summary className="text-sm font-bold text-blue cursor-pointer select-none">+ Déposer un certificat (nouveau ou renouvellement)</summary>
          <form action={deposerCertificat} className="flex flex-col gap-3 mt-3">
            <Field label="Habilitation">
              <select name="catalogueId" required defaultValue="" className={inputClass}>
                <option value="" disabled>Choisir…</option>
                {catalogue.map((c) => (
                  <option key={c.id} value={c.id}>{c.nom}</option>
                ))}
              </select>
            </Field>
            <Field label="Date d'obtention">
              <input type="date" name="dateObtention" required className={inputClass} />
            </Field>
            <Field label="Organisme (facultatif)">
              <input name="organisme" className={inputClass} />
            </Field>
            <Field label="N° de certificat (facultatif)">
              <input name="numeroCertificat" className={inputClass} />
            </Field>
            <Field label="Certificat (PDF ou photo)">
              <input type="file" name="certificat" required accept="application/pdf,image/jpeg,image/png,image/webp" className="text-sm" />
            </Field>
            <Btn className="justify-center">Envoyer au bureau</Btn>
          </form>
        </details>
      </section>

      <section className="grid grid-cols-2 gap-2.5">
        <Link href="/technicien/signalements" className="rounded-2xl border border-line bg-surface px-4 py-3">
          <span className="block text-xl">⚠️</span>
          <span className="block font-bold text-sm">Mes signalements</span>
          <span className="block text-xs text-ink-soft">Suivi et réponses du bureau</span>
        </Link>
        <Link href="/technicien/formations" className="rounded-2xl border border-line bg-surface px-4 py-3">
          <span className="block text-xl">🎓</span>
          <span className="block font-bold text-sm">Mes formations</span>
          <span className="block text-xs text-ink-soft">Dates, présence, attestations</span>
        </Link>
      </section>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">
          Documents lus (lecture attestée)
        </h2>
        <div className="flex flex-col divide-y divide-line bg-surface border border-line rounded-2xl">
          {consultations.map((c, i) => (
            <div key={`${c.documentId}-${i}`} className="px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="text-sm min-w-0 truncate">{c.titre}</div>
              <div className="text-xs text-ink-soft whitespace-nowrap">
                {formatDate(c.dateConsultation)}
              </div>
            </div>
          ))}
          {consultations.length === 0 && (
            <p className="text-sm text-ink-soft px-4 py-3">Aucun document lu pour l&apos;instant.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">
          Historique d&apos;interventions récentes
        </h2>
        <div className="flex flex-col divide-y divide-line bg-surface border border-line rounded-2xl">
          {historique.map((h) => (
            <div key={h.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="text-sm min-w-0 truncate">{h.numeroInterne}</div>
              <div className="text-xs text-ink-soft whitespace-nowrap">
                {formatDateTime(h.dateProgrammee)}
              </div>
            </div>
          ))}
          {historique.length === 0 && (
            <p className="text-sm text-ink-soft px-4 py-3">Aucune intervention pour l&apos;instant.</p>
          )}
        </div>
      </section>
    </div>
  );
}
