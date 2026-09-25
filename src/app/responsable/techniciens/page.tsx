import { Card, Btn, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { habilitationsTechnicien, interventions, technicienFiches, users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { formatDate } from "@/lib/format";
import { createTechnicien } from "./actions";
import { getSitesForSelect } from "../actions";

const STATUT_RH_LABEL: Record<string, string> = {
  actif: "Actif",
  en_conge: "En congé",
  arret_maladie: "Arrêt maladie",
  en_formation: "En formation",
  suspendu: "Suspendu",
  sorti_effectifs: "Sorti des effectifs",
};
const STATUT_CLS: Record<string, string> = {
  actif: "bg-green-fill text-green-ink",
  en_conge: "bg-orange-fill text-orange-ink",
  arret_maladie: "bg-orange-fill text-orange-ink",
  en_formation: "bg-blue-pale text-blue",
  suspendu: "bg-red-fill text-red-ink",
  sorti_effectifs: "bg-[#eef2f6] text-ink-soft",
};

export default async function TechniciensPage({ searchParams }: { searchParams: Promise<{ vue?: string; q?: string; nouveau?: string; erreur?: string }> }) {
  const user = await requireUser(ROLES_BUREAU);
  const { vue = "actifs", q = "", nouveau, erreur } = await searchParams;
  const estAdmin = user.role === "administrateur";

  const [rows, sitesOptions] = await Promise.all([
    db
      .select({
        id: users.id,
        nom: users.nom,
        email: users.email,
        telephone: users.telephone,
        photoUrl: technicienFiches.photoUrl,
        statutRh: technicienFiches.statutRh,
        poste: technicienFiches.poste,
        specialites: technicienFiches.specialites,
        dateSortie: technicienFiches.dateSortie,
        motifSortie: technicienFiches.motifSortie,
        missionsActives: sql<number>`(select count(*)::int from ${interventions} where ${interventions.technicienId} = ${users.id} and ${interventions.statut} not in ('terminee','validee','cloturee'))`,
        missionsTotal: sql<number>`(select count(*)::int from ${interventions} where ${interventions.technicienId} = ${users.id})`,
        habExpirent: sql<number>`(select count(*)::int from ${habilitationsTechnicien} where ${habilitationsTechnicien.technicienId} = ${users.id} and ${habilitationsTechnicien.dateExpiration} between now() and now() + interval '30 days')`,
      })
      .from(users)
      .leftJoin(technicienFiches, eq(technicienFiches.technicienId, users.id))
      .where(eq(users.role, "technicien"))
      .orderBy(users.nom),
    estAdmin ? getSitesForSelect() : Promise.resolve([]),
  ]);

  const anciens = rows.filter((r) => r.statutRh === "sorti_effectifs");
  const actifs = rows.filter((r) => r.statutRh !== "sorti_effectifs");
  const qn = q.trim().toLowerCase();
  const liste = (vue === "anciens" ? anciens : actifs).filter(
    (r) => !qn || [r.nom, r.email, r.poste, r.specialites].filter(Boolean).join(" ").toLowerCase().includes(qn)
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-extrabold font-display text-[#0b2545]">Équipe technique</h1>
          <p className="text-sm text-ink-soft">{actifs.length} technicien(s) en poste · {anciens.length} ancien(s) — profils complets, historique conservé.</p>
        </div>
        {estAdmin && (
          <Link href="/responsable/techniciens?nouveau=1#nouveau" className="inline-flex items-center gap-2 rounded-xl bg-blue hover:bg-blue-light text-white px-5 py-3 text-sm font-bold shadow-sm">
            <Plus className="w-4 h-4" /> Nouveau technicien
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-xl bg-[#e9eef4] p-1">
          {[
            ["actifs", `Actifs (${actifs.length})`],
            ["anciens", `Anciens (${anciens.length})`],
          ].map(([id, label]) => (
            <Link
              key={id}
              href={`/responsable/techniciens?vue=${id}`}
              className={`rounded-lg px-4 py-2 text-[13.5px] font-semibold ${vue === id ? "bg-white text-navy shadow-sm" : "text-ink-soft"}`}
            >
              {label}
            </Link>
          ))}
        </div>
        <form className="flex items-center gap-2.5 rounded-xl border border-[#cfd8e3] bg-white px-3.5 py-2.5 w-full max-w-sm">
          <Search className="w-4 h-4 text-ink-soft" />
          <input type="hidden" name="vue" value={vue} />
          <input name="q" defaultValue={q} placeholder="Nom, poste, marque…" className="flex-1 bg-transparent text-[15px] focus:outline-none" />
        </form>
      </div>

      <div className={`grid grid-cols-1 ${estAdmin && nouveau ? "xl:grid-cols-[minmax(0,1fr)_380px]" : ""} gap-4 items-start`}>
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {liste.map((t) => {
            const ini = t.nom.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
            const st = t.statutRh ?? "actif";
            return (
              <Link
                key={t.id}
                href={`/responsable/techniciens/${t.id}`}
                className="group bg-white border border-line rounded-2xl p-5 flex flex-col gap-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-blue/50 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3.5">
                  {t.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.photoUrl} alt={t.nom} className={`w-12 h-12 rounded-2xl object-cover ${st === "sorti_effectifs" ? "grayscale" : ""}`} />
                  ) : (
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-display font-bold ${st === "sorti_effectifs" ? "bg-[#eef2f6] text-ink-soft" : "bg-navy text-white"}`}>{ini}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-display font-bold text-[16px] truncate group-hover:text-blue">{t.nom}</div>
                    <div className="text-[13px] text-ink-soft truncate">{t.poste || "Technicien"}</div>
                  </div>
                  <span className={`text-[11.5px] font-bold rounded-full px-2.5 py-1 shrink-0 ${STATUT_CLS[st] ?? ""}`}>{STATUT_RH_LABEL[st] ?? st}</span>
                </div>
                {t.specialites && (
                  <div className="flex gap-1.5 flex-wrap">
                    {t.specialites.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4).map((s) => (
                      <span key={s} className="text-[11.5px] font-semibold rounded-full px-2 py-0.5 bg-blue-pale text-blue">{s}</span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-4 text-[13px] text-ink-soft flex-wrap">
                  {st === "sorti_effectifs" ? (
                    <>
                      <span>{t.missionsTotal} mission(s) réalisée(s)</span>
                      <span>Sorti le {formatDate(t.dateSortie)}{t.motifSortie ? ` · ${t.motifSortie}` : ""}</span>
                    </>
                  ) : (
                    <>
                      <span>{t.missionsActives} mission(s) en cours</span>
                      {t.telephone && <span>{t.telephone}</span>}
                      {t.habExpirent > 0 && <span className="text-xs font-bold rounded-full px-2 py-0.5 bg-orange-fill text-orange-ink">{t.habExpirent} habilitation(s) à renouveler</span>}
                    </>
                  )}
                </div>
              </Link>
            );
          })}
          {liste.length === 0 && (
            <div className="col-span-full bg-white border border-dashed border-[#cfd8e3] rounded-2xl p-10 text-center text-ink-soft">
              {vue === "anciens" ? "Aucun ancien technicien." : "Aucun technicien trouvé."}
            </div>
          )}
        </div>
        {estAdmin && nouveau && (
          <Card className="p-5 h-fit" >
            <h2 className="font-display font-bold text-[15px] mb-3" id="nouveau">Nouveau technicien</h2>
            {erreur && <div role="alert" className="mb-3 rounded-xl bg-red-fill text-red-ink px-3 py-2.5 text-sm font-medium">{erreur}</div>}
            <form action={createTechnicien} className="flex flex-col gap-3">
              <Field label="Nom complet">
                <input name="nom" required className={inputClass} />
              </Field>
              <Field label="Email">
                <input type="email" name="email" required className={inputClass} />
              </Field>
              <Field label="Mot de passe initial">
                <input
                  type="password"
                  name="password"
                  required
                  minLength={8}
                  className={inputClass}
                  placeholder="8 caractères minimum"
                />
              </Field>
              <Field label="Téléphone">
                <input name="telephone" className={inputClass} />
              </Field>
              <Field label="Date de naissance">
                <input type="date" name="dateNaissance" className={inputClass} />
              </Field>
              <Field label="Contact d'urgence — nom">
                <input name="contactUrgenceNom" className={inputClass} />
              </Field>
              <Field label="Contact d'urgence — téléphone">
                <input name="contactUrgenceTelephone" className={inputClass} />
              </Field>
              <Field label="Site de rattachement (optionnel)">
                <select name="siteRattachementId" className={inputClass} defaultValue="">
                  <option value="">Aucun</option>
                  {sitesOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.raisonSociale} — {s.adresse}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date d'entrée dans l'entreprise">
                <input type="date" name="dateEntreeEntreprise" className={inputClass} />
              </Field>
              <Field label="Type de contrat">
                <input
                  name="typeContrat"
                  className={inputClass}
                  placeholder="CDI, CDD, intérimaire..."
                />
              </Field>
              <Field label="Adresse du domicile">
                <textarea name="adresseDomicile" rows={2} className={inputClass} />
              </Field>
              <Field label="Statut RH">
                <select name="statutRh" className={inputClass} defaultValue="actif">
                  {Object.entries(STATUT_RH_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Btn>Créer le technicien</Btn>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
