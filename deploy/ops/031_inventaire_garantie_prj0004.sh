# Inventaire (LECTURE SEULE) avant suppression : garantie du projet PRJ-2026-0004 et tout ce qui y est lié.
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
q() { psql "$U" -P pager=off -v ON_ERROR_STOP=1 -c "$1"; }
echo "== projet"; q "select id, reference, nom, statut, created_at from projets where reference='PRJ-2026-0004'"
echo "== garantie(s) du projet"; q "select g.id, g.date_debut::date, g.date_fin::date, g.interventions_inclues, g.interventions_restantes from garanties g join projets p on p.id=g.projet_id where p.reference='PRJ-2026-0004'"
echo "== passages"; q "select gp.numero, gp.total, a.numero_interne, gp.date_prevue::date, gp.statut, gp.intervention_id from garantie_passages gp join garanties g on g.id=gp.garantie_id join projets p on p.id=g.projet_id join appareils a on a.id=gp.appareil_id where p.reference='PRJ-2026-0004' order by gp.numero"
echo "== toutes les missions du projet"; q "select i.id, i.type, i.statut, i.date_prevue, u.nom as technicien, (i.id in (select intervention_id from garantie_passages where intervention_id is not null)) as liee_garantie from interventions i join projets p on p.id=i.projet_id left join users u on u.id=i.technicien_id where p.reference='PRJ-2026-0004' order by i.date_prevue nulls last"
echo "== autres éléments du projet"
q "select (select count(*) from prestations x join projets p on p.id=x.projet_id where p.reference='PRJ-2026-0004') prestations, (select count(*) from projet_techniciens x join projets p on p.id=x.projet_id where p.reference='PRJ-2026-0004') techniciens, (select count(*) from projet_appareils x join projets p on p.id=x.projet_id where p.reference='PRJ-2026-0004') appareils" 2>&1 | head -8
echo "== tables qui référencent interventions (lignes liées aux missions du projet)"
psql "$U" -At -c "select c.conrelid::regclass, a.attname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey) where c.contype='f' and c.confrelid='interventions'::regclass" | while IFS='|' read t col; do
  n=$(psql "$U" -At -c "select count(*) from $t where $col in (select i.id from interventions i join projets p on p.id=i.projet_id where p.reference='PRJ-2026-0004')")
  [ "$n" != "0" ] && echo "  $t.$col : $n"
done
echo "== fin (rien n'a été modifié)"
