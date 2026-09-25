cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
psql "$U" -tAc "select count(type_projet) from projets; select count(poste) from technicien_fiches" 2>&1
for p in /connexion /responsable/projets/nouveau /responsable/techniciens /technicien/heures; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://robuswork.tech$p)"; done
curl -s https://robuswork.tech/connexion | grep -o '/_next/static/media/[^"]*woff2' | head -2
pm2 jlist | python3 -c "import json,sys;[print(p['name'],p['pm2_env']['status'],p['monit']['memory']//1000000,'MB') for p in json.load(sys.stdin)]"
