# Vérification Phase 26 (lecture seule) : historique des états, parc d'appareils, fiche tableau de bord.
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== migration"; grep -E "0023" /root/robus-deploy/applied.txt
echo "== appareils par état (depuis)"; psql "$U" -P pager=off -c "select statut, count(*), min(statut_depuis) as plus_ancien from appareils group by statut order by 1"
echo "== historique des états"; psql "$U" -tAc "select count(*) || ' périodes, ' || count(*) filter (where fin is null) || ' ouvertes, ' || count(*) filter (where estime=1) || ' estimées' from appareil_etats"
echo "== déclencheurs"; psql "$U" -tAc "select tgname from pg_trigger where tgname like 'robus_appareil_etat%' order by 1"
echo "== pages"; for p in /responsable/appareils "/responsable/appareils?f=arret" "/responsable/appareils?vue=tableau"; do curl -s -o /dev/null -w "$p %{http_code}\n" "http://localhost:3000$p"; done
echo "== vitesse (avec session)"; node --input-type=module <<'JS'
import "dotenv/config";
import postgres from "postgres";
import { encode } from "@auth/core/jwt";
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const [u] = await sql`select id, nom, email, role from users where role='administrateur' and actif=1 limit 1`;
const [a] = await sql`select id from appareils order by (statut in ('en_panne','hors_service')) desc, created_at limit 1`;
const ck = ["authjs.session-token", "__Secure-authjs.session-token"];
const parts = [];
for (const salt of ck) parts.push(`${salt}=${await encode({ token: { sub: u.id, id: u.id, role: u.role, name: u.nom, email: u.email }, secret: process.env.AUTH_SECRET, salt, maxAge: 600 })}`);
const pages = ["/responsable/appareils", "/responsable/appareils?vue=tableau"];
if (a) pages.push(`/responsable/appareils/${a.id}`, `/responsable/appareils/${a.id}?tab=modifier`);
for (const p of pages) {
  const t = [];
  let code = 0, erreur = false;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const r = await fetch("http://localhost:3000" + p, { headers: { cookie: parts.join("; "), "x-forwarded-proto": "https" }, redirect: "manual" });
    const txt = await r.text(); code = r.status; erreur = erreur || /couldn.t load|Application error/.test(txt);
    t.push(performance.now() - t0);
  }
  t.sort((x, y) => x - y);
  console.log(`  ${Math.round(t[1])} ms  ${code}${erreur ? " ERREUR" : ""}  ${p}`);
}
await sql.end();
JS
echo "== erreurs récentes"; tail -n 300 /root/.pm2/logs/robus-dashboard-error.log | grep -E "⨯|Error" | grep -vE "UnknownAction|UntrustedHost|Server Reference|Failed to find Server Action|existe déjà|Commencez la mission" | tail -8
date
