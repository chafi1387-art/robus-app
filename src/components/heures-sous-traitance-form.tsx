import { Field, inputClass } from "@/components/ui";
import { PAUSES_MINUTES } from "@/lib/sous-traitance";
import { BoutonEnvoi } from "@/components/bouton-envoi";

type Props = {
  action: (formData: FormData) => Promise<void>;
  clients: { id: string; raisonSociale: string }[];
  retour: string;
  dateMin?: string;
  dateMax: string;
  submitLabel: string;
  valeurs?: { id: string; clientId: string; dateTravail: string; minutes: number; commentaire: string | null; heureDebut?: string | null; heureFin?: string | null; pauseMinutes?: number | null };
};

export function HeuresSousTraitanceForm({ action, clients, retour, dateMin, dateMax, submitLabel, valeurs }: Props) {
  const h = valeurs ? Math.floor(valeurs.minutes / 60) : undefined;
  const m = valeurs ? valeurs.minutes % 60 : 0;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="retour" value={retour} />
      {valeurs && <input type="hidden" name="id" value={valeurs.id} />}
      <Field label="Client (sous-traitance)">
        <select name="clientId" required className={inputClass} defaultValue={valeurs?.clientId ?? ""}>
          <option value="" disabled>
            Choisir un client…
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.raisonSociale}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Date du travail">
        <input
          type="date"
          name="dateTravail"
          required
          min={dateMin}
          max={dateMax}
          defaultValue={valeurs?.dateTravail ?? dateMax}
          className={inputClass}
        />
      </Field>
      {/* Phase 21 : heure de début et de fin — la durée est calculée (moins la pause). */}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Début">
          <input type="time" name="heureDebut" required step={300} defaultValue={valeurs?.heureDebut ?? ""} className={inputClass} />
        </Field>
        <Field label="Fin">
          <input type="time" name="heureFin" required step={300} defaultValue={valeurs?.heureFin ?? ""} className={inputClass} />
        </Field>
        <Field label="Pause">
          <select name="pauseMinutes" className={inputClass} defaultValue={String(valeurs?.pauseMinutes ?? 0)}>
            {PAUSES_MINUTES.map((v) => (
              <option key={v} value={v}>
                {v === 0 ? "Aucune" : `${v} min`}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {valeurs && !valeurs.heureDebut && (
        <p className="text-xs text-ink-soft -mt-1">Ancienne saisie ({Math.floor(valeurs.minutes / 60)} h {String(valeurs.minutes % 60).padStart(2, "0")}) : indiquez le début et la fin pour la corriger.</p>
      )}
      <Field label="Commentaire (facultatif)">
        <textarea
          name="commentaire"
          rows={2}
          maxLength={500}
          defaultValue={valeurs?.commentaire ?? ""}
          placeholder="Travail réalisé, remarque…"
          className={inputClass}
        />
      </Field>
      <BoutonEnvoi
        type="submit"
        className="bg-blue hover:bg-blue-light text-white font-display font-bold text-sm rounded-lg py-2.5"
      >
        {submitLabel}
      </BoutonEnvoi>
    </form>
  );
}

export const MESSAGES_ERREUR: Record<string, string> = {
  champs: "Merci de remplir le client et la date.",
  duree: "Durée invalide : entre 15 min et 14 h (pause déduite).",
  horaire: "Horaire invalide : l'heure de fin doit être après l'heure de début (même jour).",
  chevauchement: "Ces horaires chevauchent une autre saisie le même jour.",
  date: "Date non autorisée (pas de date future, ni plus d'un mois en arrière).",
  client: "Ce client n'est pas un client de sous-traitance.",
  introuvable: "Saisie introuvable.",
  droits: "Vous ne pouvez pas modifier cette saisie.",
  verrou: "Saisie verrouillée : la correction n'est possible que 24 h après l'envoi. Contactez le bureau.",
};

export const MESSAGES_OK: Record<string, string> = {
  "1": "Heures enregistrées.",
  "2": "Saisie corrigée.",
  "3": "Saisie supprimée.",
};
