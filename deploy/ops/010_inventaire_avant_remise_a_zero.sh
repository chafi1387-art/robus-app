# Lecture seule : inventaire avant remise à zéro
echo "== Comptes utilisateurs"; sudo -u postgres psql -d robus_dashboard -tAc "select email, role, nom, actif from users order by role, email"
echo "== Lignes par table (non vides)"; sudo -u postgres psql -d robus_dashboard -tAc "select relname, n_live_tup from pg_stat_user_tables where n_live_tup>0 order by relname"
for t in $(sudo -u postgres psql -d robus_dashboard -tAc "select tablename from pg_tables where schemaname='public' order by 1"); do n=$(sudo -u postgres psql -d robus_dashboard -tAc "select count(*) from \"$t\""); [ "$n" != 0 ] && echo "$t $n"; done
echo "== Fichiers uploads"; find /var/www/robus-app/public/uploads -type f | wc -l; du -sh /var/www/robus-app/public/uploads
echo "== Espace disque"; df -h / | tail -1
