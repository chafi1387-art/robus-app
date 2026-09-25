# Diagnostic lecture seule : connexions refusees par intermittence (technicien / telephone)
s(){ echo; echo "########## $*"; }
s SYSTEME; uptime; free -m; df -h / | tail -1; nproc
s PM2; pm2 jlist | python3 -c "import json,sys;[print(p['name'],'restarts',p['pm2_env']['restart_time'],'mem',p['monit']['memory']//1000000,'MB') for p in json.load(sys.stdin)]"
s "OOM / processus tues (7 j)"; journalctl -k --since "7 days ago" --no-pager 2>/dev/null | grep -iE "out of memory|killed process|oom" | tail -20; dmesg -T 2>/dev/null | grep -iE "killed process|oom" | tail -10
s "PM2 erreurs (200 dernieres lignes)"; tail -200 /root/.pm2/logs/robus-dashboard-error.log
s "PM2 erreurs : types les plus frequents"; grep -hoiE "Failed to find Server Action|permission denied[^\"]*|ECONNREFUSED|too many clients|timeout[^\"]{0,40}|UntrustedHost|JWTSessionError|CSRF[^\"]{0,40}|MissingCSRF|Error: [A-Za-z ]{0,60}" /root/.pm2/logs/robus-dashboard-error.log* 2>/dev/null | sort | uniq -c | sort -rn | head -25
s "NGINX /connexion par code HTTP"; zcat -f /var/log/nginx/access.log* 2>/dev/null | grep -E '"(GET|POST) /connexion' | awk '{print $9}' | sort | uniq -c
s "NGINX POST /connexion non-303 (50 derniers)"; zcat -f /var/log/nginx/access.log* 2>/dev/null | grep '"POST /connexion' | awk '$9!=303' | tail -50
s "NGINX codes 4xx/5xx par jour"; zcat -f /var/log/nginx/access.log* 2>/dev/null | awk '$9>=400{split($4,a,":");print substr(a[1],2),$9}' | sort | uniq -c | tail -40
s "NGINX codes 429/444/503 recents"; zcat -f /var/log/nginx/access.log* 2>/dev/null | awk '$9==429||$9==444||$9==503||$9==502||$9==504' | tail -30
s "NGINX error.log"; tail -60 /var/log/nginx/error.log
s "NGINX config (limites)"; grep -rnE "limit_req|limit_conn|deny|allow|proxy_read_timeout|client_max_body" /etc/nginx/ 2>/dev/null
s "Pare-feu / fail2ban"; ufw status 2>/dev/null; fail2ban-client status 2>/dev/null; iptables -S 2>/dev/null | head -30
s "POSTGRES erreurs"; tail -300 /var/log/postgresql/postgresql-16-main.log 2>/dev/null | grep -iE "error|fatal" | tail -30
s "AUTH env (noms seulement)"; grep -oE "^[A-Z_]+" .env
