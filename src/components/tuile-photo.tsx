"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { RefreshCw, X } from "lucide-react";
import { ImageMini } from "@/components/image-mini";
import { envoyerXhr, preparerPhoto } from "@/components/envoi-fichiers";

// Phase 25 : photo avec boutons « Retirer » (et « Remplacer » côté bureau).
// Au clic, la photo se grise tout de suite avec « Retrait… » / une barre
// d'envoi ; elle change quand le serveur a confirmé, et un message
// « Photo retirée ✓ — Annuler » s'affiche en bas de l'écran.
function Contenu({
  url,
  alt,
  retirable,
  remplacable,
  motifRequis,
}: {
  url: string;
  alt: string;
  retirable: boolean;
  remplacable: boolean;
  motifRequis: boolean;
}) {
  const { pending } = useFormStatus();
  const motifRef = useRef<HTMLInputElement>(null);
  const remplRef = useRef<HTMLInputElement>(null);
  const fichierRef = useRef<HTMLInputElement>(null);
  const [envoi, setEnvoi] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [mode, setMode] = useState<"retrait" | "remplacement">("retrait");

  function demanderMotif() {
    if (!motifRequis) return true;
    const m = window.prompt("Rapport déjà validé : motif de la modification ?");
    if (!m || !m.trim()) return false;
    if (motifRef.current) motifRef.current.value = m.trim().slice(0, 500);
    return true;
  }

  async function remplacer(f: File | undefined) {
    if (!f) return;
    setErreur(null);
    if (!demanderMotif()) return;
    setMode("remplacement");
    setEnvoi(0);
    try {
      const { principal, mini } = await preparerPhoto(f);
      const fd = new FormData();
      fd.set("type", "photo");
      fd.set("dossier", "rapports");
      fd.set("nom", f.name || "photo.jpg");
      fd.set("fichier", principal, "photo.jpg");
      if (mini) fd.set("mini", mini, "mini.jpg");
      const r = await envoyerXhr(fd, setEnvoi);
      if (remplRef.current) remplRef.current.value = r.ref;
      setEnvoi(null);
      remplRef.current?.form?.requestSubmit();
    } catch (e) {
      setEnvoi(null);
      setErreur((e as Error).message);
    } finally {
      if (fichierRef.current) fichierRef.current.value = "";
    }
  }

  const occupe = pending || envoi !== null;
  return (
    <>
      <input ref={motifRef} type="hidden" name="motif" defaultValue="" />
      <input ref={remplRef} type="hidden" name="remplacement" defaultValue="" />
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <ImageMini src={url} alt={alt} className={`w-full aspect-square object-cover rounded-lg bg-blue-pale transition-opacity ${occupe ? "opacity-40" : ""}`} />
      </a>
      {occupe && (
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold shadow inline-flex items-center gap-1.5 ${mode === "retrait" ? "text-red-ink" : "text-navy"}`}>
            <span className="bouton-roue" /> {envoi !== null ? `Envoi ${envoi} %` : mode === "retrait" ? "Retrait…" : "Remplacement…"}
          </span>
        </span>
      )}
      {erreur && <span className="absolute inset-x-0 bottom-0 bg-red-ink/90 text-white text-[10px] px-1.5 py-1 rounded-b-lg">{erreur}</span>}
      {!occupe && (retirable || remplacable) && (
        <span className="absolute top-1 right-1 flex gap-1">
          {remplacable && (
            <label title="Remplacer la photo" aria-label="Remplacer la photo" className="w-8 h-8 rounded-full bg-white/95 text-navy shadow flex items-center justify-center cursor-pointer active:scale-90 transition-transform">
              <RefreshCw className="w-4 h-4" strokeWidth={2.5} />
              <input ref={fichierRef} type="file" accept="image/*" className="sr-only" onChange={(e) => remplacer(e.currentTarget.files?.[0])} />
            </label>
          )}
          {retirable && (
            <button
              type="submit"
              aria-label="Retirer la photo"
              title="Retirer la photo"
              onClick={(e) => {
                setMode("retrait");
                if (remplRef.current) remplRef.current.value = "";
                if (!demanderMotif()) e.preventDefault();
              }}
              className="w-8 h-8 rounded-full bg-white/95 text-red-ink shadow flex items-center justify-center active:scale-90 transition-transform"
            >
              <X className="w-4 h-4" strokeWidth={3} />
            </button>
          )}
        </span>
      )}
    </>
  );
}

export function TuilePhoto({
  url,
  alt = "Photo",
  action,
  champs,
  retirable = true,
  remplacable = false,
  motifRequis = false,
}: {
  url: string;
  alt?: string;
  action: (fd: FormData) => Promise<void>;
  champs: Record<string, string>;
  retirable?: boolean;
  remplacable?: boolean;
  motifRequis?: boolean;
}) {
  return (
    <form action={action} className="relative">
      {Object.entries(champs).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Contenu url={url} alt={alt} retirable={retirable} remplacable={remplacable} motifRequis={motifRequis} />
    </form>
  );
}
