# Déploiement automatique

- Le VPS (`/root/robus-deploy/deploy.sh`, cron chaque minute) déploie tout nouveau commit sur `main`.
- Étapes : `git reset --hard` → `npm install` (si package.json/lock changé) → migrations SQL → GRANT → `npm run build` → `pm2 restart robus-dashboard` → `curl /responsable/projets` = 307.
- En cas d'échec : retour automatique au commit précédent (code + `.next`) ; le commit en échec n'est pas retenté.
- Migrations : fichier `.sql` dans `deploy/migrations/` (ex. `0010_xxx.sql`), appliqué une seule fois (`/root/robus-deploy/applied.txt`) en tant que `postgres`, puis GRANT au rôle `robus`.
- Rapport : branche `deploy-status` (`last.txt`, `history.txt`).
- Jamais versionnés : `.env`, `public/uploads/`.
