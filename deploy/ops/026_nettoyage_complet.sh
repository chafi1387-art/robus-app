# Nettoyage complet demandé par Chafi (02/10/2026) : on repart de zéro pour
# saisir les vrais scénarios de l'entreprise. On garde UNIQUEMENT les comptes
# administrateur (et leurs notifications). Sauvegarde complète avant, dans
# /root/robus-backups (non public) — restauration possible.
set -e
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
D=$(date +%Y%m%d-%H%M%S)
B=/root/robus-backups
mkdir -p $B && chmod 700 $B

echo "== 1. Sauvegarde"
pg_dump "$U" --no-owner --no-privileges | gzip > $B/base-avant-nettoyage-$D.sql.gz
tar czf $B/uploads-avant-nettoyage-$D.tar.gz -C public uploads 2>/dev/null || true
ls -la $B | tail -3
# Vérification de la sauvegarde avant de toucher à quoi que ce soit.
test $(zcat $B/base-avant-nettoyage-$D.sql.gz | grep -c "CREATE TABLE") -gt 20

echo "== 2. Comptes conservés"
psql "$U" -tAc "select email || ' (' || role || ')' from users where role = 'administrateur'"
test $(psql "$U" -tAc "select count(*) from users where role = 'administrateur' and actif = 1") -ge 1

echo "== 3. Suppression des données"
TABLES=$(psql "$U" -tAc "select string_agg(format('%I', table_name), ', ') from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name not in ('users', 'push_abonnements')")
psql "$U" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
TRUNCATE $TABLES CASCADE;
DELETE FROM push_abonnements WHERE user_id IN (SELECT id FROM users WHERE role <> 'administrateur');
DELETE FROM users WHERE role <> 'administrateur';
COMMIT;
SQL

echo "== 4. Fichiers envoyés (photos, certificats, documents)"
find public/uploads -type f -delete 2>/dev/null || true
find public/uploads -type f | wc -l

echo "== 5. Contrôle"
psql "$U" -P pager=off -c "select email, role from users"
psql "$U" -tAc "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1" | while read t; do n=$(psql "$U" -tAc "select count(*) from \"$t\""); [ "$n" != "0" ] && echo "reste : $t $n"; done
echo "== pages"; for p in /connexion /responsable; do curl -s -o /dev/null -w "$p %{http_code}\n" http://localhost:3000$p; done
date
