import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDateJour, minutesEnHeuresDecimales, moisOuCourant } from "@/lib/sous-traitance";
import { chargerHeures } from "@/app/responsable/sous-traitance/donnees";

const uuidOk = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

export async function GET(req: Request) {
  await requireUser(ROLES_BUREAU);
  const url = new URL(req.url);
  const mois = moisOuCourant(url.searchParams.get("mois"));
  const lignes = await chargerHeures({
    mois,
    clientId: uuidOk(url.searchParams.get("client")),
    technicienId: uuidOk(url.searchParams.get("technicien")),
  });
  const csv = toCsv(
    ["Client", "Date", "Technicien", "Heures (décimal)", "Minutes", "Commentaire"],
    lignes.map((l) => [
      l.client,
      formatDateJour(l.dateTravail),
      l.technicien,
      minutesEnHeuresDecimales(l.minutes),
      l.minutes,
      l.commentaire ?? "",
    ])
  );
  return csvResponse(`sous-traitance-${mois}.csv`, csv);
}
