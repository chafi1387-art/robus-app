import Link from "next/link";

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-surface border border-line rounded-2xl shadow-sm ${className}`}>
      {children}
    </div>
  );
}

const STATUT_APPAREIL_LABEL: Record<string, string> = {
  en_service: "En service",
  sous_surveillance: "Sous surveillance",
  en_panne: "En panne",
  hors_service: "Hors service",
  en_travaux: "En travaux",
  installation: "Installation (projet sur plan)",
};
const STATUT_APPAREIL_TONE: Record<string, "ok" | "warn" | "crit"> = {
  en_service: "ok",
  sous_surveillance: "warn",
  en_panne: "crit",
  hors_service: "crit",
  en_travaux: "warn",
};

const STATUT_INTERVENTION_LABEL: Record<string, string> = {
  creee: "Créée",
  planifiee: "Planifiée",
  affectee: "Affectée",
  en_cours: "En cours",
  terminee: "Terminée",
  validee: "Validée",
  cloturee: "Clôturée",
};

const TYPE_INTERVENTION_LABEL: Record<string, string> = {
  preventive: "Préventive",
  corrective: "Corrective",
  systematique: "Systématique",
};

const PRIORITE_TONE: Record<string, "ok" | "warn" | "crit"> = {
  basse: "ok",
  normale: "ok",
  haute: "warn",
  critique: "crit",
};

const TONE_CLASSES: Record<string, string> = {
  ok: "bg-green-fill text-green-ink",
  warn: "bg-orange-fill text-orange-ink",
  crit: "bg-red-fill text-red-ink",
  neutral: "bg-blue-pale text-blue",
};

export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "ok" | "warn" | "crit" | "neutral";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${TONE_CLASSES[tone]}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {children}
    </span>
  );
}

export function StatutAppareilPill({ statut }: { statut: string }) {
  return (
    <Pill tone={STATUT_APPAREIL_TONE[statut] ?? "neutral"}>
      {STATUT_APPAREIL_LABEL[statut] ?? statut}
    </Pill>
  );
}

export function StatutInterventionPill({ statut }: { statut: string }) {
  const tone =
    statut === "cloturee" || statut === "validee" || statut === "terminee"
      ? "ok"
      : statut === "en_cours"
        ? "warn"
        : "neutral";
  return <Pill tone={tone}>{STATUT_INTERVENTION_LABEL[statut] ?? statut}</Pill>;
}

export function TypeInterventionPill({ type }: { type: string }) {
  return <Pill tone="neutral">{TYPE_INTERVENTION_LABEL[type] ?? type}</Pill>;
}

export function PrioritePill({ priorite }: { priorite: string }) {
  return (
    <Pill tone={PRIORITE_TONE[priorite] ?? "neutral"}>
      {priorite.charAt(0).toUpperCase() + priorite.slice(1)}
    </Pill>
  );
}

export function Btn({
  children,
  variant = "primary",
  type = "submit",
  href,
  className = "",
}: {
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  type?: "submit" | "button";
  href?: string;
  className?: string;
}) {
  const base =
    "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold font-display transition-colors";
  const styles =
    variant === "primary"
      ? "bg-blue text-white hover:bg-blue-light"
      : "bg-transparent border border-line text-ink hover:bg-blue-pale hover:border-blue-pale";
  if (href) {
    return (
      <Link href={href} className={`${base} ${styles} ${className}`}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-accent focus:border-blue bg-surface";
