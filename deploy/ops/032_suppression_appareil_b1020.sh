# Suppression demandée par Chafi (08/10/2026) : appareil « B1020-1 HOME LIFT », toutes ses missions,
# et la garantie du projet PRJ-2026-0004. Client et projet conservés. Sauvegarde complète avant.
# Tout se fait dans UNE transaction : à la moindre erreur, rien n'est modifié.
set -e
cd /var/www/robus-app
U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
D=$(date +%Y%m%d-%H%M%S); mkdir -p /root/robus-backups
sudo -u postgres pg_dump robus_dashboard | gzip > /root/robus-backups/base-avant-suppr-b1020-$D.sql.gz
echo "== sauvegarde : /root/robus-backups/base-avant-suppr-b1020-$D.sql.gz ($(stat -c %s /root/robus-backups/base-avant-suppr-b1020-$D.sql.gz) octets)"
psql "$U" -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
\set QUIET on
begin;
create temp table cible_app as select id from appareils where numero_interne = 'B1020-1 HOME LIFT';
create temp table cible_gar as select g.id from garanties g join projets p on p.id = g.projet_id where p.reference = 'PRJ-2026-0004';
create temp table cible_mis as select id from interventions where appareil_id in (select id from cible_app)
  union select intervention_id from garantie_passages where garantie_id in (select id from cible_gar) and intervention_id is not null;
create temp table bilan (quoi text, n int);
\set QUIET off
select (select count(*) from cible_app) appareils, (select count(*) from cible_gar) garanties, (select count(*) from cible_mis) missions;
do $$
declare r record; n int; s text;
begin
  if (select count(*) from cible_app) <> 1 or (select count(*) from cible_gar) <> 1 then raise exception 'cible inattendue'; end if;
  -- 1. Stock : on annule les mouvements des missions (sortie → remise en stock), puis on les supprime
  update pieces p set quantite_stock = p.quantite_stock + x.delta from (
    select piece_id, sum(case when type::text = 'entree' then -quantite else quantite end) delta
    from mouvements_stock where intervention_id in (select id from cible_mis) group by piece_id) x where x.piece_id = p.id;
  delete from mouvements_stock where intervention_id in (select id from cible_mis);
  get diagnostics n = row_count; insert into bilan values ('mouvements_stock (stock remis)', n);
  -- 2. Tout ce qui est rattaché aux missions
  for r in select c.conrelid::regclass t, a.attname col from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
           where c.contype='f' and c.confrelid='interventions'::regclass and c.conrelid::regclass::text not in ('garantie_passages') loop
    execute format('delete from %s where %I in (select id from cible_mis)', r.t, r.col); get diagnostics n = row_count;
    if n > 0 then insert into bilan values (r.t||' (missions)', n); end if;
  end loop;
  update garantie_passages set intervention_id = null where intervention_id in (select id from cible_mis);
  delete from interventions where id in (select id from cible_mis); get diagnostics n = row_count; insert into bilan values ('interventions (missions)', n);
  -- 3. La garantie (ses passages suivent)
  delete from garanties where id in (select id from cible_gar); get diagnostics n = row_count; insert into bilan values ('garanties', n);
  -- 4. Ce qui est rattaché à l'appareil (sauf projets/prestations/sites/clients, qui restent)
  for r in select c.conrelid::regclass t, a.attname col, c.confdeltype d from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
           where c.contype='f' and c.confrelid='appareils'::regclass and c.conrelid::regclass::text not in ('projets','prestations','sites','clients') loop
    if r.d <> 'c' then
      execute format('delete from %s where %I in (select id from cible_app)', r.t, r.col); get diagnostics n = row_count;
      if n > 0 then insert into bilan values (r.t||' (appareil)', n); end if;
    end if;
  end loop;
  delete from appareils where id in (select id from cible_app); get diagnostics n = row_count; insert into bilan values ('appareils', n);
end $$;
select * from bilan;
commit;
select (select count(*) from appareils where numero_interne='B1020-1 HOME LIFT') appareil_restant,
       (select count(*) from garanties g join projets p on p.id=g.projet_id where p.reference='PRJ-2026-0004') garantie_restante,
       (select count(*) from projets where reference='PRJ-2026-0004') projet_conserve;
SQL
for p in /connexion /responsable/projets; do curl -s -o /dev/null -w "$p %{http_code}\n" "http://localhost:3000$p"; done
