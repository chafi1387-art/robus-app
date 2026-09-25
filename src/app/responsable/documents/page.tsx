import { Card, Pill, Btn, Field, inputClass } from "@/components/ui";
import { FileField } from "@/components/file-field";
import { db } from "@/db";
import { appareils, audits, documentsFormations, pieces, projets } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { createDocument } from "./actions";

const CATEGORIES = [
  "securite",
  "installation",
  "maintenance",
  "depannage",
  "marques",
  "procedures_robus",
  "videos",
  "fournisseur_iso",
] as const;
type Categorie = (typeof CATEGORIES)[number];

const CATEGORIE_LABEL: Record<Categorie, string> = {
  securite: "Sécurité",
  installation: "Installation",
  maintenance: "Maintenance",
  depannage: "Dépannage",
  marques: "Marques",
  procedures_robus: "Procédures Robus",
  videos: "Vidéos",
  fournisseur_iso: "Fournisseur / ISO 9001",
};

const LIEU_FORMATION_LABEL: Record<string, string> = {
  terrain: "Sur le terrain",
  bureau: "Au bureau",
  ecole: "École / centre de formation",
};

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ categorie?: string }>;
}) {
  await requireUser(ROLES_BUREAU);
  const { categorie } = await searchParams;

  const categorieValide =
    categorie && (CATEGORIES as readonly string[]).includes(categorie) ? (categorie as Categorie) : undefined;

  const [rows, appareilsOptions, projetsOptions, auditsOptions, piecesOptions] = await Promise.all([
    categorieValide
      ? db
          .select()
          .from(documentsFormations)
          .where(eq(documentsFormations.categorie, categorieValide))
          .orderBy(desc(documentsFormations.createdAt))
      : db.select().from(documentsFormations).orderBy(desc(documentsFormations.createdAt)),
    db
      .select({ id: appareils.id, numeroInterne: appareils.numeroInterne, marque: appareils.marque, modele: appareils.modele })
      .from(appareils)
      .orderBy(appareils.numeroInterne),
    db
      .select({ id: projets.id, reference: projets.reference, titre: projets.titre })
      .from(projets)
      .orderBy(projets.reference),
    db
      .select({ id: audits.id, titre: audits.titre })
      .from(audits)
      .orderBy(desc(audits.datePlanifiee)),
    db
      .select({ id: pieces.id, reference: pieces.reference, nom: pieces.nom })
      .from(pieces)
      .orderBy(pieces.nom),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold font-display">Documents &amp; Formations</h1>
        <p className="text-sm text-ink-soft">{rows.length} document(s) enregistré(s)</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href="/responsable/documents"
          className={`text-xs font-bold px-3 py-1.5 rounded-full border ${
            !categorie
              ? "bg-blue text-white border-blue"
              : "border-line text-ink-soft hover:bg-blue-pale"
          }`}
        >
          Toutes
        </a>
        {CATEGORIES.map((c) => (
          <a
            key={c}
            href={`/responsable/documents?categorie=${c}`}
            className={`text-xs font-bold px-3 py-1.5 rounded-full border ${
              categorie === c
                ? "bg-blue text-white border-blue"
                : "border-line text-ink-soft hover:bg-blue-pale"
            }`}
          >
            {CATEGORIE_LABEL[c]}
          </a>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                  <th className="pb-2 pr-3">Titre</th>
                  <th className="pb-2 pr-3">Catégorie</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Marque</th>
                  <th className="pb-2 pr-3">Formation</th>
                  <th className="pb-2 pr-3">Ajouté le</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3 font-semibold">
                      {d.urlFichier ? (
                        <a
                          href={d.urlFichier}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue hover:underline"
                        >
                          {d.titre}
                        </a>
                      ) : (
                        d.titre
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Pill tone="neutral">{CATEGORIE_LABEL[d.categorie] ?? d.categorie}</Pill>
                    </td>
                    <td className="py-2.5 pr-3 text-ink-soft capitalize">{d.typeContenu}</td>
                    <td className="py-2.5 pr-3 text-ink-soft">{d.marque ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      {d.estFormation === 1 ? (
                        <Pill tone="ok">
                          Formation{d.dureeValiditeMois ? ` · ${d.dureeValiditeMois} mois` : ""}
                          {d.lieuFormation ? ` · ${LIEU_FORMATION_LABEL[d.lieuFormation]}` : ""}
                        </Pill>
                      ) : (
                        <span className="text-ink-soft">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-ink-soft whitespace-nowrap">
                      {formatDate(d.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="text-sm text-ink-soft py-3">Aucun document pour l&apos;instant.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display font-bold text-sm mb-3">Nouveau document / formation</h2>
          <form action={createDocument} className="flex flex-col gap-3" encType="multipart/form-data">
            <Field label="Titre">
              <input name="titre" required className={inputClass} placeholder="Notice ascenseur X..." />
            </Field>
            <Field label="Catégorie">
              <select name="categorie" className={inputClass} defaultValue="maintenance">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIE_LABEL[c]}
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
            <Field label="URL du fichier / de la vidéo (lien externe)">
              <input
                name="urlFichier"
                className={inputClass}
                placeholder="https://..."
              />
            </Field>
            <FileField
              label="Ou déposer un fichier (PDF / MP4 / MOV / WEBM / AVI, 200 Mo max)"
              name="fichier"
              accept="application/pdf,video/mp4,video/quicktime,video/webm,video/x-msvideo"
              maxBytes={200 * 1024 * 1024}
            />
            <Field label="Appareil concerné (optionnel)">
              <select name="appareilId" className={inputClass} defaultValue="">
                <option value="">Aucun</option>
                {appareilsOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.numeroInterne}
                    {[a.marque, a.modele].filter(Boolean).length
                      ? ` — ${[a.marque, a.modele].filter(Boolean).join(" ")}`
                      : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Projet concerné (optionnel)">
              <select name="projetId" className={inputClass} defaultValue="">
                <option value="">Aucun</option>
                {projetsOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.reference} — {p.titre}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Audit concerné (optionnel)">
              <select name="auditId" className={inputClass} defaultValue="">
                <option value="">Aucun</option>
                {auditsOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.titre}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Pièce concernée (optionnel)">
              <select name="pieceId" className={inputClass} defaultValue="">
                <option value="">Aucune</option>
                {piecesOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.reference} — {p.nom}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Marque (optionnel)">
              <input name="marque" className={inputClass} placeholder="Otis, Schindler..." />
            </Field>
            <Field label="Type d'appareil concerné (optionnel)">
              <input name="typeAppareilConcerne" className={inputClass} placeholder="Traction, hydraulique..." />
            </Field>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="estFormation" className="rounded border-line" />
              Formation certifiante (donne lieu à une habilitation)
            </label>
            <Field label="Durée de validité (mois) — si formation certifiante">
              <input
                type="number"
                min={1}
                name="dureeValiditeMois"
                className={inputClass}
                placeholder="Ex : 24"
              />
            </Field>
            <Field label="Lieu de la formation — si formation certifiante">
              <select name="lieuFormation" className={inputClass} defaultValue="">
                <option value="">Non précisé</option>
                <option value="terrain">Sur le terrain</option>
                <option value="bureau">Au bureau</option>
                <option value="ecole">École / centre de formation</option>
              </select>
            </Field>
            <Btn>Ajouter</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}
