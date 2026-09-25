import { Card, Pill } from "@/components/ui";
import { formatDate } from "@/lib/format";

const JOURS_ALERTE_EXPIRATION = 60;

export function HabilitationsList({
  habilitations,
}: {
  habilitations: {
    id: string;
    titre: string;
    subtitle?: string;
    dateObtention: Date;
    dateExpiration: Date | null;
  }[];
}) {
  if (habilitations.length === 0) {
    return <p className="text-sm text-ink-soft">Aucune habilitation enregistrée pour l&apos;instant.</p>;
  }

  const now = new Date().getTime();
  const seuilAlerte = now + JOURS_ALERTE_EXPIRATION * 24 * 60 * 60 * 1000;

  return (
    <div className="flex flex-col gap-2">
      {habilitations.map((h) => {
        const expiration = h.dateExpiration ? new Date(h.dateExpiration).getTime() : null;
        let pill: React.ReactNode;
        if (expiration !== null) {
          if (expiration < now) {
            pill = <Pill tone="crit">Expirée le {formatDate(h.dateExpiration)}</Pill>;
          } else if (expiration <= seuilAlerte) {
            pill = <Pill tone="warn">Expire le {formatDate(h.dateExpiration)}</Pill>;
          } else {
            pill = <Pill tone="ok">Valide jusqu&apos;au {formatDate(h.dateExpiration)}</Pill>;
          }
        } else {
          pill = <Pill tone="ok">Valide (sans échéance)</Pill>;
        }
        return (
          <Card key={h.id} className="p-3.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{h.titre}</div>
              <div className="text-xs text-ink-soft">
                {h.subtitle ? `${h.subtitle} · ` : ""}Obtenue le {formatDate(h.dateObtention)}
              </div>
            </div>
            {pill}
          </Card>
        );
      })}
    </div>
  );
}
