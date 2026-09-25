# Correctif : nginx n'ecoute pas en IPv6 alors que robuswork.tech a une adresse IPv6 (AAAA)
set -u
F=$(grep -l "server_name robuswork.tech" /etc/nginx/sites-enabled/* | head -1); F=$(readlink -f $F)
echo "Fichier: $F"
cp -a $F /root/robus-deploy/nginx-robuswork.bak-$(date +%Y%m%d%H%M%S)
cp -a $F /tmp/nginx-before
grep -q "listen \[::\]:443" $F || sed -i 's/^\(\s*\)listen 443 ssl;\(.*\)$/\1listen 443 ssl;\2\n\1listen [::]:443 ssl;/' $F
grep -q "listen \[::\]:80" $F || sed -i 's/^\(\s*\)listen 80;$/\1listen 80;\n\1listen [::]:80;/' $F
echo "--- diff"; diff /tmp/nginx-before $F
if nginx -t 2>&1; then
  systemctl reload nginx; sleep 2
  echo "--- tests"
  curl -4 -s -o /dev/null -w "IPv4 %{http_code}\n" --max-time 8 https://robuswork.tech/connexion
  C6=$(curl -6 -s -o /dev/null -w "%{http_code}" --max-time 8 https://robuswork.tech/connexion); echo "IPv6 $C6"
  curl -6 -s -o /dev/null -w "IPv6 http->https %{http_code}\n" --max-time 8 http://robuswork.tech/
  ss -ltn | grep -E ":80|:443"
  if [ "$C6" != 200 ]; then echo "IPv6 toujours KO -> pas de retour arriere necessaire (IPv4 intact)"; fi
else
  echo "nginx -t ECHEC -> restauration"; cp -a /tmp/nginx-before $F; nginx -t && systemctl reload nginx
fi
