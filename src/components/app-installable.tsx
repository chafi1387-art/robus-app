"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Download, Share, SquarePlus, Check } from "lucide-react";
import { enregistrerAbonnementPush, supprimerAbonnementPush } from "@/app/notifications/actions";

// Phase 16 : application installable (PWA) + notifications push.

type BeforeInstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let invitationInstallation: BeforeInstallPrompt | null = null;
const abonnes = new Set<() => void>();

/** Enregistre le service worker (toutes les pages) et capte l'invitation d'installation Android. */
export function EnregistrementSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    const capter = (e: Event) => {
      e.preventDefault();
      invitationInstallation = e as BeforeInstallPrompt;
      abonnes.forEach((f) => f());
    };
    window.addEventListener("beforeinstallprompt", capter);
    return () => window.removeEventListener("beforeinstallprompt", capter);
  }, []);
  return null;
}

function base64UrlVersUint8(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const brut = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...brut].map((c) => c.charCodeAt(0)));
}

function environnement() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installee = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const pushPossible = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { ios, installee, pushPossible };
}

type Etat = { ios: boolean; installee: boolean; pushPossible: boolean; permission: string; abonne: boolean; peutInstaller: boolean };

export function CarteApplication({ cleVapid, compact = false, seulementSiAction = false }: { cleVapid: string | null; compact?: boolean; seulementSiAction?: boolean }) {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function rafraichir() {
    const env = environnement();
    let abonne = false;
    if (env.pushPossible) {
      const reg = await navigator.serviceWorker.getRegistration("/");
      abonne = !!(await reg?.pushManager.getSubscription());
    }
    setEtat({ ...env, permission: "Notification" in window ? Notification.permission : "unsupported", abonne, peutInstaller: !!invitationInstallation });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    rafraichir();
    const f = () => rafraichir();
    abonnes.add(f);
    return () => {
      abonnes.delete(f);
    };
  }, []);

  if (!etat) return null;
  // Rien à proposer (installée + notifications actives ou impossibles) : on se fait discret.
  if (seulementSiAction && !message && etat.installee && (etat.abonne || !etat.pushPossible)) return null;

  async function installer() {
    if (!invitationInstallation) return;
    await invitationInstallation.prompt();
    await invitationInstallation.userChoice.catch(() => null);
    invitationInstallation = null;
    rafraichir();
  }

  async function activer() {
    if (!cleVapid) return setMessage("Les notifications ne sont pas encore configurées sur le serveur.");
    setOccupe(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Notifications refusées. Vous pouvez les autoriser dans les réglages du téléphone.");
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlVersUint8(cleVapid) }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await enregistrerAbonnementPush({ ...json, appareil: navigator.userAgent.slice(0, 200) });
      setMessage(r.ok ? "Notifications activées : une notification de test vient d'être envoyée." : "Impossible d'activer les notifications.");
    } catch {
      setMessage("Impossible d'activer les notifications sur cet appareil.");
    } finally {
      setOccupe(false);
      rafraichir();
    }
  }

  async function desactiver() {
    setOccupe(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supprimerAbonnementPush(sub.endpoint);
        await sub.unsubscribe();
      }
      setMessage("Notifications désactivées sur cet appareil.");
    } finally {
      setOccupe(false);
      rafraichir();
    }
  }

  const bouton = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold min-h-11";
  const iosNonInstallee = etat.ios && !etat.installee;

  return (
    <div className={`bg-surface border border-line rounded-2xl ${compact ? "p-3" : "p-4"} flex flex-col gap-3`}>
      {!etat.installee && (
        <div className="flex flex-col gap-2">
          <div className="font-display font-bold text-[15px]">Installer l&apos;application ROBUS</div>
          {etat.peutInstaller ? (
            <button type="button" onClick={installer} className={`${bouton} bg-blue text-white`}>
              <Download className="w-4 h-4" /> Installer sur ce téléphone
            </button>
          ) : etat.ios ? (
            <ol className="text-[13px] text-ink-soft flex flex-col gap-1.5">
              <li className="flex items-center gap-2">1. Ouvrez ce site dans <strong className="text-ink">Safari</strong></li>
              <li className="flex items-center gap-2 flex-wrap">2. Touchez <Share className="w-4 h-4 text-blue" /> <strong className="text-ink">Partager</strong></li>
              <li className="flex items-center gap-2 flex-wrap">3. Choisissez <SquarePlus className="w-4 h-4 text-blue" /> <strong className="text-ink">Sur l&apos;écran d&apos;accueil</strong></li>
            </ol>
          ) : (
            <p className="text-[13px] text-ink-soft">Dans le menu du navigateur (⋮), choisissez « Installer l&apos;application » ou « Ajouter à l&apos;écran d&apos;accueil ».</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="font-display font-bold text-[15px] flex items-center gap-2">
          {etat.abonne ? <Check className="w-4 h-4 text-green-ink" /> : <Bell className="w-4 h-4" />} Notifications sur cet appareil
        </div>
        {iosNonInstallee ? (
          <p className="text-[13px] text-ink-soft">Sur iPhone, installez d&apos;abord l&apos;application (ci-dessus) puis ouvrez-la depuis l&apos;écran d&apos;accueil pour activer les notifications.</p>
        ) : !etat.pushPossible ? (
          <p className="text-[13px] text-ink-soft">Ce navigateur ne gère pas les notifications.</p>
        ) : etat.abonne ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] text-green-ink font-semibold">Activées</span>
            <button type="button" disabled={occupe} onClick={desactiver} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-soft underline">
              <BellOff className="w-3.5 h-3.5" /> Désactiver
            </button>
          </div>
        ) : (
          <button type="button" disabled={occupe} onClick={activer} className={`${bouton} bg-navy text-white disabled:opacity-60`}>
            <Bell className="w-4 h-4" /> {occupe ? "Activation…" : "Activer les notifications"}
          </button>
        )}
        {message && <p className="text-[13px] text-ink-soft">{message}</p>}
      </div>
    </div>
  );
}
