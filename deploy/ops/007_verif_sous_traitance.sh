cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "Acces role applicatif :"; psql "$U" -tAc "select count(*) from heures_sous_traitance" 2>&1
psql "$U" -tAc "select unnest(enum_range(null::type_client))" 2>&1 | tr '\n' ' '; echo
for p in /technicien/heures /responsable/sous-traitance /api/export/sous-traitance; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://robuswork.tech$p)"; done
