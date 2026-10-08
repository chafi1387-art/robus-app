"use client";

import { useState } from "react";

// Phase 25 : affiche la miniature (≈ 30 Ko, fabriquée par le téléphone à
// l'envoi) au lieu de la photo complète ; si elle n'existe pas (photo plus
// ancienne), on affiche l'originale.
export function urlMini(url: string) {
  return /^\/uploads\/.+\.(jpe?g|png|webp)$/i.test(url) && !/\.mini\.jpg$/i.test(url) ? url.replace(/\.(jpe?g|png|webp)$/i, ".mini.jpg") : url;
}

export function ImageMini({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [erreur, setErreur] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={erreur ? src : urlMini(src)}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setErreur(true)}
    />
  );
}
