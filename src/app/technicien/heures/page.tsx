import Link from "next/link";
import { Card } from "@/components/ui";
import { HeuresSousTraitanceForm, MESSAGES_ERREUR, MESSAGES_OK } from "@/components/heures-sous-traitance-form";
import { requireUser, ROLES_TECHNICIEN } from "@/lib/auth-helpers";
import { db } from "@/db";
import { clients, heuresSousTraitance } from "@/db/schema";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import {
  aujourdhuiBruxelles,
  bornesMois,
  formatDateJour,
  formatMinutes,
  JOURS_ARRIERE_MAX,
  libelleMois,
  moisDecale,
  moisOuCourant,
  peutModifierHeures,
} from "@/lib/sous-traitance";
import {
  creerHeuresSousTraitance,
  modifierHeuresSousTraitance,
  supprimerHeuresSousTraitance,
} from "./actions";

export default async function HeuresTechnicienPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string; ok?: string; erreur?: string }>;
}) {
  const user = await requireUser(ROLES_TECHNICIEN);
  const params = await searchParams;
  const mois = moisOuCourant(params.mois);
  const moisCourant = moisOuCourant(null);
  const { debut, fin } = bornesMois(mois);
  const retour = `/technicien/heures?mois=${mois}`;

  const [listeClients, saisies] = await Promise.all([
    db
      .select({ id: clients.id, raisonSociale: clients.raisonSociale })
      .from(clients)
      .where(eq(clients.type, "sous_traitance"))
      .orderBy(clients.raisonSociale),
    db
      .select({
        id: heuresSousTraitance.id,
        clientId: heuresSousTraitance.clientId,
        client: clients.raisonSociale,
        dateTravail: heuresSousTraitance.dateTravail,
        minutes: heuresSousTraitance.minutes,
        commentaire: heuresSousTraitance.commentaire,
        createdAt: heuresSousTraitance.createdAt,
      })
      .from(heuresSousTraitance)
      .innerJoin(clients, eq(heuresSousTraitance.clientId, clients.id))
      .where(
        and(
          eq(heuresSousTraitance.technicienId, user.id),
          gte(heuresSousTraitance.dateTravail, debut),
          lt(heuresSousTraitance.dateTravail, fin)
        )
      )
      .orderBy(desc(heuresSousTraitance.dateTravail), desc(heuresSousTraitance.createdAt)),
  ]);

  const total = saisies.reduce((s, r) => s + r.minutes, 0);
  const dateMax = aujourdhuiBruxelles();
  const dateMin = user.role === "administrateur" ? undefined : aujourdhuiBruxelles(-JOURS_ARRIERE_MAX);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display font-extrabold text-xl">Heures de sous-traitance</h1>
        <p className="text-sm text-ink-soft">Déclarez le temps passé pour un client en sous-traitance.</p>
      </div>

      {params.ok && MESSAGES_OK[params.ok] && (
        <div className="text-sm bg-green-fill text-green-ink rounded-lg px-3 py-2">✓ {MESSAGES_OK[params.ok]}</div>
      )}
      {params.erreur && (
        <div className="text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">
          ⚠ {MESSAGES_ERREUR[params.erreur] ?? "Erreur."}
        </div>
      )}

      <Card className="p-4">
        <h2 className="font-display font-bold text-sm mb-3">Nouvelle saisie</h2>
        {listeClients.length === 0 ? (
          <p className="text-sm text-ink-soft">
            Aucun client de sous-traitance n&apos;est enregistré. Demandez au bureau de le créer.
          </p>
        ) : (
          <HeuresSousTraitanceForm
            action={creerHeuresSousTraitance}
            clients={listeClients}
            retour={retour}
            dateMin={dateMin}
            dateMax={dateMax}
            submitLabel="Enregistrer les heures"
          />
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Link href={`/technicien/heures?mois=${moisDecale(mois, -1)}`} className="text-sm font-semibold text-blue px-2 py-1">
          ‹ Précédent
        </Link>
        <div className="font-display font-bold text-sm">{libelleMois(mois)}</div>
        {mois < moisCourant ? (
          <Link href={`/technicien/heures?mois=${moisDecale(mois, 1)}`} className="text-sm font-semibold text-blue px-2 py-1">
            Suivant ›
          </Link>
        ) : (
          <span className="text-sm text-ink-soft/40 px-2 py-1">Suivant ›</span>
        )}
      </div>

      <Card className="p-4">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-display font-bold text-sm">Mes saisies</h2>
          <div className="text-sm">
            Total : <span className="font-display font-extrabold tabular">{formatMinutes(total)}</span>
          </div>
        </div>
        {saisies.length === 0 && <p className="text-sm text-ink-soft py-2">Aucune heure déclarée ce mois-ci.</p>}
        <div className="flex flex-col divide-y divide-line">
          {saisies.map((s) => {
            const modifiable = peutModifierHeures(s.createdAt, user.role);
            return (
              <div key={s.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{s.client}</div>
                    <div className="text-xs text-ink-soft">{formatDateJour(s.dateTravail)}</div>
                    {s.commentaire && <div className="text-xs text-ink mt-1 whitespace-pre-line">{s.commentaire}</div>}
                  </div>
                  <div className="font-display font-extrabold tabular text-sm shrink-0">{formatMinutes(s.minutes)}</div>
                </div>
                {modifiable ? (
                  <details className="mt-2">
                    <summary className="text-xs font-semibold text-blue cursor-pointer">Corriger / supprimer</summary>
                    <div className="mt-3 flex flex-col gap-3">
                      <HeuresSousTraitanceForm
                        action={modifierHeuresSousTraitance}
                        clients={listeClients}
                        retour={retour}
                        dateMin={dateMin}
                        dateMax={dateMax}
                        submitLabel="Enregistrer la correction"
                        valeurs={s}
                      />
                      <form action={supprimerHeuresSousTraitance}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="retour" value={retour} />
                        <button type="submit" className="w-full text-sm font-semibold text-red-ink border border-red-ink/30 rounded-lg py-2">
                          Supprimer cette saisie
                        </button>
                      </form>
                    </div>
                  </details>
                ) : (
                  <div className="mt-1 text-[11px] text-ink-soft">🔒 Verrouillée (plus de 24 h)</div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
