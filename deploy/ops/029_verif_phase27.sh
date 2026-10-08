# Vérification Phase 27 (lecture seule) : Planning des missions (semaine / jour / mois / par projet), pastille du menu.
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== fuseau du serveur (heures programmées = heure murale)"; date; node -e 'console.log("node TZ:", Intl.DateTimeFormat().resolvedOptions().timeZone)'; pm2 env 0 2>/dev/null | grep -E "^TZ" || echo "pas de TZ dans pm2"
echo "== missions ouvertes"; psql "$U" -P pager=off -c "select statut, count(*), count(*) filter (where technicien_id is null) as sans_tech, count(*) filter (where technicien_id is not null and envoyee_le is null) as non_envoyees from interventions where statut in ('creee','planifiee','affectee','en_cours') group by 1 order by 1"
echo "== pages"; for p in /responsable/interventions "/responsable/interventions?vue=jour"; do curl -s -o /dev/null -w "$p %{http_code}\n" "http://localhost:3000$p"; done
echo "== vitesse (avec session)"; node --input-type=module <<'JS'
import "dotenv/config";
import postgres from "postgres";
import { encode } from "@auth/core/jwt";
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const [u] = await sql`select id, nom, email, role from users where role='administrateur' and actif=1 limit 1`;
const ck = ["authjs.session-token", "__Secure-authjs.session-token"];
const parts = [];
for (const salt of ck) parts.push(`${salt}=${await encode({ token: { sub: u.id, id: u.id, role: u.role, name: u.nom, email: u.email }, secret: process.env.AUTH_SECRET, salt, maxAge: 600 })}`);
const pages = ["/responsable/interventions", "/responsable/interventions?vue=jour", "/responsable/interventions?vue=mois", "/responsable/interventions?vue=projet", "/responsable/appareils", "/responsable"];
for (const p of pages) {
  const t = [];
  let code = 0, erreur = false;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const r = await fetch("http://localhost:3000" + p, { headers: { cookie: parts.join("; "), "x-forwarded-proto": "https" }, redirect: "manual" });
    const txt = await r.text(); code = r.status; erreur = erreur || /couldn.t load|Application error/.test(txt);
    t.push(performance.now() - t0);
    if (i === 0 && p === "/responsable/interventions") {
      const m = txt.match(/(\d+) en cours · (\d+) à affecter · (\d+) en retard|\d+ à affecter · \d+ en retard|\d+ à affecter/);
      console.log("  détail menu :", m ? m[0] : "(rien en cours)", "· sections :", ["Sur le terrain maintenant", "À traiter", "Technicien"].filter((x) => txt.includes(x)).join(", "));
    }
  }
  t.sort((x, y) => x - y);
  console.log(`  ${Math.round(t[1])} ms  ${code}${erreur ? " ERREUR" : ""}  ${p}`);
}
await sql.end();
JS
echo "== erreurs récentes"; tail -n 300 /root/.pm2/logs/robus-dashboard-error.log | grep -E "⨯|Error" | grep -vE "UnknownAction|UntrustedHost|Server Reference|Failed to find Server Action|existe déjà|Commencez la mission" | tail -8
date
