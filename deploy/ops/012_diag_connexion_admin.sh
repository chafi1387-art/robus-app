# Lecture seule : diagnostic connexion administrateur
sudo -u postgres psql -d robus_dashboard -tAc "select email, role, actif, length(password_hash), left(password_hash,4) from users"
echo "== POST /connexion récents"; zcat -f /var/log/nginx/access.log* | grep '"POST /connexion' | awk '{print $4,$1,$9}' | sort | tail -15
echo "== erreurs pm2 récentes"; tail -40 /root/.pm2/logs/robus-dashboard-error.log | grep -vE "^\s+at |UnknownAction|UntrustedHost" | tail -10
date
