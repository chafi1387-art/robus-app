"use client";

import { useId, useState } from "react";
import { Field, inputClass } from "@/components/ui";

/**
 * Phase 6 : évite la page d'erreur générique Next.js ("A server error
 * occurred") quand un fichier invalide est envoyé — la Server Action valide
 * toujours elle-même le fichier (défense en profondeur), mais l'utilisateur
 * voit ici un message clair avant même la soumission du formulaire.
 */
export function FileField({
  label,
  name,
  accept,
  maxBytes,
  required,
  multiple,
}: {
  label: string;
  name: string;
  accept: string;
  maxBytes: number;
  required?: boolean;
  multiple?: boolean;
}) {
  const id = useId();
  const [erreur, setErreur] = useState<string | null>(null);

  const typesAcceptes = accept.split(",").map((t) => t.trim());
  const maxMo = Math.round(maxBytes / (1024 * 1024));

  function validerFichiers(input: HTMLInputElement) {
    const fichiers = input.files ? Array.from(input.files) : [];
    for (const f of fichiers) {
      if (typesAcceptes.length > 0 && !typesAcceptes.includes(f.type)) {
        setErreur(`Format non supporté pour "${f.name}" — formats acceptés : ${accept}.`);
        input.value = "";
        return;
      }
      if (f.size > maxBytes) {
        setErreur(`"${f.name}" dépasse la taille maximale de ${maxMo} Mo.`);
        input.value = "";
        return;
      }
    }
    setErreur(null);
  }

  return (
    <Field label={label}>
      <input
        id={id}
        type="file"
        name={name}
        accept={accept}
        required={required}
        multiple={multiple}
        className={inputClass}
        onChange={(e) => validerFichiers(e.currentTarget)}
      />
      {erreur && <p className="text-xs text-red-ink mt-1">{erreur}</p>}
    </Field>
  );
}
