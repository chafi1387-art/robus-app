"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QrCode, X } from "lucide-react";

// Phase 22 : scanner l'étiquette QR d'un appareil avec la caméra du téléphone.
// BarcodeDetector (Android / Chrome) si disponible, sinon jsQR (iPhone…).
// Le QR contient l'adresse …/a/<code> : on ouvre cette adresse, qui mène le
// technicien sur la fiche de l'appareil.

type Detecteur = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export function cheminDepuisQr(texte: string) {
  const m = /\/a\/([A-Za-z0-9_-]{8,32})(?:[/?#]|$)/.exec(texte.trim());
  if (m) return `/a/${m[1]}`;
  if (/^[A-Za-z0-9_-]{8,32}$/.test(texte.trim())) return `/a/${texte.trim()}`;
  return `/technicien/appareils?q=${encodeURIComponent(texte.trim().slice(0, 80))}`;
}

export function ScannerQr() {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const flux = useRef<MediaStream | null>(null);
  const actif = useRef(false);

  const arreter = useCallback(() => {
    actif.current = false;
    flux.current?.getTracks().forEach((t) => t.stop());
    flux.current = null;
  }, []);

  const fermer = useCallback(() => {
    arreter();
    setOuvert(false);
  }, [arreter]);

  useEffect(() => {
    if (!ouvert) return;
    let annule = false;
    (async () => {
      setErreur(null);
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (annule) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        flux.current = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play();
        actif.current = true;
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detecteur }).BarcodeDetector;
        const detecteur = BD ? new BD({ formats: ["qr_code"] }) : null;
        const jsQR = detecteur ? null : (await import("jsqr")).default;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const boucle = async () => {
          if (!actif.current) return;
          try {
            if (v.readyState >= 2) {
              let texte: string | null = null;
              if (detecteur) {
                const r = await detecteur.detect(v);
                texte = r[0]?.rawValue ?? null;
              } else if (jsQR && ctx) {
                const l = Math.min(v.videoWidth, 720);
                const h = Math.round((v.videoHeight / v.videoWidth) * l);
                canvas.width = l;
                canvas.height = h;
                ctx.drawImage(v, 0, 0, l, h);
                const img = ctx.getImageData(0, 0, l, h);
                texte = jsQR(img.data, l, h, { inversionAttempts: "dontInvert" })?.data ?? null;
              }
              if (texte) {
                if (navigator.vibrate) navigator.vibrate(80);
                arreter();
                router.push(cheminDepuisQr(texte));
                return;
              }
            }
          } catch {
            // image illisible : on réessaie à l'image suivante
          }
          setTimeout(boucle, 180);
        };
        boucle();
      } catch {
        setErreur("Caméra inaccessible. Autorisez la caméra pour ce site, ou tapez le numéro de l'appareil.");
      }
    })();
    return () => {
      annule = true;
      arreter();
    };
  }, [ouvert, arreter, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="w-full min-h-14 rounded-2xl bg-navy text-white font-display font-bold text-[16px] flex items-center justify-center gap-2.5"
      >
        <QrCode className="w-6 h-6" /> Scanner le QR code de l&apos;appareil
      </button>
      {ouvert && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 text-white pt-[max(0.75rem,env(safe-area-inset-top))]">
            <span className="font-display font-bold">Visez l&apos;étiquette QR de la cabine</span>
            <button type="button" onClick={fermer} aria-label="Fermer" className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 relative flex items-center justify-center overflow-hidden">
            <video ref={video} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
            <div className="relative w-64 h-64 rounded-3xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
          {erreur && <div className="bg-red-fill text-red-ink text-sm font-semibold px-4 py-3">{erreur}</div>}
          <div className="text-center text-white/70 text-xs py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">La fiche de l&apos;appareil s&apos;ouvre automatiquement.</div>
        </div>
      )}
    </>
  );
}
