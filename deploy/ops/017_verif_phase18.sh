# Vérification Phase 18 (lecture seule)
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== tables (rôle robus)"; for t in mission_journal observateurs observateur_appareils signalements_panne parametres; do echo "$t $(psql "$U" -tAc "select count(*) from $t" 2>&1)"; done
echo "== rôle observateur"; psql "$U" -tAc "select enum_range(null::role)"
echo "== colonnes"; psql "$U" -tAc "select count(*) from information_schema.columns where table_name in ('interventions','rapports','appareils','documents_formations','enquetes_satisfaction') and column_name in ('validee_le','validee_par_id','modifie_le','nb_modifications','qr_code','visible_observateur','auteur_id')"
echo "== pages"; for p in /connexion /a/inconnu1234 /observateur /responsable/observateurs; do curl -s -o /dev/null -w "$p %{http_code} %{time_total}s\n" http://localhost:3000$p; done
echo "== module qrcode"; node -e "require('qrcode');console.log('qrcode OK')"
echo "== pm2"; pm2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{for(const p of JSON.parse(d))console.log(p.name,p.pm2_env.status)})"
echo "== erreurs récentes"; tail -n 200 /root/.pm2/logs/robus-dashboard-error.log | grep -E "⨯|Error" | grep -vE "UnknownAction|UntrustedHost|Server Reference|Failed to find Server Action|existe déjà" | tail -10
date
