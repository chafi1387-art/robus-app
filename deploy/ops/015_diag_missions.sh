# Diagnostic : missions non reçues par les techniciens + lenteur profil (lecture seule)
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
q(){ echo "== $1"; psql "$U" -P pager=off -c "$2" 2>&1; }
q "Techniciens (actif, nb abonnements push)" "select left(u.id::text,8) id, u.nom, u.actif, u.role, (select count(*) from push_abonnements p where p.user_id=u.id) push from users u order by u.role, u.nom"
q "20 dernières missions" "select left(i.id::text,8) id, i.created_at at time zone 'UTC' cree, i.statut, i.type, left(i.technicien_id::text,8) tech, i.date_programmee, left(i.projet_id::text,8) projet from interventions i order by i.created_at desc limit 20"
q "Missions sans technicien / sans date (non clôturées)" "select count(*) filter (where technicien_id is null) sans_tech, count(*) filter (where date_programmee is null) sans_date, count(*) total from interventions where statut not in ('terminee','validee','cloturee')"
q "Équipes projet" "select left(pt.projet_id::text,8) projet, left(pt.technicien_id::text,8) tech, pt.role, (select count(*) from interventions i where i.projet_id=pt.projet_id and i.technicien_id=pt.technicien_id) missions_du_tech, (select count(*) from interventions i where i.projet_id=pt.projet_id and i.technicien_id is null) missions_a_affecter from projet_techniciens pt"
q "10 derniers ordres de mission" "select left(projet_id::text,8) projet, left(technicien_id::text,8) tech, created_at at time zone 'UTC' envoye from ordres_mission_envois order by created_at desc limit 10"
echo "== pm2 erreurs mail/push/mission (200 dernières lignes pertinentes)"
grep -iE "mail|smtp|push|vapid|mission|ordre|error" /root/.pm2/logs/robus-dashboard-error.log | grep -vE "^\s+at |UnknownAction|UntrustedHost|Failed to find Server Action" | tail -40
echo "== pm2 out (mail/push)"; grep -iE "mail|smtp|push" /root/.pm2/logs/robus-dashboard-out.log | tail -20
echo "== temps de réponse nginx /technicien (si \$request_time loggé)"; tail -5 /var/log/nginx/access.log | head -2
echo "== charge serveur"; uptime; free -m; nproc
echo "== latence base (10 requêtes simples)"; for i in 1 2 3; do /usr/bin/time -f "%e s" psql "$U" -tAc "select count(*) from interventions" 2>&1 | tr '\n' ' '; echo; done
echo "== taille tables"; psql "$U" -P pager=off -c "select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc limit 12"
date
