# Inventaire (lecture seule) avant le nettoyage complet demandé par Chafi.
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== comptes"; psql "$U" -P pager=off -c "select email, role, actif, created_at::date from users order by role, email"
echo "== lignes par table (non vides)"
psql "$U" -tAc "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1" | while read t; do n=$(psql "$U" -tAc "select count(*) from \"$t\""); [ "$n" != "0" ] && echo "$t $n"; done
echo "== fichiers envoyés"; du -sh public/uploads 2>/dev/null; find public/uploads -type f 2>/dev/null | wc -l
echo "== place disque"; df -h / | tail -1
date
