import { Card, Btn, Field, Pill, inputClass } from "@/components/ui";
import { FileField } from "@/components/file-field";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { db } from "@/db";
import { documentsFormations, mouvementsStock, pieces, users } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/format";
import { deletePiece, toggleActifPiece, updatePiece, uploadPiecePhoto } from "../../actions";
import { createDocument } from "../../../documents/actions";

const CATEGORIE_DOC_LABEL: Record<string, string> = {
  securite: "Sécurité",
  installation: "Installation",
  maintenance: "Maintenance",
  depannage: "Dépannage",
  marques: "Marques",
  procedures_robus: "Procédures Robus",
  videos: "Vidéos",
  fournisseur_iso: "Fournisseur / ISO 9001",
};
const CATEGORIES_DOC = [
  "securite",
  "installation",
  "maintenance",
  "depannage",
  "marques",
  "procedures_robus",
  "videos",
  "fournisseur_iso",
] as const;

export default async function PieceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [piece] = await db.select().from(pieces).where(eq(pieces.id, id)).limit(1);
  if (!piece) notFound();

  const [documents, mouvements] = await Promise.all([
    db
      .select()
      .from(documentsFormations)
      .where(eq(documentsFormations.pieceId, id))
      .orderBy(desc(documentsFormations.createdAt)),
    db
      .select({
        id: mouvementsStock.id,
        type: mouvementsStock.type,
        quantite: mouvementsStock.quantite,
        commentaire: mouvementsStock.commentaire,
        createdAt: mouvementsStock.createdAt,
        effectueParNom: users.nom,
      })
      .from(mouvementsStock)
      .leftJoin(users, eq(mouvementsStock.effectueParId, users.id))
      .where(eq(mouvementsStock.pieceId, id))
      .orderBy(desc(mouvementsStock.createdAt)),
  ]);

  const stockBas = piece.quantiteStock <= piece.seuilAlerte;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/responsable/stock" className="text-xs text-blue font-semibold">
          ← Retour au stock
        </Link>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h1 className="text-2xl font-extrabold font-display">{piece.nom}</h1>
          <Pill tone={piece.actif === 1 ? "ok" : "neutral"}>
            {piece.actif === 1 ? "Actif" : "Désactivé"}
          </Pill>
          {stockBas && <Pill tone="crit">Stock bas</Pill>}
        </div>
        <p className="text-sm text-ink-soft">
          {piece.reference}
          {piece.marque ? ` · ${piece.marque}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {piece.photoUrl && (
            <Card className="p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={piece.photoUrl}
                alt={`Photo de la pièce ${piece.nom}`}
                className="w-full max-h-96 object-contain rounded-xl bg-blue-pale"
              />
            </Card>
          )}

          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Fiche pièce</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4">
              <InfoRow label="Stock actuel" value={`${piece.quantiteStock} ${piece.unite}`} />
              <InfoRow label="Seuil d'alerte" value={`${piece.seuilAlerte} ${piece.unite}`} />
              <InfoRow label="Fournisseur" value={piece.fournisseur} />
              <InfoRow label="Référence fournisseur" value={piece.referenceFournisseur} />
            </dl>
            <p className="text-xs text-ink-soft mb-3">
              La quantité en stock ne se modifie que via un « Mouvement de stock » (entrée/sortie),
              depuis la page Stock — pour garder la traçabilité des mouvements.
            </p>
            <h3 className="font-display font-bold text-sm mb-2 pt-3 border-t border-line">
              Modifier la fiche
            </h3>
            <form action={updatePiece} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={piece.id} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Référence">
                  <input name="reference" required defaultValue={piece.reference} className={inputClass} />
                </Field>
                <Field label="Nom">
                  <input name="nom" required defaultValue={piece.nom} className={inputClass} />
                </Field>
                <Field label="Marque">
                  <input name="marque" defaultValue={piece.marque ?? ""} className={inputClass} />
                </Field>
                <Field label="Unité">
                  <input name="unite" required defaultValue={piece.unite} className={inputClass} />
                </Field>
                <Field label="Fournisseur">
                  <input name="fournisseur" defaultValue={piece.fournisseur ?? ""} className={inputClass} />
                </Field>
                <Field label="Référence fournisseur">
                  <input
                    name="referenceFournisseur"
                    defaultValue={piece.referenceFournisseur ?? ""}
                    className={inputClass}
                  />
                </Field>
                <Field label="Seuil d'alerte">
                  <input
                    type="number"
                    name="seuilAlerte"
                    min={0}
                    required
                    defaultValue={piece.seuilAlerte}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Btn className="self-start">Enregistrer les modifications</Btn>
            </form>
          </Card>

          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">Photo de la pièce</h2>
            <form action={uploadPiecePhoto} className="flex flex-col gap-3" encType="multipart/form-data">
              <input type="hidden" name="pieceId" value={piece.id} />
              <FileField
                label="Choisir une photo (JPEG / PNG / WEBP, 8 Mo max)"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                maxBytes={8 * 1024 * 1024}
                required
              />
              <Btn variant="ghost" className="self-start">
                {piece.photoUrl ? "Remplacer la photo" : "Ajouter la photo"}
              </Btn>
            </form>
          </Card>

          <Card className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">
              Documents liés ({documents.length})
            </h2>
            <div className="flex flex-col divide-y divide-line mb-3">
              {documents.map((d) => (
                <div key={d.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Pill tone="neutral">{CATEGORIE_DOC_LABEL[d.categorie] ?? d.categorie}</Pill>
                      {d.urlFichier ? (
                        <a
                          href={d.urlFichier}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-blue font-semibold hover:underline truncate"
                        >
                          {d.titre}
                        </a>
                      ) : (
                        <span className="text-sm truncate">{d.titre}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-ink-soft whitespace-nowrap">{formatDate(d.createdAt)}</span>
                </div>
              ))}
              {documents.length === 0 && (
                <p className="text-sm text-ink-soft py-2">
                  Aucun document rattaché à cette pièce pour l&apos;instant — utile par exemple pour un
                  certificat fournisseur ISO 9001.
                </p>
              )}
            </div>
            <details>
              <summary className="text-xs font-bold text-blue cursor-pointer select-none">
                + Ajouter un document à cette pièce
              </summary>
              <form
                action={createDocument}
                encType="multipart/form-data"
                className="flex flex-col gap-2 mt-2 max-w-md"
              >
                <input type="hidden" name="pieceId" value={piece.id} />
                <input type="hidden" name="redirectTo" value={`/responsable/stock/pieces/${piece.id}`} />
                <Field label="Titre">
                  <input
                    name="titre"
                    required
                    className={inputClass}
                    placeholder="Certificat fournisseur, fiche technique..."
                  />
                </Field>
                <Field label="Catégorie">
                  <select name="categorie" className={inputClass} defaultValue="fournisseur_iso">
                    {CATEGORIES_DOC.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORIE_DOC_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Type de contenu">
                  <select name="typeContenu" className={inputClass} defaultValue="document">
                    <option value="document">Document (PDF / notice)</option>
                    <option value="video">Vidéo</option>
                  </select>
                </Field>
                <p className="text-xs text-ink-soft -mt-1">
                  Soit un lien externe, soit un fichier uploadé — au choix (un seul suffit).
                </p>
                <Field label="URL du fichier (lien externe)">
                  <input name="urlFichier" className={inputClass} placeholder="https://..." />
                </Field>
                <FileField
                  label="Ou déposer un fichier (PDF / MP4 / MOV / WEBM / AVI, 200 Mo max)"
                  name="fichier"
                  accept="application/pdf,video/mp4,video/quicktime,video/webm,video/x-msvideo"
                  maxBytes={200 * 1024 * 1024}
                />
                <Btn className="self-start">Ajouter</Btn>
              </form>
            </details>
          </Card>

          <Card className="p-5 border-red/30">
            <h2 className="font-display font-bold text-sm mb-3 text-red-ink">Zone sensible</h2>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-ink-soft max-w-sm">
                  {piece.actif === 1
                    ? "Désactiver une pièce la retire des listes de mouvement de stock, sans supprimer son historique."
                    : "Cette pièce est désactivée — elle n'apparaît plus dans les mouvements de stock."}
                </p>
                <form action={toggleActifPiece}>
                  <input type="hidden" name="id" value={piece.id} />
                  <Btn type="submit" variant="ghost" className="!px-3 !py-1.5 !text-xs">
                    {piece.actif === 1 ? "Désactiver" : "Réactiver"}
                  </Btn>
                </form>
              </div>

              <div className="pt-3 border-t border-line flex items-center justify-between gap-3 flex-wrap">
                {mouvements.length > 0 ? (
                  <p className="text-xs text-ink-soft max-w-sm">
                    Suppression impossible : cette pièce a {mouvements.length} mouvement(s) de stock
                    enregistré(s). Désactivez-la plutôt pour garder l&apos;historique.
                  </p>
                ) : (
                  <p className="text-xs text-ink-soft max-w-sm">
                    Cette pièce n&apos;a aucun mouvement de stock — elle peut être supprimée
                    définitivement.
                  </p>
                )}
                <form action={deletePiece}>
                  <input type="hidden" name="id" value={piece.id} />
                  <ConfirmSubmitButton
                    disabled={mouvements.length > 0}
                    confirmMessage={`Supprimer définitivement la pièce "${piece.nom}" ? Cette action est irréversible.`}
                    className="!px-3 !py-1.5 !text-xs inline-flex items-center gap-2 rounded-lg font-bold font-display border border-red/40 text-red-ink hover:bg-red/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Supprimer définitivement
                  </ConfirmSubmitButton>
                </form>
              </div>
            </div>
          </Card>
        </div>

        <Card className="p-5 h-fit">
          <h2 className="font-display font-bold text-sm mb-3">
            Historique des mouvements ({mouvements.length})
          </h2>
          <div className="flex flex-col divide-y divide-line">
            {mouvements.map((m) => (
              <div key={m.id} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Pill tone={m.type === "entree" ? "ok" : "warn"}>
                    {m.type === "entree" ? "Entrée" : "Sortie"}
                  </Pill>
                  <span className="font-semibold text-sm">{m.quantite}</span>
                </div>
                <div className="text-xs text-ink-soft mt-1">{formatDateTime(m.createdAt)}</div>
                {m.effectueParNom && (
                  <div className="text-xs text-ink-soft">{m.effectueParNom}</div>
                )}
                {m.commentaire && <div className="text-xs mt-0.5">{m.commentaire}</div>}
              </div>
            ))}
            {mouvements.length === 0 && (
              <p className="text-sm text-ink-soft py-2">Aucun mouvement pour l&apos;instant.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}
