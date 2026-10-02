# Mesure de la vitesse du serveur (lecture seule) — référence avant optimisation Phase 21.
cd /var/www/robus-app
echo "== commit"; git log --oneline -1
echo "== machine"; nproc; free -m | head -2; uptime
echo "== pm2"; pm2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{for(const p of JSON.parse(d))console.log(p.name,p.pm2_env.status,'mem',Math.round(p.monit.memory/1048576)+'Mo','cpu',p.monit.cpu+'%','restarts',p.pm2_env.restart_time,'mode',p.pm2_env.exec_mode)})"
echo "== base"; U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'); psql "$U" -tAc "select 'interventions', count(*) from interventions union all select 'journal', count(*) from journal_activite union all select 'users', count(*) from users"
echo "== pages (temps serveur médian, sans réseau)"; node deploy/outils/mesure-vitesse.mjs http://localhost:3000 2>&1 | tail -30
echo "== via nginx + https (depuis le serveur)"; for p in /connexion /logo-robus.png; do curl -s -o /dev/null -w "$p %{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s taille=%{size_download}\n" https://robuswork.tech$p; done
echo "== compression nginx"; curl -s -o /dev/null -D - -H "Accept-Encoding: gzip, br" https://robuswork.tech/connexion | grep -iE "content-encoding|cache-control" 
date
