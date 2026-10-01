# Contrôle des formations planifiées (lecture seule)
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== sessions"; psql "$U" -P pager=off -c "select left(s.id::text,8) id, s.titre, s.date_debut, s.lieu, s.statut, c.nom habilitation, (select count(*) from formations_participants p where p.session_id=s.id) inscrits from formations_sessions s left join habilitations_catalogue c on c.id=s.catalogue_id order by s.created_at desc limit 10"
echo "== inscrits"; psql "$U" -P pager=off -c "select left(p.session_id::text,8) session, u.nom, u.role, p.present, p.resultat, (select count(*) from push_abonnements a where a.user_id=u.id) push from formations_participants p join users u on u.id=p.technicien_id order by 1"
echo "== page"; curl -s -o /dev/null -w "/technicien/formations %{http_code}\n" http://localhost:3000/technicien/formations
date
