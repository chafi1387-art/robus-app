# Vérification Phase 17 (lecture seule)
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== colonnes (rôle robus)"; psql "$U" -P pager=off -c "select count(*) filter (where envoyee_le is not null) envoyees, count(*) filter (where vue_le is not null) vues, count(*) filter (where acceptee_le is not null) acceptees from interventions"
echo "== index"; psql "$U" -Atc "select indexname from pg_indexes where indexname in ('interventions_technicien_date_idx','interventions_projet_idx','journal_activite_entite_idx','push_abonnements_user_idx')"
echo "== cron"; S=$(grep -E '^CRON_SECRET=' .env | cut -d= -f2- | tr -d '"'); curl -s -X POST -H "x-cron-secret: $S" http://localhost:3000/api/cron/retards; echo
echo "== temps de réponse (non connecté)"; for p in /connexion /technicien /responsable; do curl -s -o /dev/null -w "$p %{http_code} %{time_total}s\n" http://localhost:3000$p; done
echo "== pm2"; pm2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{for(const p of JSON.parse(d))console.log(p.name,p.pm2_env.status,'restarts',p.pm2_env.restart_time)})"
echo "== erreurs récentes"; tail -n 300 /root/.pm2/logs/robus-dashboard-error.log | grep -E "⨯|Error" | grep -vE "UnknownAction|UntrustedHost|Server Reference|Failed to find Server Action" | tail -10
date
