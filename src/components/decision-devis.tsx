import { CheckCircle2, Printer, XCircle } from "lucide-react";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { BoutonImprimer } from "@/components/bouton-imprimer";
import { formatDateTime } from "@/lib/format";
import type { DevisComplet } from "@/lib/devis";

// Phase 25b : bloc « Accepter / Refuser » du devis (lien email ou espace observateur).
export function DecisionDevis({
  dv,
  peutDecider,
  nomParDefaut,
  expire,
  action,
  champs,
  erreur,
  reponse,
}: {
  dv: DevisComplet;
  peutDecider: boolean;
  nomParDefaut: string;
  expire: boolean;
  action: (fd: FormData) => Promise<void>;
  champs: Record<string, string>;
  erreur?: string;
  reponse?: string;
}) {
  const d = dv.d;
  const champ = "w-full rounded-xl border border-line px-3 py-2.5 text-[15px] bg-surface";
  const cachés = Object.entries(champs).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);

  if (d.statut === "accepte" || d.statut === "realise") {
    return (
      <div className="rounded-2xl bg-green-fill text-green-ink px-4 py-4 flex items-start gap-3">
        <CheckCircle2 className="w-6 h-6 shrink-0" />
        <div>
          <div className="font-display font-bold">{reponse === "accepte" ? "Merci, votre accord est bien enregistré." : "Devis accepté"}</div>
          <div className="text-sm">
            {d.decideParNom ? `Par ${d.decideParNom}` : ""}
            {d.decideLe ? ` le ${formatDateTime(d.decideLe)}` : ""}.{" "}
            {d.statut === "realise" ? "Les travaux sont réalisés." : d.travauxPlanifiesLe ? "Les travaux sont planifiés — vous serez prévenu de l'intervention." : "ROBUS planifie les travaux et vous prévient."}
          </div>
        </div>
      </div>
    );
  }
  if (d.statut === "refuse") {
    return (
      <div className="rounded-2xl bg-red-fill text-red-ink px-4 py-4 flex items-start gap-3">
        <XCircle className="w-6 h-6 shrink-0" />
        <div>
          <div className="font-display font-bold">{reponse === "refuse" ? "Votre réponse est enregistrée." : "Devis refusé"}</div>
          <div className="text-sm">
            {d.decideParNom ? `Par ${d.decideParNom}` : ""}
            {d.decideLe ? ` le ${formatDateTime(d.decideLe)}` : ""}. ROBUS est prévenu.
          </div>
        </div>
      </div>
    );
  }
  if (!peutDecider) {
    return <p className="rounded-2xl bg-blue-pale/60 px-4 py-3 text-sm">Ce devis vous est transmis pour information. La décision appartient au responsable du contrat.</p>;
  }
  if (expire) {
    return <p className="rounded-2xl bg-orange-fill text-orange-ink px-4 py-3 text-sm font-semibold">Ce devis n&apos;est plus valable. Contactez ROBUS pour en recevoir une version à jour.</p>;
  }
  return (
    <div className="bg-surface border border-line rounded-2xl p-5 flex flex-col gap-4 print:hidden" id="reponse">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display font-bold text-[17px] text-navy">Votre réponse</h2>
        <BoutonImprimer libelle="Imprimer / PDF" icone={<Printer className="w-4 h-4" />} />
      </div>
      {erreur && <div className="text-sm bg-red-fill text-red-ink rounded-lg px-3 py-2">{erreur}</div>}
      <form action={action} className="flex flex-col gap-3">
        {cachés}
        <input type="hidden" name="decision" value="accepte" />
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">Votre nom</span>
          <input name="nom" required minLength={2} defaultValue={nomParDefaut} className={champ} autoComplete="name" />
        </label>
        <label className="flex items-start gap-2.5 text-[15px]">
          <input type="checkbox" name="bonPourAccord" required className="w-5 h-5 mt-0.5" />
          <span>
            <strong>Bon pour accord</strong> — j&apos;accepte le devis {d.numero} et autorise ROBUS à réaliser les travaux.
          </span>
        </label>
        <BoutonEnvoi className="bg-green text-white font-display font-bold rounded-xl py-3.5 text-[16px]" enCours="Enregistrement…">
          J&apos;accepte le devis
        </BoutonEnvoi>
      </form>
      <details className="border-t border-line pt-3">
        <summary className="text-sm font-semibold text-red-ink cursor-pointer select-none">Je refuse ce devis</summary>
        <form action={action} className="flex flex-col gap-3 mt-3">
          {cachés}
          <input type="hidden" name="decision" value="refuse" />
          <input name="nom" required minLength={2} defaultValue={nomParDefaut} placeholder="Votre nom" className={champ} />
          <textarea name="motif" rows={2} maxLength={2000} placeholder="Motif (facultatif) — ex. trop cher, travaux reportés…" className={champ} />
          <BoutonEnvoi className="border-[1.5px] border-red-ink text-red-ink font-display font-bold rounded-xl py-3" enCours="Enregistrement…">
            Envoyer mon refus
          </BoutonEnvoi>
        </form>
      </details>
    </div>
  );
}
