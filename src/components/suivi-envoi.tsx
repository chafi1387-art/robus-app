import { Pill } from "@/components/ui";
import { libelleRefus } from "@/lib/missions";

// Phase 17 : accusé de réception d'une mission, côté bureau.
// Envoyée → Vue par le technicien → Acceptée, + alertes email / téléphone.

const NON_COMMENCES = new Set(["creee", "planifiee", "affectee"]);
export const DELAI_NON_VUE_MS = 30 * 60 * 1000;

function heure(d: Date) {
  const memeJour = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("fr-BE", {
    timeZone: "Europe/Brussels",
    ...(memeJour ? {} : { day: "2-digit", month: "2-digit" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type SuiviEnvoiData = {
  statut: string;
  technicienId: string | null;
  envoyeeLe: Date | null;
  vueLe: Date | null;
  accepteeLe: Date | null;
  envoiEmail: string | null;
  envoiPush: number | null;
  refuseeLe?: Date | null;
  refusMotif?: string | null;
};

export function SuiviEnvoi({ m }: { m: SuiviEnvoiData }) {
  if (!m.technicienId || !NON_COMMENCES.has(m.statut)) return null;
  const pills: React.ReactNode[] = [];
  if (m.refuseeLe) {
    // Phase 21 : refus motivé du technicien — décision du bureau attendue.
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Pill tone="crit">Refusée {heure(m.refuseeLe)} · {libelleRefus(m.refusMotif)}</Pill>
      </span>
    );
  }
  if (m.accepteeLe) {
    pills.push(<Pill key="s" tone="ok">Acceptée {heure(m.accepteeLe)}</Pill>);
  } else if (m.vueLe) {
    pills.push(<Pill key="s" tone="neutral">Vue {heure(m.vueLe)} · à accepter</Pill>);
  } else if (m.envoyeeLe) {
    // Composant serveur rendu à chaque requête : l'heure courante est voulue ici.
    // eslint-disable-next-line react-hooks/purity
    const enRetard = Date.now() - m.envoyeeLe.getTime() > DELAI_NON_VUE_MS;
    pills.push(
      <Pill key="s" tone={enRetard ? "crit" : "warn"}>
        Envoyée {heure(m.envoyeeLe)} · pas encore vue
      </Pill>
    );
  } else {
    pills.push(<Pill key="s" tone="warn">Pas encore envoyée</Pill>);
  }
  if (!m.accepteeLe && !m.vueLe) {
    if (m.envoiEmail === "echec") pills.push(<Pill key="e" tone="crit">Email non parti</Pill>);
    if (m.envoiPush === 0) pills.push(<Pill key="p" tone="warn">Téléphone non notifié</Pill>);
  }
  return <span className="inline-flex flex-wrap items-center gap-1.5">{pills}</span>;
}
