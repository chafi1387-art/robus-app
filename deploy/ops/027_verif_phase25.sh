# Vérification Phase 25 (lecture seule, sauf un fichier test de 4 octets aussitôt supprimé) :
# temps réel (déclencheurs + flux via nginx), envoi des photos, devis dans la mission, vitesse.
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== migrations"; grep -E "0021|0022" /root/robus-deploy/applied.txt
echo "== déclencheurs temps réel"; psql "$U" -tAc "select count(*) from pg_trigger where tgname='robus_temps_reel'"
echo "== tables Phase 25 (accès rôle robus)"; for t in devis_lignes devis_destinataires mission_passages; do echo "$t $(psql "$U" -tAc "select count(*) from $t" 2>&1)"; done
echo "== colonnes"; psql "$U" -tAc "select count(*) from information_schema.columns where table_name='devis' and column_name in ('intervention_id','mode','document_url','decide_le','travaux_planifies_le')"; psql "$U" -tAc "select column_name from information_schema.columns where table_name='interventions' and column_name='passage'"
echo "== statuts de devis"; psql "$U" -tAc "select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid='statut_devis'::regtype"
echo "== pages"; for p in /responsable/devis /api/temps-reel /api/televersement; do curl -s -o /dev/null -w "$p %{http_code}\n" http://localhost:3000$p; done
curl -s -o /dev/null -w "/devis/lien-invente %{http_code}\n" http://localhost:3000/devis/abcdefghijklmnopqrstuvwxyz012345
echo "== nginx"; F=$(readlink -f $(grep -l "server_name robuswork.tech" /etc/nginx/sites-enabled/* | head -1)); grep -nE "proxy_buffering|proxy_read_timeout|http2|proxy_http_version" "$F" || echo "(réglages par défaut)"
echo "== flux temps réel à travers nginx (https) + envoi d'une photo test"
node --input-type=module <<'JS'
import "dotenv/config";
import postgres from "postgres";
import { encode } from "@auth/core/jwt";
import fs from "node:fs";
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const [u] = await sql`select id, nom, email, role from users where role='administrateur' and actif=1 limit 1`;
const salt = "__Secure-authjs.session-token";
const tok = await encode({ token: { sub: u.id, id: u.id, role: u.role, name: u.nom, email: u.email }, secret: process.env.AUTH_SECRET, salt, maxAge: 600 });
const ck = `${salt}=${tok}`;
const ctrl = new AbortController();
const t0 = Date.now();
let recu = "";
const r = await fetch("https://robuswork.tech/api/temps-reel", { headers: { cookie: ck }, signal: ctrl.signal });
console.log("flux : HTTP", r.status, r.headers.get("content-type"));
const lecteur = r.body.getReader();
const lire = (async () => { try { for (;;) { const { value, done } = await lecteur.read(); if (done) break; recu += new TextDecoder().decode(value); } } catch {} })();
await new Promise((ok) => setTimeout(ok, 1500));
console.log("connexion établie (event: pret) :", recu.includes("event: pret"), `${Date.now() - t0} ms`);
const tNotif = Date.now();
await sql`select pg_notify('robus_changements', ${JSON.stringify({ t: "test_verification" })})`;
for (let i = 0; i < 40 && !recu.includes("test_verification"); i++) await new Promise((ok) => setTimeout(ok, 100));
console.log("signal reçu à travers nginx :", recu.includes("test_verification"), `${Date.now() - tNotif} ms`);
ctrl.abort(); await lire.catch(() => {});
// Envoi d'une photo minuscule par l'API (avec session), puis suppression du fichier.
const fd = new FormData(); fd.set("type", "photo"); fd.set("dossier", "rapports");
fd.set("fichier", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "test.jpg");
const up = await fetch("https://robuswork.tech/api/televersement", { method: "POST", body: fd, headers: { cookie: ck } });
const j = await up.json();
console.log("envoi photo : HTTP", up.status, j.ref ? "référence signée OK" : JSON.stringify(j));
if (j.url && /^\/uploads\/rapports\/u[0-9a-f]{8}-\d+-\d+\.jpg$/.test(j.url)) { fs.unlinkSync("public" + j.url); console.log("fichier test supprimé"); }
const sans = await fetch("https://robuswork.tech/api/televersement", { method: "POST", redirect: "manual" });
console.log("envoi sans session : HTTP", sans.status);
await sql.end();
JS
echo "== vitesse"; node deploy/outils/mesure-vitesse.mjs 2>&1 | tail -25
echo "== pm2"; pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s))console.log(p.name,p.pm2_env.status,"instances:",p.pm2_env.instances??1,"redémarrages:",p.pm2_env.restart_time,"mémoire:",Math.round(p.monit.memory/1048576)+" Mo")})'
echo "== erreurs récentes"; tail -n 300 /root/.pm2/logs/robus-dashboard-error.log | grep -E "⨯|Error|Temps réel" | grep -vE "UnknownAction|UntrustedHost|Server Reference|Failed to find Server Action|existe déjà" | tail -10
date
