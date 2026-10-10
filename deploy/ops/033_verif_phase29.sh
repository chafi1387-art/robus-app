# Vérification Phase 29 (lecture seule) : missions « à la carte » liées à une prestation.
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== migration"; grep -E "0025" /root/robus-deploy/applied.txt
echo "== structure (rôle robus)"; psql "$U" -P pager=off -c "select column_name, is_nullable from information_schema.columns where table_name='interventions' and column_name in ('appareil_id','prestation_id') order by 1"
psql "$U" -P pager=off -tAc "select conname from pg_constraint where conname in ('interventions_cible_chk','interventions_prestation_id_fk') order by 1"
echo "== missions existantes"; psql "$U" -P pager=off -c "select count(*) filter (where appareil_id is not null) as sur_appareil, count(*) filter (where prestation_id is not null) as sur_prestation, count(*) as total from interventions"
echo "== pages"; for p in /connexion /responsable/projets /responsable/interventions /technicien /observateur; do curl -s -o /dev/null -w "$p %{http_code}\n" "http://localhost:3000$p"; done
echo "== vitesse (avec session)"; node --input-type=module <<'JS'
import "dotenv/config";
import postgres from "postgres";
import { encode } from "@auth/core/jwt";
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const [u] = await sql`select id, nom, email, role from users where role='administrateur' and actif=1 limit 1`;
const [pj] = await sql`select id from projets order by created_at desc limit 1`;
const ck = ["authjs.session-token", "__Secure-authjs.session-token"];
const parts = [];
for (const salt of ck) parts.push(`${salt}=${await encode({ token: { sub: u.id, id: u.id, role: u.role, name: u.nom, email: u.email }, secret: process.env.AUTH_SECRET, salt, maxAge: 600 })}`);
const pages = ["/responsable", "/responsable/interventions", "/responsable/interventions?vue=projet"];
if (pj) pages.push(`/responsable/projets/${pj.id}?tab=missions`);
for (const p of pages) {
  const t0 = performance.now();
  const r = await fetch("http://localhost:3000" + p, { headers: { cookie: parts.join("; "), "x-forwarded-proto": "https" }, redirect: "manual" });
  const txt = await r.text();
  const erreur = /couldn.t load|Application error|pas pu aboutir/.test(txt);
  const choix = p.includes("tab=missions") ? (txt.includes("Une prestation") ? "  [choix Appareil | Prestation présent]" : "  [choix ABSENT]") : "";
  console.log(`  ${Math.round(performance.now() - t0)} ms  ${r.status}${erreur ? " ERREUR" : ""}  ${p}${choix}`);
}
await sql.end();
JS
echo "== pm2"; pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s))console.log(p.name,p.pm2_env.status,"restarts",p.pm2_env.restart_time)})'
echo "== erreurs récentes"; tail -n 300 /root/.pm2/logs/robus-dashboard-error.log | grep -E "⨯|Error" | grep -vE "UnknownAction|UntrustedHost|Server Reference|Failed to find Server Action|existe déjà|Commencez la mission" | tail -8
date
