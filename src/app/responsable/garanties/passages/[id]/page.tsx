import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { Btn, Card, Field, Pill, inputClass } from "@/components/ui";
import { formatDate, formatDateTime, toDatetimeLocalValue } from "@/lib/format";
import { ETAT_PASSAGE, passagesDuMemeEchancier } from "@/lib/garantie-passages";
import { FrisePassages } from "@/components/frise-passages";
import { decalerPassage, planifierPassage } from "../../actions";

export default async function PassagePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(ROLES_BUREAU);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [tous, techs] = await Promise.all([
    passagesDuMemeEchancier(id),
    db.select({ id: users.id, nom: users.nom }).from(users).where(and(eq(users.role, "technicien"), eq(users.actif, 1))).orderBy(asc(users.nom)),
  ]);
  const p = tous.find((x) => x.id === id);
  if (!p) notFound();
  const e = ETAT_PASSAGE[p.etat];
  const gestion = user.role === "administrateur" || user.role === "responsable_qualite";

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/responsable/projets/${p.projetId}?tab=garantie`} className="text-xs text-blue font-semibold">&larr; Projet {p.projetRef}</Link>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold font-display">
            {p.garantieId ? "Passage de garantie" : `${p.libelle} — passage`} {p.numero}/{p.total}
          </h1>
          <p className="text-sm text-ink-soft">{p.client} · Ascenseur {p.numeroAppareil} · prévu vers le {formatDate(p.datePrevue)} (± 15 jours)</p>
          {p.motifDecalage && <p className="text-xs text-ink-soft mt-1">Décalé (initialement le {formatDate(p.dateInitiale)}) — {p.motifDecalage}</p>}
        </div>
        <Pill tone={e.tone}>{e.label}</Pill>
      </div>

      <Card className="p-5">
        <FrisePassages passages={tous.filter((x) => x.appareilId === p.appareilId)} />
      </Card>

      {p.interventionId && (
        <Card className="p-4 text-sm flex items-center justify-between gap-3 flex-wrap">
          <span>
            Mission : {p.mDate ? formatDateTime(p.mDate) : "date à définir"} · {p.technicien ?? "à affecter"}
          </span>
          <Link href={`/responsable/missions/${p.interventionId}`} className="font-bold text-blue">Voir la mission →</Link>
        </Card>
      )}

      {p.etat !== "realise" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Planifier ce passage</h2>
            <form action={planifierPassage} className="flex flex-col gap-3">
              <input type="hidden" name="passageId" value={p.id} />
              <Field label="Technicien">
                <select name="technicienId" required defaultValue={p.mTechnicienId ?? ""} className={inputClass}>
                  <option value="" disabled>Choisir…</option>
                  {techs.map((t) => (
                    <option key={t.id} value={t.id}>{t.nom}</option>
                  ))}
                </select>
              </Field>
              <Field label="Date et heure">
                <input type="datetime-local" name="dateProgrammee" required defaultValue={toDatetimeLocalValue(p.mDate ?? p.datePrevue)} className={inputClass} />
              </Field>
              <Btn className="self-start">Planifier et envoyer au technicien</Btn>
              <p className="text-xs text-ink-soft">Habilitations contrôlées ; la mission part avec le suivi Envoyée → Vue → Acceptée.</p>
            </form>
          </Card>
          {gestion && (
            <Card className="p-5">
              <h2 className="font-display font-bold text-sm mb-3">Décaler la date prévue</h2>
              <form action={decalerPassage} className="flex flex-col gap-3">
                <input type="hidden" name="passageId" value={p.id} />
                <Field label="Nouvelle date prévue">
                  <input type="date" name="datePrevue" required defaultValue={p.datePrevue.toISOString().slice(0, 10)} className={inputClass} />
                </Field>
                <Field label="Motif (obligatoire)">
                  <input name="motif" required className={inputClass} placeholder="Ex. demande du syndic, accès impossible…" />
                </Field>
                <Btn variant="ghost" className="self-start">Décaler</Btn>
              </form>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
