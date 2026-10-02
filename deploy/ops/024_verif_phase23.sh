# Vérification Phase 23 (lecture seule) : checklists des missions.
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
echo "== commit"; git log --oneline -1
echo "== tables"; for t in mission_checklists mission_checklist_taches; do echo "$t $(psql "$U" -tAc "select count(*) from $t" 2>&1)"; done
echo "== modèles (actif, tâches)"; psql "$U" -P pager=off -c "select m.nom, m.type_intervention, m.actif, m.version, (select count(*) from checklist_items i where i.modele_id=m.id and i.actif=1) as taches from checklist_modeles m order by m.nom"
echo "== missions non commencées sans checklist"; psql "$U" -tAc "select count(*) from interventions i where i.statut in ('creee','planifiee','affectee') and not exists (select 1 from mission_checklists mc where mc.intervention_id=i.id)"
echo "== pages"; for p in /responsable/checklists; do curl -s -o /dev/null -w "$p %{http_code}\n" http://localhost:3000$p; done
echo "== erreurs récentes"; tail -n 200 /root/.pm2/logs/robus-dashboard-error.log | grep -E "⨯|Error" | grep -vE "UnknownAction|UntrustedHost|Server Reference|Failed to find Server Action|existe déjà" | tail -10
date
