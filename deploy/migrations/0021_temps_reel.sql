-- Phase 25 : mises à jour en temps réel.
-- Chaque ajout / modification / suppression dans les tables suivies envoie
-- un petit signal PostgreSQL (NOTIFY robus_changements) : quelle table,
-- quelle ligne et ses liens (mission, appareil, projet, client, technicien…).
-- L'application l'écoute (LISTEN) et prévient tout de suite les écrans
-- ouverts concernés (bureau, technicien, observateur). Aucune donnée
-- sensible n'est transmise : seulement des identifiants.

CREATE OR REPLACE FUNCTION robus_notifier_changement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN r := to_jsonb(OLD); ELSE r := to_jsonb(NEW); END IF;
  PERFORM pg_notify('robus_changements', json_build_object(
    't', TG_TABLE_NAME,
    'id', r->>'id',
    'i', r->>'intervention_id',
    'a', r->>'appareil_id',
    'p', r->>'projet_id',
    'c', r->>'client_id',
    'u', r->>'technicien_id',
    'd', r->>'demande_id',
    'r', r->>'rapport_id',
    'm', r->>'mission_checklist_id',
    's', r->>'session_id',
    'o', r->>'observateur_id'
  )::text);
  RETURN NULL;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'appareils', 'interventions', 'rapports', 'rapport_photos', 'rapport_versions',
    'mission_journal', 'mission_notes', 'mission_checklists', 'mission_checklist_taches',
    'demandes_client', 'demandes_messages', 'demandes_aide', 'documents_client', 'documents_client_consultations',
    'signalements', 'garantie_passages', 'garanties', 'projets', 'projet_techniciens', 'projet_appareils',
    'prestations', 'prestation_appareils', 'formations_sessions', 'formations_participants', 'habilitations_technicien',
    'mouvements_stock', 'pieces', 'non_conformites', 'heures_sous_traitance', 'clients', 'sites', 'devis',
    'observateurs', 'observateur_appareils', 'enquetes_satisfaction'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS robus_temps_reel ON %I', t);
      EXECUTE format('CREATE TRIGGER robus_temps_reel AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION robus_notifier_changement()', t);
    END IF;
  END LOOP;
END $$;

-- L'état de l'ascenseur suit désormais le rapport du technicien : on aligne
-- les appareils sur le dernier rapport envoyé (s'il est plus récent que la
-- dernière modification manuelle, inconnue ici → on applique seulement si
-- l'appareil est encore « en service » alors que le dernier rapport dit autre chose).
UPDATE appareils a
SET statut = d.statut_final_appareil
FROM (
  SELECT DISTINCT ON (i.appareil_id) i.appareil_id, r.statut_final_appareil
  FROM rapports r
  JOIN interventions i ON i.id = r.intervention_id
  WHERE r.statut_final_appareil IS NOT NULL
  ORDER BY i.appareil_id, r.date_envoi DESC NULLS LAST
) d
WHERE a.id = d.appareil_id
  AND a.statut = 'en_service'
  AND d.statut_final_appareil <> 'en_service';
