# ROBUS — Dashboard Qualité ISO 9001 (Phase 1)

Application web réelle du dashboard de pilotage qualité ROBUS, développée à partir du
cahier des charges. Cette version correspond à la **Phase 1 (Fondations)** du plan de
développement recommandé dans le cahier des charges (section 14) : authentification,
rôles, modèle relationnel Client → Site → Appareil → Intervention, espace Responsable
Qualité et espace Technicien avec rapports simples.

Les phases suivantes (checklists, non-conformités, planning automatique, générateur de
rapports PDF, notifications, stock, audits...) ne sont pas encore développées — voir
"Ce qui n'est pas encore fait" plus bas.

## Ce que contient cette version

- Connexion par email + mot de passe, 4 rôles (Administrateur, Responsable Qualité,
  Technicien, Commercial).
- Modèle relationnel complet : impossible de créer un Site sans Client, un Appareil
  sans Site, une Intervention sans Appareil (contraintes appliquées au niveau de la
  base de données, pas seulement du formulaire).
- Espace Responsable Qualité : tableau de bord (compteurs réels, alertes, planning du
  jour), gestion des clients/sites/appareils, création et suivi des interventions.
- Espace Technicien (accessible depuis un navigateur, ordinateur ou téléphone) : mes
  interventions du jour et à venir, démarrage d'une intervention, formulaire de
  rapport simple, mon profil.
- Couleurs et identité visuelle reprises telles que définies dans le cahier des
  charges (section 2).

## Ce qui n'est pas encore fait

- Score ISO 9001 pondéré par les 7 blocs (section 9 du cahier des charges) — le
  tableau de bord affiche pour l'instant des indicateurs bruts en attendant la Phase 3.
- Checklists de maintenance, non-conformités, planning automatique, notifications,
  documents & formations, stock, audits, générateur de rapports PDF (Phases 2 et 3).
- Mode hors ligne pour les techniciens.

## Faire tourner le projet sur votre ordinateur

Prérequis : Node.js 20 ou plus, et une base PostgreSQL accessible (locale ou distante).

```bash
npm install
cp .env.example .env      # puis renseignez DATABASE_URL et AUTH_SECRET dans .env
npm run db:migrate        # crée les tables dans la base
npm run db:seed           # ajoute des comptes et données de démonstration
npm run dev                # démarre le site sur http://localhost:3000
```

Comptes de démonstration créés par `npm run db:seed` (mot de passe pour tous :
`demo1234`) :

- `responsable@robus.be` — Responsable Qualité
- `technicien@robus.be` — Technicien
- `admin@robus.be` — Administrateur
- `commercial@robus.be` — Commercial

**Important : changez ces mots de passe (ou supprimez ces comptes) avant toute mise en
production réelle.**

## Mettre le site en ligne (accessible depuis Internet)

Cette étape doit se faire chez un hébergeur — ce n'est pas quelque chose qui peut être
fait depuis cette session de travail. Deux façons courantes, de la plus simple à la
plus autonome :

**Option simple — Vercel + une base de données managée (Neon ou Supabase)**
1. Créez un compte sur [vercel.com](https://vercel.com) et importez ce projet (par
   exemple en le poussant d'abord sur GitHub, puis "Import Project" dans Vercel).
2. Créez une base PostgreSQL gratuite sur [neon.com](https://neon.com) ou
   [supabase.com](https://supabase.com) — ils vous donnent une `DATABASE_URL` toute
   prête à copier.
3. Dans les réglages du projet Vercel, ajoutez les variables d'environnement
   `DATABASE_URL`, `AUTH_SECRET` (générez-en une nouvelle) et `NEXTAUTH_URL` (l'adresse
   que Vercel vous attribue).
4. Lancez `npm run db:migrate` une fois (depuis votre ordinateur, en pointant vers la
   base de production) pour créer les tables, puis `npm run db:seed` si vous voulez des
   comptes de démonstration, ou créez vos vrais comptes directement en base.

**Option autonome — un serveur privé (VPS)**, comme le suggère le cahier des charges
(section 13) : un VPS avec Node.js et PostgreSQL installés, ce projet copié dessus,
`npm run build` puis `npm run start` derrière un nom de domaine (avec HTTPS via un
outil comme Caddy ou Nginx + Let's Encrypt). Cette option demande des compétences
techniques ou un prestataire ; c'est celle qui correspond le mieux à la mention
"hébergement serveur local ou VPS/cloud privé" du cahier des charges.

Dans les deux cas, il faut un nom de domaine et un abonnement d'hébergement (quelques
euros à quelques dizaines d'euros par mois selon le volume) — ce sont des frais et des
comptes que vous devez créer vous-même.

## Structure du projet (pour un développeur)

- `src/db/schema.ts` — modèle de données (Drizzle ORM)
- `src/db/seed.ts` — données de démonstration
- `src/auth.ts` — authentification (NextAuth / Auth.js)
- `src/app/responsable/` — espace Responsable Qualité
- `src/app/technicien/` — espace Technicien
- `drizzle/` — migrations SQL générées
