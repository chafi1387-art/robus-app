# Vérification Phase 28 (lecture seule) : tableau de bord de direction, dernière connexion.
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== migration"; grep -E "0024" /root/robus-deploy/applied.txt
echo "== dernière connexion"; psql "$U" -P pager=off -c "select role, count(*) as comptes, count(derniere_connexion) as deja_connectes from users where actif = 1 group by 1 order by 1"
echo "== pages"; for p in /responsable; do curl -s -o /dev/null -w "$p %{http_code}\n" "http://localhost:3000$p"; done
echo "== vitesse (avec session)"; node --input-type=module <<'JS'
import "dotenv/config";
import postgres from "postgres";
import { encode } from "@auth/core/jwt";
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const [u] = await sql`select id, nom, email, role from users where role='administrateur' and actif=1 limit 1`;
const ck = ["authjs.session-token", "__Secure-authjs.session-token"];
const parts = [];
for (const salt of ck) parts.push(`${salt}=${await encode({ token: { sub: u.id, id: u.id, role: u.role, name: u.nom, email: u.email }, secret: process.env.AUTH_SECRET, salt, maxAge: 600 })}`);
const pages = ["/responsable", "/responsable/interventions", "/responsable/appareils"];
for (const p of pages) {
  const t = [];
  let code = 0, erreur = false;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const r = await fetch("http://localhost:3000" + p, { headers: { cookie: parts.join("; "), "x-forwarded-proto": "https" }, redirect: "manual" });
    const txt = await r.text(); code = r.status; erreur = erreur || /couldn.t load|Application error/.test(txt);
    t.push(performance.now() - t0);
    if (i === 0 && p === "/responsable") {
      console.log("  sections :", ["Maintenant", "Remplissage de la plateforme", "Fiches complètes", "Équipe", "Parc", "Qualité ISO 9001", "Aujourd"].filter((x) => txt.includes(x)).join(", "));
    }
  }
  t.sort((x, y) => x - y);
  console.log(`  ${Math.round(t[1])} ms  ${code}${erreur ? " ERREUR" : ""}  ${p}`);
}
await sql.end();
JS
echo "== erreurs récentes"; tail -n 300 /root/.pm2/logs/robus-dashboard-error.log | grep -E "⨯|Error" | grep -vE "UnknownAction|UntrustedHost|Server Reference|Failed to find Server Action|existe déjà|Commencez la mission" | tail -8
date
