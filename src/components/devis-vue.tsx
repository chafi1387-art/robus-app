import { FileText } from "lucide-react";
import { montant, type DevisComplet } from "@/lib/devis";
import { formatDate } from "@/lib/format";

// Phase 25b : le devis tel que le voit le client (espace observateur, lien
// email) — avec ou sans les prix selon le choix du bureau pour ce destinataire.
export function DevisVue({ dv, prixVisible, lienDocument }: { dv: DevisComplet; prixVisible: boolean; lienDocument?: string }) {
  const d = dv.d;
  const validiteFin = d.dateEnvoi ? new Date(d.dateEnvoi.getTime() + d.validiteJours * 86400000) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Devis {d.numero}</div>
          <h1 className="font-display font-extrabold text-[22px] text-navy leading-tight">{d.titre ?? "Devis"}</h1>
          <div className="text-sm text-ink-soft mt-0.5">
            {[dv.client, dv.numeroAppareil ? `Ascenseur ${dv.numeroAppareil}` : null, dv.adresse].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="text-right text-xs text-ink-soft">
          {d.dateEnvoi && <div>Émis le {formatDate(d.dateEnvoi)}</div>}
          {validiteFin && <div>Valable jusqu&apos;au {formatDate(validiteFin)}</div>}
        </div>
      </div>

      {d.message && <p className="text-sm whitespace-pre-wrap bg-blue-pale/50 rounded-xl px-3.5 py-2.5">{d.message}</p>}

      {d.mode === "lignes" ? (
        <div className="rounded-xl border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-3 py-2">Désignation</th>
                <th className="px-3 py-2 text-right w-16">Qté</th>
                {prixVisible && <th className="px-3 py-2 text-right w-28">P.U. HT</th>}
                {prixVisible && <th className="px-3 py-2 text-right w-28">Total HT</th>}
              </tr>
            </thead>
            <tbody>
              {dv.lignes.map((l) => (
                <tr key={l.id} className="border-t border-line align-top">
                  <td className="px-3 py-2 whitespace-pre-wrap">{l.designation}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.quantite).toLocaleString("fr-BE")}</td>
                  {prixVisible && <td className="px-3 py-2 text-right tabular-nums">{l.prixUnitaireHt !== null ? montant(Number(l.prixUnitaireHt)).replace(" HT", "") : "—"}</td>}
                  {prixVisible && (
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {l.prixUnitaireHt !== null ? montant(Number(l.quantite) * Number(l.prixUnitaireHt)).replace(" HT", "") : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : prixVisible && d.documentUrl ? (
        <a href={lienDocument ?? d.documentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 hover:bg-blue-pale/40">
          <FileText className="w-6 h-6 text-blue shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block font-semibold truncate">{d.documentNom ?? "Devis détaillé"}</span>
            <span className="block text-xs text-ink-soft">Ouvrir le devis détaillé</span>
          </span>
        </a>
      ) : (
        <p className="text-sm text-ink-soft">Le détail chiffré de ce devis est transmis au responsable du contrat.</p>
      )}

      {prixVisible && dv.montantHt !== null && (
        <div className="flex items-center justify-end gap-3 rounded-xl bg-navy text-white px-4 py-3">
          <span className="text-sm">Total</span>
          <span className="font-display font-extrabold text-xl tabular-nums">{montant(dv.montantHt)}</span>
        </div>
      )}
      {prixVisible && <p className="text-[11px] text-ink-soft text-right -mt-2">Montants hors taxes.</p>}
    </div>
  );
}
