echo "== pm2 erreurs récentes (hors bots)"; grep -v "UnknownAction\|UntrustedHost" /root/.pm2/logs/robus-dashboard-error.log | grep -vE "^\s+at " | tail -60
echo "== nginx POST 500 récents"; zcat -f /var/log/nginx/access.log* | awk '$9>=500' | tail -20
echo "== date serveur"; date
