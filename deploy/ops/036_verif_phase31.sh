# Vérification Phase 31 (lecture seule) : fenêtre Affecter, annulation/suppression,
# correction des noms, missions sur plusieurs jours.
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== migration"; grep -E "0027" /root/robus-deploy/applied.txt
echo "== colonnes (rôle robus)"
psql "$U" -P pager=off -tAc "select column_name, data_type from information_schema.columns where table_name='interventions' and column_name in ('date_fin_prevue','weekend_inclus') order by 1"
psql "$U" -P pager=off -tAc "select count(*) as missions, count(date_fin_prevue) as multi_jours from interventions"
echo "== pages"; for p in /connexion /responsable/interventions /responsable/utilisateurs /technicien; do curl -s -o /dev/null -w "$p %{http_code}\n" "http://localhost:3000$p"; done
echo "== erreurs récentes"; tail -n 300 /root/.pm2/logs/robus-dashboard-error.log 2>/dev/null | grep -i "error" | tail -5
echo "== pm2"; pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s))console.log(p.name,p.pm2_env.status)})'
date
