s(){ echo; echo "########## $*"; }
L(){ zcat -f /var/log/nginx/access.log* 2>/dev/null; }
s "Config nginx robuswork.tech"; cat /etc/nginx/sites-enabled/* | grep -vE "^\s*#" | grep -v "^\s*$"
s "Ports ecoutes"; ss -ltnp | grep -E ":80|:443|:3000"
s "Adresses IP du serveur"; ip -br addr
s "Test IPv4 / IPv6 depuis le serveur"; curl -4 -s -o /dev/null -w "IPv4 %{http_code}\n" --max-time 8 https://robuswork.tech/connexion; curl -6 -s -o /dev/null -w "IPv6 %{http_code}\n" --max-time 8 https://robuswork.tech/connexion; curl -6 -skv --max-time 8 https://robuswork.tech/connexion 2>&1 | grep -iE "subject|issuer|HTTP/|connected" | head
s "Clients IPv6 dans les logs"; L | awk '$1 ~ /:/' | awk '{print $1,$4,$7,$9}' | tail -20
s "Toutes les requetes iPhone/Android vers /connexion ou /technicien (hors IP bureau), 14 j"
L | grep -E "iPhone|Android" | grep -E '"(GET|POST) /(connexion|technicien)' | awk '{print $4,$1,$6,$7,$9}' | sort | tail -60
s "Chronologie 22/09 22:45-23:10"; L | grep "22/Sep/2026:2[23]:[0-5]" | grep -vE "_next/static|\.png|\.ico|\.woff" | grep -E "iPhone|Android" | awk '{print $4,$1,$6,$7,$9}' | sort
s "Server names / default"; grep -rn "server_name\|default_server" /etc/nginx/sites-enabled/
