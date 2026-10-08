"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ImageMini } from "@/components/image-mini";

// Phase 18 : miniatures cliquables -> plein écran, flèches / glisser du doigt / Échap.
export function GaleriePhotos({
  photos,
  taille = "md",
}: {
  photos: { url: string; legende?: string | null }[];
  taille?: "sm" | "md";
}) {
  const [index, setIndex] = useState<number | null>(null);
  const debutX = useRef<number | null>(null);
  const fermer = useCallback(() => setIndex(null), []);
  const aller = useCallback(
    (d: number) => setIndex((i) => (i === null ? i : (i + d + photos.length) % photos.length)),
    [photos.length]
  );

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") fermer();
      if (e.key === "ArrowRight") aller(1);
      if (e.key === "ArrowLeft") aller(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [index, aller, fermer]);

  if (!photos.length) return null;
  const dim = taille === "sm" ? "w-12 h-12" : "w-24 h-24 sm:w-28 sm:h-28";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <button
            key={p.url + i}
            type="button"
            onClick={() => setIndex(i)}
            className={`${dim} rounded-lg overflow-hidden bg-blue-pale ring-offset-2 hover:ring-2 hover:ring-blue focus:ring-2 focus:ring-blue`}
            aria-label={`Agrandir la photo ${i + 1}`}
          >
            <ImageMini src={p.url} alt={p.legende ?? `Photo ${i + 1}`} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
      {index !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex flex-col"
          role="dialog"
          aria-modal="true"
          onTouchStart={(e) => (debutX.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (debutX.current === null) return;
            const dx = e.changedTouches[0].clientX - debutX.current;
            if (Math.abs(dx) > 50) aller(dx < 0 ? 1 : -1);
            debutX.current = null;
          }}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="text-sm font-semibold">
              {index + 1} / {photos.length}
              {photos[index].legende ? ` — ${photos[index].legende}` : ""}
            </span>
            <button type="button" onClick={fermer} className="p-2 rounded-full hover:bg-white/10" aria-label="Fermer">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center px-2 min-h-0" onClick={fermer}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[index].url}
              alt=""
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          {photos.length > 1 && (
            <div className="flex justify-between px-4 py-4">
              <button type="button" onClick={() => aller(-1)} className="p-3 rounded-full bg-white/10 text-white" aria-label="Photo précédente">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <a href={photos[index].url} target="_blank" rel="noreferrer" className="self-center text-white/80 text-sm underline">
                Ouvrir l&apos;original
              </a>
              <button type="button" onClick={() => aller(1)} className="p-3 rounded-full bg-white/10 text-white" aria-label="Photo suivante">
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
