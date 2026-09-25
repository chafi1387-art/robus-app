import { Card, Pill, Btn, Field, inputClass } from "@/components/ui";
import { db } from "@/db";
import { pieces, mouvementsStock, interventions, users } from "@/db/schema";
import { desc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { createPiece, enregistrerMouvement } from "./actions";

async function getPieces() {
  return db.select().from(pieces).orderBy(pieces.nom);
}

async function getMouvementsRecents() {
  return db
    .select({
      id: mouvementsStock.id,
      type: mouvementsStock.type,
      quantite: mouvementsStock.quantite,
      commentaire: mouvementsStock.commentaire,
      createdAt: mouvementsStock.createdAt,
      pieceNom: pieces.nom,
      pieceReference: pieces.reference,
      effectueParNom: users.nom,
    })
    .from(mouvementsStock)
    .leftJoin(pieces, eq(mouvementsStock.pieceId, pieces.id))
    .leftJoin(users, eq(mouvementsStock.effectueParId, users.id))
    .orderBy(desc(mouvementsStock.createdAt))
    .limit(20);
}

async function getInterventionsRecentes() {
  return db
    .select({ id: interventions.id, description: interventions.description })
    .from(interventions)
    .where(ne(interventions.statut, "cloturee"))
    .orderBy(desc(interventions.createdAt))
    .limit(30);
}

export default async function StockPage() {
  await requireUser(ROLES_BUREAU);
  const [listePieces, mouvements, interventionsRecentes] = await Promise.all([
    getPieces(),
    getMouvementsRecents(),
    getInterventionsRecentes(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Stock &amp; traçabilité des pièces</h1>
        <p className="text-sm text-ink-soft">{listePieces.length} référence(s) en stock</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2 overflow-x-auto">
          <h2 className="font-display font-bold text-sm mb-3">Pièces en stock</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                <th className="py-2 pr-2">Référence</th>
                <th className="py-2 pr-2">Nom</th>
                <th className="py-2 pr-2">Marque</th>
                <th className="py-2 pr-2">Fournisseur</th>
                <th className="py-2 pr-2">Stock</th>
                <th className="py-2 pr-2">Seuil</th>
                <th className="py-2 pr-2">Unité</th>
                <th className="py-2 pr-2">Statut</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {listePieces.map((p) => {
                const stockBas = p.quantiteStock <= p.seuilAlerte;
                return (
                  <tr key={p.id} className="hover:bg-blue-pale/40">
                    <td className="py-2 pr-2 font-semibold">
                      <Link href={`/responsable/stock/pieces/${p.id}`} className="text-blue hover:underline">
                        {p.reference}
                      </Link>
                    </td>
                    <td className="py-2 pr-2">
                      <Link href={`/responsable/stock/pieces/${p.id}`}>{p.nom}</Link>
                    </td>
                    <td className="py-2 pr-2 text-ink-soft">{p.marque ?? "—"}</td>
                    <td className="py-2 pr-2 text-ink-soft">{p.fournisseur ?? "—"}</td>
                    <td className="py-2 pr-2 font-semibold">{p.quantiteStock}</td>
                    <td className="py-2 pr-2 text-ink-soft">{p.seuilAlerte}</td>
                    <td className="py-2 pr-2 text-ink-soft">{p.unite}</td>
                    <td className="py-2 pr-2">
                      <Pill tone={p.actif === 1 ? "ok" : "neutral"}>
                        {p.actif === 1 ? "Actif" : "Désactivé"}
                      </Pill>
                    </td>
                    <td className="py-2 pr-2">
                      {stockBas && <Pill tone="crit">Stock bas</Pill>}
                    </td>
                  </tr>
                );
              })}
              {listePieces.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-3 text-sm text-ink-soft">
                    Aucune pièce enregistrée pour l&apos;instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Nouvelle pièce</h2>
          <form action={createPiece} className="flex flex-col gap-3">
            <Field label="Référence">
              <input name="reference" required className={inputClass} placeholder="REF-001" />
            </Field>
            <Field label="Nom">
              <input name="nom" required className={inputClass} placeholder="Câble de traction" />
            </Field>
            <Field label="Marque (optionnel)">
              <input name="marque" className={inputClass} placeholder="Otis, Schindler..." />
            </Field>
            <Field label="Fournisseur (optionnel)">
              <input name="fournisseur" className={inputClass} placeholder="Nom du fournisseur" />
            </Field>
            <Field label="Référence fournisseur (optionnel)">
              <input name="referenceFournisseur" className={inputClass} placeholder="Réf. chez le fournisseur" />
            </Field>
            <Field label="Quantité initiale">
              <input
                type="number"
                name="quantiteStock"
                min={0}
                defaultValue={0}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Seuil d'alerte">
              <input
                type="number"
                name="seuilAlerte"
                min={0}
                defaultValue={0}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Unité">
              <input name="unite" defaultValue="unité" required className={inputClass} />
            </Field>
            <Btn>Créer la pièce</Btn>
          </form>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Mouvement de stock</h2>
          <form action={enregistrerMouvement} className="flex flex-col gap-3">
            <Field label="Pièce">
              <select name="pieceId" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Choisir une pièce
                </option>
                {listePieces
                  .filter((p) => p.actif === 1)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.reference} — {p.nom}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Type">
              <select name="type" className={inputClass} defaultValue="entree">
                <option value="entree">Entrée</option>
                <option value="sortie">Sortie</option>
              </select>
            </Field>
            <Field label="Quantité">
              <input type="number" name="quantite" min={1} defaultValue={1} required className={inputClass} />
            </Field>
            <Field label="Intervention liée (optionnel)">
              <select name="interventionId" className={inputClass} defaultValue="">
                <option value="">Aucune</option>
                {interventionsRecentes.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.description ? i.description.slice(0, 60) : i.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Commentaire (optionnel)">
              <input name="commentaire" className={inputClass} placeholder="Remarque..." />
            </Field>
            <Btn>Enregistrer le mouvement</Btn>
          </form>
        </Card>

        <Card className="p-5 lg:col-span-2 overflow-x-auto">
          <h2 className="font-display font-bold text-sm mb-3">Derniers mouvements</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                <th className="py-2 pr-2">Pièce</th>
                <th className="py-2 pr-2">Type</th>
                <th className="py-2 pr-2">Quantité</th>
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 pr-2">Qui</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {mouvements.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 pr-2">
                    <div className="font-semibold">{m.pieceNom ?? "—"}</div>
                    <div className="text-xs text-ink-soft">{m.pieceReference}</div>
                  </td>
                  <td className="py-2 pr-2">
                    <Pill tone={m.type === "entree" ? "ok" : "warn"}>
                      {m.type === "entree" ? "Entrée" : "Sortie"}
                    </Pill>
                  </td>
                  <td className="py-2 pr-2 font-semibold">{m.quantite}</td>
                  <td className="py-2 pr-2 text-ink-soft">
                    {m.createdAt.toLocaleDateString("fr-FR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-2 pr-2 text-ink-soft">{m.effectueParNom ?? "—"}</td>
                </tr>
              ))}
              {mouvements.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-sm text-ink-soft">
                    Aucun mouvement enregistré pour l&apos;instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
