import "server-only";
import { db } from "@/db";
import { appareils, demandesClient, documentsClient, interventions, observateurAppareils, observateurs } from "@/db/schema";
import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { envoyerResumeMensuel } from "@/lib/mail";
import { getParametre } from "@/lib/observateur";
import { PARAM_RESUME_MENSUEL, STATUTS_DEMANDE, observateursActifs } from "@/lib/demandes";
import { prochainesVisites } from "@/lib/observateur-donnees";

// Phase 20 : résumé mensuel envoyé aux observateurs le 1er du mois (à partir
// de 8 h, heure de Bruxelles), une seule fois par mois et par observateur.

const TYPE: Record<string, string> = { preventive: "Maintenance préventive", corrective: "Dépannage", systematique: "Contrôle" };

function partiesBruxelles(d: Date) {
  const p = new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23" }).formatToParts(d);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { annee: v("year"), mois: v("month"), jour: v("day"), heure: v("hour") };
}

export async function envoyerResumesMensuels(forcer = false) {
  if ((await getParametre(PARAM_RESUME_MENSUEL)) === "0") return 0;
  const now = new Date();
  const b = partiesBruxelles(now);
  if (!forcer && (b.jour !== 1 || b.heure < 8)) return 0;
  // Mois précédent (bornes en UTC approximées au jour).
  const debut = new Date(Date.UTC(b.mois === 1 ? b.annee - 1 : b.annee, b.mois === 1 ? 11 : b.mois - 2, 1));
  const fin = new Date(Date.UTC(b.annee, b.mois - 1, 1));
  const libelleMois = debut.toLocaleDateString("fr-BE", { month: "long", year: "numeric", timeZone: "UTC" });
  const obsList = await observateursActifs();
  let envoyes = 0;
  for (const o of obsList) {
    if (!forcer && o.resumeEnvoyeLe) {
      const r = partiesBruxelles(o.resumeEnvoyeLe);
      if (r.annee === b.annee && r.mois === b.mois) continue;
    }
    const liens = await db.select({ id: observateurAppareils.appareilId }).from(observateurAppareils).where(eq(observateurAppareils.observateurId, o.obsId));
    const ids = liens.map((l) => l.id);
    if (!ids.length) continue;
    const [faites, visites, demandes, docs] = await Promise.all([
      db
        .select({ numero: appareils.numeroInterne, type: interventions.type, fin: interventions.dateFin })
        .from(interventions)
        .innerJoin(appareils, eq(interventions.appareilId, appareils.id))
        .where(and(inArray(interventions.appareilId, ids), inArray(interventions.statut, ["terminee", "validee", "cloturee"]), gte(interventions.dateFin, debut), lt(interventions.dateFin, fin))),
      prochainesVisites(ids),
      db
        .select({ numero: demandesClient.numero, statut: demandesClient.statut })
        .from(demandesClient)
        .where(and(eq(demandesClient.auteurId, o.userId), inArray(demandesClient.statut, ["nouvelle", "prise_en_charge", "planifiee"]))),
      db
        .select({ titre: documentsClient.titre })
        .from(documentsClient)
        .where(and(inArray(documentsClient.appareilId, ids), isNull(documentsClient.archiveLe), gte(documentsClient.createdAt, debut), lt(documentsClient.createdAt, fin))),
    ]);
    const nums = new Map((await db.select({ id: appareils.id, n: appareils.numeroInterne }).from(appareils).where(inArray(appareils.id, ids))).map((a) => [a.id, a.n]));
    const r = await envoyerResumeMensuel({
      email: o.email,
      nom: o.nom,
      mois: libelleMois,
      lien: new URL("/observateur", process.env.NEXTAUTH_URL || "https://robuswork.tech").toString(),
      blocs: [
        { titre: `Interventions réalisées (${faites.length})`, lignes: faites.map((f) => `${f.fin?.toLocaleDateString("fr-BE")} — ${f.numero} — ${TYPE[f.type] ?? f.type}`) },
        { titre: "Prochaines visites", lignes: visites.slice(0, 5).map((v) => `${v.date.toLocaleDateString("fr-BE")} — ${nums.get(v.appareilId) ?? ""} — ${TYPE[v.type] ?? v.type}`) },
        { titre: `Vos demandes en cours (${demandes.length})`, lignes: demandes.map((d) => `${d.numero} — ${STATUTS_DEMANDE[d.statut]?.label ?? d.statut}`) },
        ...(docs.length ? [{ titre: "Nouveaux documents", lignes: docs.map((d) => d.titre) }] : []),
      ],
    });
    if (r === "ok" || r === "non_configure") {
      await db.update(observateurs).set({ resumeEnvoyeLe: now }).where(eq(observateurs.id, o.obsId));
      if (r === "ok") envoyes++;
    }
  }
  return envoyes;
}
