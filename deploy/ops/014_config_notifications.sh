# Phase 16 : clés VAPID + secret du cron dans .env (une seule fois), puis cron des retards.
set -e
cd /var/www/robus-app
if ! grep -q '^VAPID_PUBLIC_KEY=' .env; then
  node -e "const w=require('web-push');const k=w.generateVAPIDKeys();console.log('VAPID_PUBLIC_KEY='+k.publicKey);console.log('VAPID_PRIVATE_KEY='+k.privateKey)" >> .env
  echo 'VAPID_SUBJECT=mailto:admin@robuslift.be' >> .env
  echo "clés VAPID ajoutées"
else echo "clés VAPID déjà présentes"; fi
if ! grep -q '^CRON_SECRET=' .env; then echo "CRON_SECRET=$(openssl rand -hex 24)" >> .env; echo "secret cron ajouté"; fi
chmod 600 .env
pm2 restart robus-dashboard --update-env >/dev/null && sleep 6
cat > /root/robus-deploy/cron-retards.sh <<'SH'
#!/bin/bash
S=$(grep -E '^CRON_SECRET=' /var/www/robus-app/.env | cut -d= -f2-)
curl -s -m 60 -X POST -H "x-cron-secret: $S" http://localhost:3000/api/cron/retards >> /root/robus-deploy/cron-retards.log 2>&1; echo " $(date '+%F %T')" >> /root/robus-deploy/cron-retards.log
SH
chmod 700 /root/robus-deploy/cron-retards.sh
( crontab -l 2>/dev/null | grep -v cron-retards.sh || true; echo "*/15 * * * * /root/robus-deploy/cron-retards.sh" ) | crontab -
echo "== vérifications"
crontab -l | grep cron-retards
/root/robus-deploy/cron-retards.sh; tail -1 /root/robus-deploy/cron-retards.log
for u in /manifest.webmanifest /sw.js /icons/icon-192.png /connexion; do echo "$u $(curl -s -o /dev/null -w '%{http_code} %{content_type}' https://robuswork.tech$u)"; done
curl -s -o /dev/null -w "cron sans secret: %{http_code}\n" -X POST https://robuswork.tech/api/cron/retards
curl -s https://robuswork.tech/technicien/profil -o /dev/null -w "profil (non connecté): %{http_code}\n"
pm2 jlist | python3 -c "import json,sys;[print(p['name'],p['pm2_env']['status']) for p in json.load(sys.stdin)]"
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'); psql "$U" -tAc "select count(*) from push_abonnements"
