# Diagnostic (lecture seule) : échecs « update appareils » à la modification d'une fiche appareil.
LOG=/root/.pm2/logs/robus-dashboard-error.log
echo "== occurrences"; grep -c 'Failed query: update "appareils"' "$LOG"
echo "== contexte (cause PostgreSQL)"
grep -n -A 25 'Failed query: update "appareils"' "$LOG" | grep -iE "Failed query|params|code:|detail|constraint|message|severity|column|routine|cause|duplicate|violates|invalid|overflow|out of range" | sed -E 's/(params: )([^,]*),/\1[n°],/' | tail -40
echo "== horodatage approximatif (journal pm2 avec dates ?)"
ls -la --time-style=full-iso "$LOG"
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== modifications de fiche réussies récentes"; psql "$U" -P pager=off -c "select created_at, entite_id from journal_activite where entite='appareil' and action='modification_fiche' order by created_at desc limit 5"
echo "== types numériques"; psql "$U" -P pager=off -c "select column_name, data_type, numeric_precision, numeric_scale from information_schema.columns where table_name='appareils' and column_name in ('charge_kg','vitesse_ms','niveaux','annee_installation')"
date
