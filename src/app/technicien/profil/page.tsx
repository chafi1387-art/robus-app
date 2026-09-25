import { Card } from "@/components/ui";
import { HabilitationsList } from "@/components/habilitations-list";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { db } from "@/db";
import {
  appareils,
  documentsFormations,
  formationsConsultations,
  habilitationsTechnicien,
  interventions,
  users,
} from "@/db/schema";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { formatDate, formatDateTime } from "@/lib/format";

const CATEGORIE_LABEL: Record<string, string> = {
  securite: "Sécurité",
  installation: "Installation",
  maintenance: "Maintenance",
  depannage: "Dépannage",
  marques: "Marques",
  procedures_robus: "Procédures Robus",
  videos: "Vidéos",
  fournisseur_iso: "Fournisseur / ISO 9001",
};

export default async function ProfilPage() {
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
    db
      .select({
        id: habilitationsTechnicien.id,
        titre: documentsFormations.titre,
        categorie: documentsFormations.categorie,
        dateObtention: habilitationsTechnicien.dateObtention,
        dateExpiration: habilitationsTechnicien.dateExpiration,
      })
      .from(habilitationsTechnicien)
      .innerJoin(documentsFormations, eq(habilitationsTechnicien.documentId, documentsFormations.id))
      .where(eq(habilitationsTechnicien.technicienId, user.id))
      .orderBy(desc(habilitationsTechnicien.dateObtention)),
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

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">
          Habilitations
        </h2>
        <HabilitationsList
          habilitations={habilitations.map((h) => ({
            id: h.id,
            titre: h.titre,
            subtitle: CATEGORIE_LABEL[h.categorie] ?? h.categorie,
            dateObtention: h.dateObtention,
            dateExpiration: h.dateExpiration,
          }))}
        />
      </section>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">
          Formations suivies
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
            <p className="text-sm text-ink-soft px-4 py-3">Aucune formation suivie pour l&apos;instant.</p>
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
