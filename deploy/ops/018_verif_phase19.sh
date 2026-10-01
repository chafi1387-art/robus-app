# Vérification Phase 19 (lecture seule)
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== tables (rôle robus)"; for t in rapport_versions mission_notes habilitations_catalogue formations_sessions formations_participants garantie_passages; do echo "$t $(psql "$U" -tAc "select count(*) from $t" 2>&1)"; done
echo "== garanties -> passages"; psql "$U" -P pager=off -c "select g.id::text as garantie, g.interventions_inclues as n, count(gp.*) as passages, count(gp.*) filter (where gp.statut='realise') as realises, min(gp.date_prevue)::date as premier from garanties g left join garantie_passages gp on gp.garantie_id=g.id group by g.id"
echo "== règles garantie actives (doit être 0)"; psql "$U" -tAc "select count(*) from regles_planification where garantie_id is not null and actif=1"
echo "== habilitations"; psql "$U" -tAc "select statut, count(*) from habilitations_technicien group by statut"
echo "== cron"; S=$(grep -E '^CRON_SECRET=' .env | cut -d= -f2- | tr -d '"'); curl -s -X POST -H "x-cron-secret: $S" http://localhost:3000/api/cron/retards; echo
echo "== pages"; for p in /responsable/habilitations /api/export/matrice-competences /connexion; do curl -s -o /dev/null -w "$p %{http_code}\n" http://localhost:3000$p; done
echo "== pm2"; pm2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{for(const p of JSON.parse(d))console.log(p.name,p.pm2_env.status)})"
echo "== erreurs récentes"; tail -n 200 /root/.pm2/logs/robus-dashboard-error.log | grep -E "⨯|Error" | grep -vE "UnknownAction|UntrustedHost|Server Reference|Failed to find Server Action|existe déjà" | tail -10
date
