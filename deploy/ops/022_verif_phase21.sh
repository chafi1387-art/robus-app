# Vérification Phase 21 (lecture seule) + mesure de vitesse après optimisation.
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== migration"; grep -c 0018 /root/robus-deploy/applied.txt
echo "== colonnes"; psql "$U" -tAc "select count(*) from information_schema.columns where (table_name='interventions' and column_name in ('refusee_le','refus_motif')) or (table_name='heures_sous_traitance' and column_name in ('heure_debut','heure_fin','pause_minutes')) or (table_name='formations_participants' and column_name in ('reponse','emarge_le'))"
echo "== tables"; for t in signalements formations_sessions formations_participants; do echo "$t $(psql "$U" -tAc "select count(*) from $t" 2>&1)"; done
echo "== catégorie formation"; psql "$U" -tAc "select 'formation' = any(enum_range(null::categorie_document)::text[])"
echo "== cron"; S=$(grep -E '^CRON_SECRET=' .env | cut -d= -f2- | tr -d '"'); curl -s -X POST -H "x-cron-secret: $S" http://localhost:3000/api/cron/retards; echo
echo "== logo public"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/logo-robus.png
echo "== vitesse"; node deploy/outils/mesure-vitesse.mjs http://localhost:3000 2>&1 | tail -25
echo "== erreurs récentes"; tail -n 200 /root/.pm2/logs/robus-dashboard-error.log | grep -E "⨯|Error" | grep -vE "UnknownAction|UntrustedHost|Server Reference|Failed to find Server Action|existe déjà" | tail -10
date
