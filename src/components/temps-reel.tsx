"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { actualiserEcran } from "@/app/temps-reel/actions";

// ==========================================================================
// Phase 25 — Temps réel (un seul flux par onglet, monté dans chaque espace).
// À chaque signal du serveur, la page se met à jour d'elle-même — sauf
// pendant une saisie (on attend que le champ soit quitté). Au retour sur
// l'application (téléphone réveillé, onglet réaffiché) : mise à jour aussi.
// Si le flux est coupé trop longtemps : rechargement toutes les 30 s.
// ==========================================================================

type EtatDirect = { connecte: boolean; derniere: number | null };
const ETAT_INITIAL: EtatDirect = { connecte: false, derniere: null };
let etatDirect: EtatDirect = ETAT_INITIAL;
const ecouteurs = new Set<() => void>();
function publier(e: Partial<EtatDirect>) {
  etatDirect = { ...etatDirect, ...e };
  ecouteurs.forEach((f) => f());
}
export function useEtatDirect() {
  return useSyncExternalStore(
    (f) => {
      ecouteurs.add(f);
      return () => ecouteurs.delete(f);
    },
    () => etatDirect,
    // Hydratation : toujours l'état initial (comme le rendu serveur).
    () => ETAT_INITIAL
  );
}

function enSaisie() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") {
    const t = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "file", "hidden", "range"].includes(t);
  }
  return false;
}

export function TempsReel() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // Après chaque navigation, la page affichée est fraîche.
  useEffect(() => {
    publier({ derniere: Date.now() });
  }, [pathname, sp]);

  useEffect(() => {
    let es: EventSource | null = null;
    let minuterie: ReturnType<typeof setTimeout> | null = null;
    let enAttenteSaisie = false;
    let derniereMaj = 0;
    let secours: ReturnType<typeof setInterval> | null = null;
    let coupureDepuis: number | null = null;
    let cache = false;
    let fini = false;

    const maj = async () => {
      minuterie = null;
      if (document.visibilityState !== "visible") {
        cache = true;
        return;
      }
      if (enSaisie()) {
        enAttenteSaisie = true;
        return;
      }
      derniereMaj = Date.now();
      try {
        await actualiserEcran();
      } catch {
        router.refresh();
      }
      publier({ derniere: Date.now() });
    };
    // Regroupe les signaux rapprochés (ex. 10 photos envoyées d'affilée).
    const planifier = (delai = 350) => {
      if (minuterie) return;
      const attente = Math.max(delai, 1200 - (Date.now() - derniereMaj));
      minuterie = setTimeout(maj, attente);
    };
    const finSaisie = () => {
      if (!enAttenteSaisie) return;
      setTimeout(() => {
        if (!enSaisie() && enAttenteSaisie) {
          enAttenteSaisie = false;
          planifier(150);
        }
      }, 300);
    };
    const visible = () => {
      if (document.visibilityState !== "visible") return;
      if (cache || Date.now() - derniereMaj > 20000) {
        cache = false;
        planifier(50);
      }
      if (!es || es.readyState === EventSource.CLOSED) ouvrir();
    };

    const demarrerSecours = () => {
      if (secours) return;
      secours = setInterval(() => planifier(0), 30000);
    };
    const arreterSecours = () => {
      if (secours) clearInterval(secours);
      secours = null;
    };

    function ouvrir() {
      if (fini) return;
      es?.close();
      es = new EventSource("/api/temps-reel");
      es.addEventListener("pret", () => {
        const reprise = coupureDepuis !== null;
        coupureDepuis = null;
        arreterSecours();
        publier({ connecte: true });
        if (reprise) planifier(0); // des changements ont pu être manqués
      });
      es.onmessage = () => planifier();
      es.onerror = () => {
        publier({ connecte: false });
        if (coupureDepuis === null) coupureDepuis = Date.now();
        // Le navigateur se reconnecte seul ; au-delà de 20 s → rechargement régulier.
        setTimeout(() => {
          if (coupureDepuis !== null && Date.now() - coupureDepuis >= 20000) demarrerSecours();
        }, 20500);
        if (es?.readyState === EventSource.CLOSED) setTimeout(ouvrir, 5000);
      };
    }

    ouvrir();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    window.addEventListener("online", visible);
    document.addEventListener("focusout", finSaisie);
    return () => {
      fini = true;
      es?.close();
      arreterSecours();
      if (minuterie) clearTimeout(minuterie);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
      window.removeEventListener("online", visible);
      document.removeEventListener("focusout", finSaisie);
    };
  }, [router]);

  return null;
}
