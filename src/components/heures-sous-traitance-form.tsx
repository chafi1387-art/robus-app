import { Field, inputClass } from "@/components/ui";

type Props = {
  action: (formData: FormData) => Promise<void>;
  clients: { id: string; raisonSociale: string }[];
  retour: string;
  dateMin?: string;
  dateMax: string;
  submitLabel: string;
  valeurs?: { id: string; clientId: string; dateTravail: string; minutes: number; commentaire: string | null };
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Heures">
          <input
            type="number"
            name="heures"
            inputMode="numeric"
            min={0}
            max={24}
            step={1}
            required
            defaultValue={h}
            placeholder="ex. 3"
            className={inputClass}
          />
        </Field>
        <Field label="Minutes">
          <select name="minutes" className={inputClass} defaultValue={String(m)}>
            {[0, 15, 30, 45].map((v) => (
              <option key={v} value={v}>
                {String(v).padStart(2, "0")}
              </option>
            ))}
            {![0, 15, 30, 45].includes(m) && <option value={m}>{String(m).padStart(2, "0")}</option>}
          </select>
        </Field>
      </div>
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
      <button
        type="submit"
        className="bg-blue hover:bg-blue-light text-white font-display font-bold text-sm rounded-lg py-2.5"
      >
        {submitLabel}
      </button>
    </form>
  );
}

export const MESSAGES_ERREUR: Record<string, string> = {
  champs: "Merci de remplir le client et la date.",
  duree: "Durée invalide : entre 15 min et 24 h.",
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
