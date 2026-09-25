import { Card, Btn, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { auditeurs } from "@/db/schema";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { desc } from "drizzle-orm";
import { createAuditeur } from "./actions";

export default async function AuditeursPage() {
  await requireUser(ROLES_BUREAU);
  const rows = await db.select().from(auditeurs).orderBy(desc(auditeurs.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Auditeurs</h1>
        <p className="text-sm text-ink-soft">
          {rows.length} auditeur(s) enregistré(s) — fiches de contact (internes ou organismes de
          certification) à affecter à un Audit.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="pb-2 pr-3">Nom</th>
                  <th className="pb-2 pr-3">Organisme</th>
                  <th className="pb-2 pr-3">N° certification</th>
                  <th className="pb-2 pr-3">Spécialité</th>
                  <th className="pb-2 pr-3">Contact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3 font-semibold">{a.nom}</td>
                    <td className="py-2.5 pr-3 text-ink-soft">{a.organisme ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-ink-soft">{a.numeroCertification ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-ink-soft">{a.specialite ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-ink-soft">
                      {[a.telephone, a.email].filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun auditeur pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">Nouvel auditeur</h2>
          <form action={createAuditeur} className="flex flex-col gap-3">
            <Field label="Nom">
              <input name="nom" required className={inputClass} placeholder="Jean Dupont" />
            </Field>
            <Field label="Organisme / société de certification (optionnel)">
              <input
                name="organisme"
                className={inputClass}
                placeholder="AFNOR, Bureau Veritas, indépendant..."
              />
            </Field>
            <Field label="N° de certification / qualification (optionnel)">
              <input name="numeroCertification" className={inputClass} />
            </Field>
            <Field label="Spécialité / domaine (optionnel)">
              <input
                name="specialite"
                className={inputClass}
                placeholder="Audit qualité, sécurité, technique ascenseurs..."
              />
            </Field>
            <Field label="Téléphone (optionnel)">
              <input name="telephone" className={inputClass} />
            </Field>
            <Field label="Email (optionnel)">
              <input type="email" name="email" className={inputClass} />
            </Field>
            <Btn>Créer l&apos;auditeur</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
