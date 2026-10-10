# Vérification Phase 30 (lecture seule) : fiche appareil — n° interne 80 caractères, messages clairs.
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== migration"; grep -E "0026" /root/robus-deploy/applied.txt
echo "== colonne"; psql "$U" -P pager=off -tAc "select character_maximum_length from information_schema.columns where table_name='appareils' and column_name='numero_interne'"
echo "== fiches qui ne passeraient pas les nouveaux contrôles (à corriger à la main si > 0)"
psql "$U" -P pager=off -c "select count(*) filter (where annee_installation is not null and (annee_installation < 1900 or annee_installation > 2100)) as annee, count(*) filter (where niveaux is not null and (niveaux < 0 or niveaux > 500)) as niveaux, count(*) filter (where charge_kg is not null and (charge_kg < 0 or charge_kg > 100000)) as charge, count(*) filter (where vitesse_ms is not null and (vitesse_ms < 0 or vitesse_ms > 100)) as vitesse from appareils"
echo "== pages"; for p in /connexion /responsable/appareils; do curl -s -o /dev/null -w "$p %{http_code}\n" "http://localhost:3000$p"; done
echo "== pm2"; pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s))console.log(p.name,p.pm2_env.status)})'
date
