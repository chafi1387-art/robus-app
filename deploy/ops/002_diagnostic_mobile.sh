s(){ echo; echo "########## $*"; }
L(){ zcat -f /var/log/nginx/access.log* 2>/dev/null; }
s "Requetes non-bot en erreur (iPhone/Android/Mac), 14 derniers jours"
L | grep -E "iPhone|Android|Macintosh" | grep -vE "xmlrpc|wp-|\.php|bot|Jetpack" | awk '$9>=400' | awk '{print $4,$1,$6,$7,$9,$10}' | sort | tail -80
s "POST en 404/400/5xx (actions serveur) hors bots"
L | grep '"POST ' | grep -vE "xmlrpc|wp-|\.php|/api/auth/sign-in" | awk '$9>=400' | awk '{print $4,$1,$7,$9}' | sort | tail -40
s "IP des connexions reussies (POST /connexion suivis de GET /technicien ou /responsable)"
L | grep -E '"GET /(technicien|responsable)' | grep -E "iPhone|Android" | awk '{print $1}' | sort | uniq -c | sort -rn | head
s "Chronologie d'une IP telephone : 22/09 et 25/09"
for ip in $(L | grep -E "iPhone|Android" | grep -E '"(GET|POST) /(connexion|technicien)' | awk '{print $1}' | sort | uniq -c | sort -rn | head -3 | awk '{print $2}'); do echo "== $ip"; L | grep "^$ip " | grep -vE "_next/static|\.png|\.ico|\.svg|\.woff" | awk '{print $4,$6,$7,$9}' | sort | tail -60; done
s "pm2 : lignes avant chaque 'Failed to find Server Action' / UntrustedHost (contexte)"
grep -n -B2 -iE "Failed to find Server Action|did not match the expected|UntrustedHost" /root/.pm2/logs/robus-dashboard-error.log | grep -vE "^\S*-\s+at " | head -40
s "Dates des fichiers de log pm2"; ls -la --time-style=full-iso /root/.pm2/logs/
s "Historique deploiements pm2 restart (dates)"; grep -h "restart\|Starting" /root/.pm2/pm2.log | tail -40
