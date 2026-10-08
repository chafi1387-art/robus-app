"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Camera, Check, FileText, Loader2, Paperclip, RotateCcw, X } from "lucide-react";

// ==========================================================================
// Phase 25 — Envoi des photos / fichiers UN PAR UN, avec suivi visible.
//
// On peut choisir plusieurs photos d'un coup ; elles partent l'une après
// l'autre (file d'attente). Chaque photo affiche son état :
//   En attente → Envoi 45 % → ✓ Envoyée   (ou ✗ Échec + « Réessayer »)
// Les photos sont réduites sur le téléphone avant l'envoi (≈ 1600 px,
// ≈ 300 Ko au lieu de 3–5 Mo) + une miniature (≈ 30 Ko) pour les listes.
// Le formulaire ne peut pas être validé tant qu'un envoi est en cours.
// Même composant pour le technicien, l'observateur et le bureau.
// ==========================================================================

type Etat = "preparation" | "attente" | "envoi" | "ok" | "erreur";
type Element = {
  id: string;
  nom: string;
  taille: number;
  apercu: string | null;
  fichier: File;
  etat: Etat;
  progres: number;
  erreur?: string;
  ref?: string;
};

const TYPES_PHOTO = ["image/jpeg", "image/png", "image/webp"];
const ACCEPT_FICHIERS =
  "application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation";

function taille(o: number) {
  return o > 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`;
}

/** Réduit une image dans le navigateur (orientation corrigée) ; renvoie JPEG principal + miniature. */
export async function preparerPhoto(f: File): Promise<{ principal: Blob; mini: Blob | null }> {
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const dessiner = (cote: number, qualite: number) =>
      new Promise<Blob | null>((ok) => {
        const r = Math.min(1, cote / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(bmp.width * r));
        c.height = Math.max(1, Math.round(bmp.height * r));
        const ctx = c.getContext("2d");
        if (!ctx) return ok(null);
        ctx.drawImage(bmp, 0, 0, c.width, c.height);
        c.toBlob((b) => ok(b), "image/jpeg", qualite);
      });
    const principal = await dessiner(1600, 0.82);
    const mini = await dessiner(360, 0.7);
    bmp.close?.();
    if (principal && (principal.size < f.size || !TYPES_PHOTO.includes(f.type))) return { principal, mini };
    if (TYPES_PHOTO.includes(f.type)) return { principal: f, mini };
    if (principal) return { principal, mini };
  } catch {
    /* format que le navigateur ne sait pas lire : on envoie l'original s'il est accepté */
  }
  if (TYPES_PHOTO.includes(f.type)) return { principal: f, mini: null };
  throw new Error("Format de photo non supporté — prenez la photo en JPEG.");
}

export function envoyerXhr(fd: FormData, onProgres: (p: number) => void) {
  return new Promise<{ ref: string; url: string; nom: string }>((ok, ko) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/televersement");
    xhr.timeout = 180000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgres(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let d: { ref?: string; url?: string; nom?: string; erreur?: string } = {};
      try {
        d = JSON.parse(xhr.responseText);
      } catch {
        /* réponse inattendue */
      }
      if (xhr.status === 200 && d.ref) ok({ ref: d.ref, url: d.url!, nom: d.nom! });
      else ko(new Error(d.erreur ?? (xhr.status === 401 ? "Session expirée — reconnectez-vous." : `Échec de l'envoi (${xhr.status || "réseau"}).`)));
    };
    xhr.onerror = () => ko(new Error("Pas de réseau — réessayez."));
    xhr.ontimeout = () => ko(new Error("Réseau trop lent — réessayez."));
    xhr.send(fd);
  });
}

export function EnvoiFichiers({
  name = "photos",
  type = "photo",
  dossier = type === "photo" ? "rapports" : "missions",
  max = type === "photo" ? 20 : 10,
  requis = false,
  libelle,
  aide,
  compact = false,
  apresEnvoi,
  contexte,
  texteOk,
}: {
  name?: string;
  type?: "photo" | "fichier";
  dossier?: "rapports" | "missions" | "signalements" | "habilitations" | "formations" | "devis";
  max?: number;
  requis?: boolean;
  libelle?: string;
  aide?: string;
  compact?: boolean;
  /** Mode « envoi direct » : chaque fichier envoyé est aussitôt transmis à cette action (ex. fil de la mission). */
  apresEnvoi?: (contexte: string, ref: string) => Promise<{ erreur?: string } | void>;
  contexte?: string;
  texteOk?: string;
}) {
  const id = useId();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const gardeRef = useRef<HTMLInputElement>(null);
  const [elements, setElements] = useState<Element[]>([]);
  const enCours = useRef(false);
  const elementsRef = useRef<Element[]>([]);
  useLayoutEffect(() => {
    elementsRef.current = elements;
  }, [elements]);
  const { pending } = useFormStatus();
  const etaitPending = useRef(false);

  const maj = useCallback((eid: string, champ: Partial<Element>) => {
    setElements((l) => l.map((e) => (e.id === eid ? { ...e, ...champ } : e)));
  }, []);

  // File d'attente : un seul envoi à la fois.
  const traiter = useCallback(async () => {
    if (enCours.current) return;
    enCours.current = true;
    try {
      for (;;) {
        const suivant = elementsRef.current.find((e) => e.etat === "attente");
        if (!suivant) break;
        maj(suivant.id, { etat: "envoi", progres: 0, erreur: undefined });
        try {
          const fd = new FormData();
          fd.set("type", type);
          fd.set("dossier", dossier);
          fd.set("nom", suivant.nom);
          if (type === "photo") {
            const { principal, mini } = await preparerPhoto(suivant.fichier);
            fd.set("fichier", principal, suivant.nom.replace(/\.[a-z0-9]+$/i, "") + (principal.type === "image/jpeg" ? ".jpg" : ""));
            if (mini) fd.set("mini", mini, "mini.jpg");
          } else {
            fd.set("fichier", suivant.fichier, suivant.nom);
          }
          const r = await envoyerXhr(fd, (p) => maj(suivant.id, { progres: p }));
          if (apresEnvoi) {
            const res = await apresEnvoi(contexte ?? "", r.ref);
            if (res && res.erreur) throw new Error(res.erreur);
          }
          maj(suivant.id, { etat: "ok", progres: 100, ref: r.ref });
          if (apresEnvoi) router.refresh();
        } catch (e) {
          maj(suivant.id, { etat: "erreur", erreur: (e as Error).message });
        }
        // Laisse React appliquer l'état avant de lire l'élément suivant.
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      enCours.current = false;
    }
  }, [apresEnvoi, contexte, dossier, maj, router, type]);

  useEffect(() => {
    if (elements.some((e) => e.etat === "attente")) void traiter();
  }, [elements, traiter]);

  // Retour du réseau : on relance automatiquement les envois en échec réseau.
  useEffect(() => {
    const relancer = () =>
      setElements((l) => l.map((e) => (e.etat === "erreur" && /réseau|lent/i.test(e.erreur ?? "") ? { ...e, etat: "attente" } : e)));
    window.addEventListener("online", relancer);
    return () => window.removeEventListener("online", relancer);
  }, []);

  // Mode envoi direct : les éléments réussis disparaissent après quelques secondes
  // (ils apparaissent alors dans la liste de la page).
  useEffect(() => {
    if (!apresEnvoi || !elements.some((e) => e.etat === "ok")) return;
    const t = setTimeout(() => setElements((l) => l.filter((e) => e.etat !== "ok")), 4000);
    return () => clearTimeout(t);
  }, [apresEnvoi, elements]);

  // Formulaire validé avec succès : on vide la liste (sinon les photos seraient renvoyées).
  useEffect(() => {
    if (pending) {
      etaitPending.current = true;
      return;
    }
    if (!etaitPending.current) return;
    etaitPending.current = false;
    const t = setTimeout(() => {
      if (!window.location.search.includes("erreur=")) setElements([]);
    }, 50);
    return () => clearTimeout(t);
  }, [pending]);

  // Fichiers choisis avant que la page ne soit prête (réseau lent) : pris en compte.
  useEffect(() => {
    const f = inputRef.current?.files;
    if (f && f.length) ajouter(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Libère les aperçus.
  useEffect(() => () => elementsRef.current.forEach((e) => e.apercu && URL.revokeObjectURL(e.apercu)), []);

  const nbOk = elements.filter((e) => e.etat === "ok").length;
  const nbEnCours = elements.filter((e) => e.etat === "attente" || e.etat === "envoi" || e.etat === "preparation").length;
  const nbErreur = elements.filter((e) => e.etat === "erreur").length;

  // Garde-fou : empêche la validation du formulaire pendant un envoi
  // (validation native du navigateur → message affiché à côté du champ).
  let blocage = "";
  if (!apresEnvoi) {
    if (nbEnCours > 0) blocage = `Attendez la fin de l'envoi (${nbEnCours} ${type === "photo" ? "photo(s)" : "fichier(s)"} en cours).`;
    else if (nbErreur > 0) blocage = `${nbErreur} envoi(s) en échec : réessayez ou retirez-les.`;
    else if (requis && nbOk === 0) blocage = type === "photo" ? "Ajoutez au moins une photo." : "Ajoutez au moins un fichier.";
  }
  useEffect(() => {
    gardeRef.current?.setCustomValidity(blocage);
  }, [blocage]);
  const [alerte, setAlerte] = useState(false);
  const alerteVisible = alerte && !!blocage;

  function ajouter(liste: FileList | null) {
    if (!liste?.length) return;
    const place = max - elementsRef.current.filter((e) => e.etat !== "erreur").length;
    const choisis = Array.from(liste).slice(0, Math.max(0, place));
    const nouveaux: Element[] = choisis.map((f) => {
      let erreur: string | undefined;
      if (type === "photo" && !f.type.startsWith("image/") && f.type !== "") erreur = "Ce fichier n'est pas une photo.";
      if (type === "photo" && f.size > 40 * 1048576) erreur = "Photo trop lourde (40 Mo maximum avant réduction).";
      if (type === "fichier" && f.size > 20 * 1048576) erreur = "Fichier trop lourd (20 Mo maximum).";
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        nom: f.name || (type === "photo" ? "photo.jpg" : "fichier"),
        taille: f.size,
        apercu: type === "photo" || f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
        fichier: f,
        etat: erreur ? "erreur" : "attente",
        progres: 0,
        erreur,
      };
    });
    setElements((l) => [...l, ...nouveaux]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function retirer(eid: string) {
    setElements((l) => {
      const e = l.find((x) => x.id === eid);
      if (e?.apercu) URL.revokeObjectURL(e.apercu);
      return l.filter((x) => x.id !== eid);
    });
  }

  const Icone = type === "photo" ? Camera : Paperclip;
  const plein = elements.filter((e) => e.etat !== "erreur").length >= max;

  return (
    <div className="flex flex-col gap-2" data-envoi-fichiers="">
      {libelle && <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">{libelle}</span>}
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={id}
          className={`inline-flex items-center gap-2 rounded-lg border-[1.5px] border-dashed px-3.5 ${compact ? "py-1.5 text-xs" : "py-2.5 text-sm"} font-bold font-display cursor-pointer select-none transition-colors ${
            plein ? "border-line text-ink-soft opacity-60 cursor-not-allowed" : "border-blue/60 text-blue bg-blue-pale/40 hover:bg-blue-pale active:scale-[0.98]"
          }`}
        >
          <Icone className="w-4 h-4" />
          {type === "photo" ? (elements.length ? "Ajouter d'autres photos" : "Ajouter des photos") : elements.length ? "Ajouter d'autres fichiers" : "Joindre des fichiers"}
        </label>
        <input
          ref={inputRef}
          id={id}
          type="file"
          multiple
          disabled={plein}
          accept={type === "photo" ? "image/*" : ACCEPT_FICHIERS}
          className="sr-only"
          onChange={(e) => ajouter(e.currentTarget.files)}
        />
        {elements.length > 0 && (
          <span className={`text-xs font-semibold ${nbErreur ? "text-red-ink" : nbEnCours ? "text-orange-ink" : "text-green-ink"}`} aria-live="polite">
            {nbEnCours > 0
              ? `Envoi en cours… ${nbOk} / ${elements.length}`
              : nbErreur > 0
                ? `${nbOk} envoyé(s) · ${nbErreur} échec(s)`
                : `✓ ${nbOk} ${type === "photo" ? "photo(s)" : "fichier(s)"} ${texteOk ?? "envoyé(s)"}`}
          </span>
        )}
      </div>
      {aide && !elements.length && <p className="text-xs text-ink-soft">{aide}</p>}

      {elements.length > 0 && (
        <ul className={type === "photo" ? "grid grid-cols-3 sm:grid-cols-4 gap-2" : "flex flex-col gap-1.5"}>
          {elements.map((e) =>
            type === "photo" ? (
              <li key={e.id} className="relative aspect-square rounded-xl overflow-hidden bg-blue-pale border border-line">
                {e.apercu && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.apercu} alt={e.nom} className={`w-full h-full object-cover transition-opacity ${e.etat === "ok" ? "" : "opacity-60"}`} />
                )}
                <EtatBadge e={e} />
                {(e.etat === "envoi" || e.etat === "attente" || e.etat === "preparation") && (
                  <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/20">
                    <div className="h-full bg-blue transition-[width] duration-200" style={{ width: `${e.progres}%` }} />
                  </div>
                )}
                {e.etat === "erreur" && (
                  <div className="absolute inset-x-0 bottom-0 bg-red-ink/90 text-white text-[10px] leading-tight px-1.5 py-1">
                    {e.erreur}
                    <button type="button" onClick={() => maj(e.id, { etat: "attente", erreur: undefined })} className="mt-1 w-full inline-flex items-center justify-center gap-1 rounded bg-white text-red-ink font-bold py-1">
                      <RotateCcw className="w-3 h-3" /> Réessayer
                    </button>
                  </div>
                )}
                {e.etat !== "envoi" && !(apresEnvoi && e.etat === "ok") && (
                  <button type="button" onClick={() => retirer(e.id)} aria-label={`Retirer ${e.nom}`} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 text-ink shadow flex items-center justify-center">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ) : (
              <li key={e.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${e.etat === "erreur" ? "border-red-ink/40 bg-red-fill" : e.etat === "ok" ? "border-green-ink/30 bg-green-fill/40" : "border-line bg-surface"}`}>
                <FileText className="w-4 h-4 shrink-0 text-ink-soft" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{e.nom}</div>
                  <div className="text-ink-soft">
                    {taille(e.taille)} ·{" "}
                    {e.etat === "ok" ? <span className="text-green-ink font-bold">✓ {texteOk ?? "Envoyé"}</span> : e.etat === "erreur" ? <span className="text-red-ink font-bold">✗ {e.erreur}</span> : e.etat === "envoi" ? `Envoi ${e.progres} %` : "En attente…"}
                  </div>
                  {e.etat === "envoi" && (
                    <div className="mt-1 h-1 rounded bg-line overflow-hidden">
                      <div className="h-full bg-blue transition-[width]" style={{ width: `${e.progres}%` }} />
                    </div>
                  )}
                </div>
                {e.etat === "erreur" && (
                  <button type="button" onClick={() => maj(e.id, { etat: "attente", erreur: undefined })} className="font-bold text-blue">Réessayer</button>
                )}
                {e.etat !== "envoi" && (
                  <button type="button" onClick={() => retirer(e.id)} aria-label={`Retirer ${e.nom}`} className="p-1 text-ink-soft">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </li>
            )
          )}
        </ul>
      )}

      {/* Références envoyées : ce sont elles que le formulaire transmet. */}
      {!apresEnvoi && elements.filter((e) => e.etat === "ok" && e.ref).map((e) => <input key={e.id} type="hidden" name={name} value={e.ref} />)}
      {!apresEnvoi && (
        <input
          ref={gardeRef}
          aria-hidden="true"
          tabIndex={-1}
          value="x"
          onChange={() => undefined}
          onInvalid={() => setAlerte(true)}
          className="absolute opacity-0 w-px h-px pointer-events-none"
          style={{ marginTop: "-1px" }}
        />
      )}
      {alerteVisible && <p className="text-xs font-semibold text-red-ink" role="alert">{blocage}</p>}
    </div>
  );
}

function EtatBadge({ e }: { e: Element }) {
  if (e.etat === "ok")
    return (
      <span className="absolute top-1 left-1 w-6 h-6 rounded-full bg-green text-white flex items-center justify-center shadow" aria-label="Envoyée">
        <Check className="w-4 h-4" strokeWidth={3} />
      </span>
    );
  if (e.etat === "erreur")
    return (
      <span className="absolute top-1 left-1 w-6 h-6 rounded-full bg-red text-white flex items-center justify-center shadow" aria-label="Échec">
        <X className="w-4 h-4" strokeWidth={3} />
      </span>
    );
  return (
    <span className="absolute inset-0 flex items-center justify-center">
      <span className="rounded-full bg-white/90 px-2 py-1 text-[11px] font-bold text-navy shadow inline-flex items-center gap-1">
        {e.etat === "envoi" ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" /> {e.progres} %
          </>
        ) : (
          "En attente"
        )}
      </span>
    </span>
  );
}
