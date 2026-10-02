# Vérification Phase 22 (lecture seule) : QR technicien + recherche d'appareil.
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== jsqr installé"; ls node_modules/jsqr/package.json && node -e "console.log(require('jsqr/package.json').version)"
echo "== appareils avec QR"; psql "$U" -tAc "select count(*) filter (where qr_code is not null) || '/' || count(*) from appareils"
echo "== réglages"; psql "$U" -tAc "select coalesce((select valeur from parametres where cle='acces_technicien_appareils'), 'défaut : tous les appareils, toutes les informations sauf notes internes')"
echo "== pages"; for p in /technicien/appareils /responsable/techniciens/acces-appareils; do curl -s -o /dev/null -w "$p %{http_code}\n" http://localhost:3000$p; done
echo "== vitesse"; node deploy/outils/mesure-vitesse.mjs http://localhost:3000 2>&1 | grep -E "technicien|Technicien" | head -12
echo "== erreurs récentes"; tail -n 200 /root/.pm2/logs/robus-dashboard-error.log | grep -E "⨯|Error" | grep -vE "UnknownAction|UntrustedHost|Server Reference|Failed to find Server Action|existe déjà" | tail -10
date
