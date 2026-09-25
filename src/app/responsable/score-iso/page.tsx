import { Card, Btn, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { scoreIsoSaisies } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { BLOCS_ISO, calculerBlocsAutomatiques, calculerScoreGlobal } from "@/lib/score-iso";
import { enregistrerScoreMoisForm } from "./actions";

function moisCourant() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function toneScore(score: number): "ok" | "warn" | "crit" {
  if (score >= 80) return "ok";
  if (score >= 50) return "warn";
  return "crit";
}

const TONE_TEXT: Record<"ok" | "warn" | "crit", string> = {
  ok: "text-green-ink",
  warn: "text-orange-ink",
  crit: "text-red-ink",
};

const TONE_BG: Record<"ok" | "warn" | "crit", string> = {
  ok: "bg-green-fill",
  warn: "bg-orange-fill",
  crit: "bg-red-fill",
};

async function getSaisiesMois(mois: string) {
  const rows = await db
    .select()
    .from(scoreIsoSaisies)
    .where(eq(scoreIsoSaisies.mois, mois));
  const parBloc: Record<string, { valeur: number; commentaire: string | null }> = {};
  for (const r of rows) {
    parBloc[r.bloc] = { valeur: Number(r.valeur), commentaire: r.commentaire };
  }
  return parBloc;
}

async function getHistorique() {
  const moisDistincts = await db
    .select({ mois: scoreIsoSaisies.mois })
    .from(scoreIsoSaisies)
    .groupBy(scoreIsoSaisies.mois)
    .orderBy(sql`${scoreIsoSaisies.mois} desc`);

  const historique = await Promise.all(
    moisDistincts.map(async ({ mois }) => {
      const saisies = await getSaisiesMois(mois);
      const valeurs: Record<string, number> = {};
      for (const bloc of BLOCS_ISO) {
        if (saisies[bloc.cle]) valeurs[bloc.cle] = saisies[bloc.cle].valeur;
      }
      return { mois, score: calculerScoreGlobal(valeurs) };
    })
  );
  return historique;
}

export default async function ScoreIsoPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string; suggerer?: string }>;
}) {
  await requireUser(ROLES_BUREAU);
  const params = await searchParams;
  const mois = params.mois && /^\d{4}-\d{2}$/.test(params.mois) ? params.mois : moisCourant();

  const [saisies, historique, suggestions] = await Promise.all([
    getSaisiesMois(mois),
    getHistorique(),
    params.suggerer === "1"
      ? calculerBlocsAutomatiques()
      : Promise.resolve<Partial<Record<string, number>>>({}),
  ]);

  const valeurs: Record<string, number> = {};
  for (const bloc of BLOCS_ISO) {
    if (saisies[bloc.cle]) valeurs[bloc.cle] = saisies[bloc.cle].valeur;
  }
  const scoreGlobal = calculerScoreGlobal(valeurs);
  const tone = toneScore(scoreGlobal);
  const nbBlocsSaisis = Object.keys(saisies).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold font-display">Score ISO 9001</h1>
          <p className="text-sm text-ink-soft">
            Section 9 du cahier des charges — 7 blocs pondérés, semi-automatique, historique mensuel.
          </p>
        </div>
        <form className="flex items-center gap-2">
          <Field label="Mois">
            <input type="month" name="mois" defaultValue={mois} className={inputClass} />
          </Field>
          <Btn type="submit" variant="ghost" className="mt-5">
            Afficher
          </Btn>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className={`p-6 flex flex-col items-center justify-center ${TONE_BG[tone]}`}>
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-1">
            Score global — {mois}
          </div>
          <div className={`font-display text-5xl font-extrabold tabular ${TONE_TEXT[tone]}`}>
            {scoreGlobal}%
          </div>
          <div className="text-xs text-ink-soft mt-2">
            {nbBlocsSaisis} / {BLOCS_ISO.length} blocs saisis ce mois
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display font-bold text-sm mb-3">Répartition par bloc</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="pb-2 pr-3">Bloc</th>
                  <th className="pb-2 pr-3">Poids</th>
                  <th className="pb-2 pr-3">Valeur</th>
                  <th className="pb-2 pr-3">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {BLOCS_ISO.map((bloc) => {
                  const valeur = valeurs[bloc.cle];
                  const contribution =
                    valeur !== undefined ? Math.round((valeur * bloc.poids) / 100) : null;
                  return (
                    <tr key={bloc.cle} className="border-b border-line last:border-0">
                      <td className="py-2 pr-3 font-semibold">{bloc.label}</td>
                      <td className="py-2 pr-3 text-ink-soft">{bloc.poids}%</td>
                      <td className="py-2 pr-3 tabular">
                        {valeur !== undefined ? `${valeur}%` : <span className="text-ink-soft">—</span>}
                      </td>
                      <td className="py-2 pr-3 tabular font-semibold">
                        {contribution !== null ? `${contribution} pt` : <span className="text-ink-soft">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h2 className="font-display font-bold text-sm">Saisie du mois — {mois}</h2>
          <Btn
            href={`/responsable/score-iso?mois=${mois}&suggerer=1`}
            variant="ghost"
          >
            Suggérer les valeurs automatiques
          </Btn>
        </div>
        {params.suggerer === "1" && (
          <div className="bg-blue-pale text-xs text-ink-soft rounded-xl px-4 py-3 mb-4">
            Valeurs suggérées à partir des données réelles pour les blocs « Réalisation des
            activités » et « Non-conformités & Actions » (pré-remplies ci-dessous, non
            enregistrées tant que vous ne validez pas). Les autres blocs restent à saisir
            manuellement.
          </div>
        )}
        <form action={enregistrerScoreMoisForm} className="flex flex-col gap-4">
          <input type="hidden" name="mois" value={mois} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {BLOCS_ISO.map((bloc) => {
              const saisie = saisies[bloc.cle];
              const suggestion = suggestions[bloc.cle];
              const defaultValeur = saisie?.valeur ?? suggestion ?? "";
              return (
                <div key={bloc.cle} className="border border-line rounded-xl p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{bloc.label}</span>
                    <span className="text-xs text-ink-soft">Poids {bloc.poids}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      name={`valeur_${bloc.cle}`}
                      defaultValue={defaultValeur}
                      placeholder="0-100"
                      className={inputClass}
                    />
                    {suggestion !== undefined && saisie?.valeur === undefined && (
                      <span className="text-xs text-blue whitespace-nowrap">suggéré</span>
                    )}
                  </div>
                  <input
                    type="text"
                    name={`commentaire_${bloc.cle}`}
                    defaultValue={saisie?.commentaire ?? ""}
                    placeholder="Commentaire (optionnel)"
                    className={inputClass}
                  />
                </div>
              );
            })}
          </div>
          <div>
            <Btn type="submit">Enregistrer le score du mois</Btn>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="font-display font-bold text-sm mb-3">Historique mensuel</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                <th className="pb-2 pr-3">Mois</th>
                <th className="pb-2 pr-3">Score global</th>
              </tr>
            </thead>
            <tbody>
              {historique.map((h) => (
                <tr key={h.mois} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 font-semibold">
                    <a href={`/responsable/score-iso?mois=${h.mois}`} className="text-blue hover:underline">
                      {h.mois}
                    </a>
                  </td>
                  <td className={`py-2 pr-3 tabular font-bold ${TONE_TEXT[toneScore(h.score)]}`}>
                    {h.score}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {historique.length === 0 && (
            <p className="text-sm text-ink-soft py-3">
              Aucun historique pour l&apos;instant — enregistrez le premier score du mois ci-dessus.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
