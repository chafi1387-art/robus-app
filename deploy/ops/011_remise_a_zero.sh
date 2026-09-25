# Remise à zéro demandée par l'utilisateur (25/09/2026) : tout supprimer sauf le compte administrateur.
set -e
ADMIN='chafi.amine@outlook.com'
P="sudo -u postgres psql -d robus_dashboard -v ON_ERROR_STOP=1"
N=$($P -tAc "select count(*) from users where email='$ADMIN' and role='administrateur' and actif=1")
[ "$N" = 1 ] || { echo "ARRET: compte admin $ADMIN introuvable, rien n'a été supprimé"; exit 1; }
TS=$(date +%Y%m%d-%H%M%S); B=/root/backups; mkdir -p $B
sudo -u postgres pg_dump robus_dashboard | gzip > $B/avant-remise-a-zero-$TS.sql.gz
tar czf $B/uploads-avant-remise-a-zero-$TS.tgz -C /var/www/robus-app/public uploads
ls -la $B | tail -3
TABLES=$($P -tAc "select string_agg(format('%I',tablename), ', ') from pg_tables where schemaname='public' and tablename <> 'users'")
$P <<SQL
BEGIN;
TRUNCATE $TABLES RESTART IDENTITY CASCADE;
DELETE FROM users WHERE email <> '$ADMIN';
COMMIT;
SQL
# Fichiers : photos/documents de test (sauvegardés ci-dessus)
find /var/www/robus-app/public/uploads -type f -delete
echo "== Après remise à zéro"
$P -tAc "select email, role from users"
for t in $($P -tAc "select tablename from pg_tables where schemaname='public' order by 1"); do n=$($P -tAc "select count(*) from \"$t\""); [ "$n" != 0 ] && echo "$t $n"; done
echo "fichiers uploads: $(find /var/www/robus-app/public/uploads -type f | wc -l)"
echo "connexion: $(curl -s -o /dev/null -w '%{http_code}' https://robuswork.tech/connexion)"
