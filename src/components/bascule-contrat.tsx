"use client";

import { useEffect, useRef } from "react";

// Phase 24 : dans le formulaire « Ajouter une prestation » d'un projet,
// pré-remplit le prix et affiche les réglages du contrat (date de début,
// appareils couverts) seulement si la prestation choisie est un contrat.
// Composant client : fonctionne aussi après une navigation interne
// (un <script> inline ne s'exécute qu'au chargement complet de la page).
export function BasculeContrat() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    const select = form?.querySelector<HTMLSelectElement>('select[name="catalogueId"]');
    if (!form || !select) return;
    const appliquer = (prefillPrix: boolean) => {
      const opt = select.selectedOptions[0];
      const contrat = opt?.getAttribute("data-mode") === "contrat";
      form.querySelectorAll<HTMLElement>("[data-bloc-contrat]").forEach((el) => (el.hidden = !contrat));
      form.querySelectorAll<HTMLElement>("[data-hors-contrat]").forEach((el) => (el.hidden = contrat));
      const prix = opt?.getAttribute("data-prix");
      const champPrix = form.querySelector<HTMLInputElement>('[name="prixEstime"]');
      if (prefillPrix && prix && champPrix) champPrix.value = prix;
    };
    const onChange = () => appliquer(true);
    select.addEventListener("change", onChange);
    appliquer(false);
    return () => select.removeEventListener("change", onChange);
  }, []);
  return <span ref={ref} hidden />;
}
