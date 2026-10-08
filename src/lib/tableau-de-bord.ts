import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { mur } from "@/lib/planning";

// ==========================================================================
// Phase 28 — Tableau de bord de direction (maquette validée le 08/10/2026).
// Remplissage de la plateforme, fiches complètes, équipe, pannes par semaine,
// échéances. Requêtes SQL agrégées : une ligne par indicateur, pas de N+1.
// ==========================================================================

type Ligne = Record<string, unknown>;
async function lignes(q: ReturnType<typeof sql>) {
  return (await db.execute(q)) as unknown as Ligne[];
}
const n = (v: unknown) => Number(v ?? 0);

// ---------- Remplissage ----------

export type Saisie = { cle: string; titre: string; href: string; total: number; ceMois: number; mois: number[] };

const ENTITES: { cle: string; titre: string; href: string; table: string; filtre?: string }[] = [
  { cle: "appareils", titre: "Appareils", href: "/responsable/appareils", table: "appareils" },
  { cle: "clients", titre: "Clients", href: "/responsable/clients", table: "clients" },
  { cle: "observateurs", titre: "Observateurs", href: "/responsable/observateurs", table: "observateurs" },
  { cle: "sites", titre: "Sites", href: "/responsable/sites", table: "sites" },
  { cle: "projets", titre: "Projets", href: "/responsable/projets", table: "projets" },
  { cle: "missions", titre: "Missions créées", href: "/responsable/interventions", table: "interventions" },
  { cle: "contrats", titre: "Contrats", href: "/responsable/prestations", table: "prestations", filtre: `"mode" = 'contrat'` },
  { cle: "documents", titre: "Documents clients", href: "/responsable/documents", table: "documents_client", filtre: `"archive_le" is null` },
];

/** Total + ajoutés par mois (6 derniers mois, le dernier = mois en cours, heure de Bruxelles). */
export async function remplissage(): Promise<Saisie[]> {
  const union = ENTITES.map(
    (e) =>
      `select '${e.cle}' as cle, count(*)::int as total, ` +
      [5, 4, 3, 2, 1, 0]
        .map(
          (k) =>
            `count(*) filter (where date_trunc('month', created_at at time zone 'UTC' at time zone 'Europe/Brussels') = date_trunc('month', (now() at time zone 'Europe/Brussels') - interval '${k} month'))::int as m${k}`
        )
        .join(", ") +
      ` from "${e.table}"${e.filtre ? ` where ${e.filtre}` : ""}`
  ).join(" union all ");
  const rows = await lignes(sql.raw(union));
  const parCle = new Map(rows.map((r) => [String(r.cle), r]));
  return ENTITES.map((e) => {
    const r = parCle.get(e.cle) ?? {};
    const mois = [5, 4, 3, 2, 1, 0].map((k) => n(r[`m${k}`]));
    return { cle: e.cle, titre: e.titre, href: e.href, total: n(r.total), ceMois: mois[5], mois };
  });
}

// ---------- Fiches complètes ----------

export type Completude = { titre: string; ok: number; total: number; detail: string; href: string };

export async function completude(): Promise<Completude[]> {
  const [r] = await lignes(sql`
    select
      (select count(*)::int from appareils) as app,
      (select count(*)::int from appareils where coalesce(marque, '') <> '' and coalesce(modele, '') <> '' and annee_installation is not null) as app_complets,
      (select count(*)::int from appareils a where exists (
         select 1 from prestation_appareils pa join prestations p on p.id = pa.prestation_id
         where pa.appareil_id = a.id and p.mode = 'contrat' and p.statut_contrat = 'actif' and (p.date_fin is null or p.date_fin >= now()))
       or exists (
         select 1 from projet_appareils pj join garanties g on g.projet_id = pj.projet_id
         where pj.appareil_id = a.id and g.date_fin >= now())) as app_couverts,
      (select count(*)::int from appareils where coalesce(photo_url, '') <> '' and coalesce(qr_code, '') <> '') as app_photo_qr,
      (select count(*)::int from clients) as cli,
      (select count(*)::int from clients c where exists (select 1 from contacts_client k where k.client_id = c.id and (coalesce(k.email, '') <> '' or coalesce(k.telephone, '') <> ''))) as cli_contact,
      (select count(*)::int from observateurs o join users u on u.id = o.user_id where u.actif = 1) as obs,
      (select count(*)::int from observateurs o join users u on u.id = o.user_id where u.actif = 1 and u.derniere_connexion is not null) as obs_connectes,
      (select count(*)::int from users where role = 'technicien' and actif = 1) as tech,
      (select count(*)::int from users u where u.role = 'technicien' and u.actif = 1 and not exists (
         select 1 from habilitations_technicien h where h.technicien_id = u.id and h.statut = 'valide' and h.date_expiration is not null and h.date_expiration < now())) as tech_ok
  `);
  const ligne = (titre: string, ok: number, total: number, manque: string, href: string): Completude => ({
    titre,
    ok,
    total,
    href,
    detail: total === 0 ? "rien à vérifier" : ok === total ? "tout est rempli" : manque.replace("{n}", String(total - ok)),
  });
  return [
    ligne("Appareils avec marque, modèle et année", n(r.app_complets), n(r.app), "{n} appareil(s) incomplet(s)", "/responsable/appareils?vue=tableau"),
    ligne("Appareils sous contrat ou garantie", n(r.app_couverts), n(r.app), "{n} appareil(s) sans contrat", "/responsable/appareils?f=sanscontrat"),
    ligne("Clients avec un contact (email ou téléphone)", n(r.cli_contact), n(r.cli), "{n} client(s) sans contact", "/responsable/clients"),
    ligne("Observateurs qui se sont déjà connectés", n(r.obs_connectes), n(r.obs), "{n} invitation(s) sans connexion", "/responsable/observateurs"),
    ligne("Techniciens avec habilitations à jour", n(r.tech_ok), n(r.tech), "{n} technicien(s) avec une habilitation expirée", "/responsable/habilitations"),
    ligne("Appareils avec photo et QR code", n(r.app_photo_qr), n(r.app), "{n} appareil(s) à photographier / étiqueter", "/responsable/appareils?vue=tableau"),
  ];
}

// ---------- Équipe (30 jours) ----------

export type LigneEquipe = {
  id: string;
  nom: string;
  preventives: number;
  depannages: number;
  tempsMoyenMin: number | null;
  acceptationMin: number | null;
  refus: number;
  aVenir: number;
};

export async function equipe30(maintenant: number): Promise<LigneEquipe[]> {
  const debutMur = new Date(mur(maintenant)).toISOString();
  const finMur = new Date(mur(maintenant) + 7 * 86400000).toISOString();
  const rows = await lignes(sql`
    select u.id, u.nom,
      (select count(*)::int from interventions i where i.technicien_id = u.id and i.date_fin >= now() - interval '30 days' and i.type <> 'corrective' and i.statut in ('terminee','validee','cloturee')) as prev,
      (select count(*)::int from interventions i where i.technicien_id = u.id and i.date_fin >= now() - interval '30 days' and i.type = 'corrective' and i.statut in ('terminee','validee','cloturee')) as dep,
      (select round(avg(extract(epoch from (i.date_fin - i.date_debut)) / 60)) from interventions i
         where i.technicien_id = u.id and i.date_fin >= now() - interval '30 days' and i.date_debut is not null and i.date_fin > i.date_debut
           and i.date_fin - i.date_debut < interval '24 hours') as temps,
      (select round(avg(extract(epoch from (i.acceptee_le - i.envoyee_le)) / 60)) from interventions i
         where i.technicien_id = u.id and i.acceptee_le >= now() - interval '30 days' and i.envoyee_le is not null and i.acceptee_le >= i.envoyee_le) as acc,
      (select count(*)::int from journal_activite j where j.utilisateur_id = u.id and j.action = 'mission_refusee' and j.created_at >= now() - interval '30 days') as refus,
      (select count(*)::int from interventions i where i.technicien_id = u.id and i.statut in ('creee','planifiee','affectee')
         and i.date_programmee >= ${debutMur}::timestamp and i.date_programmee < ${finMur}::timestamp) as avenir
    from users u
    where u.role = 'technicien' and u.actif = 1
    order by u.nom
  `);
  return rows.map((r) => ({
    id: String(r.id),
    nom: String(r.nom),
    preventives: n(r.prev),
    depannages: n(r.dep),
    tempsMoyenMin: r.temps === null ? null : n(r.temps),
    acceptationMin: r.acc === null ? null : n(r.acc),
    refus: n(r.refus),
    aVenir: n(r.avenir),
  }));
}

// ---------- Pannes et visites (12 semaines) ----------

export type Semaine = { label: string; debut: string; depannages: number; visites: number };

export async function pannesSemaines(): Promise<Semaine[]> {
  const rows = await lignes(sql`
    with s as (
      select generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as debut
    )
    select to_char(s.debut, 'IW') as sem, to_char(s.debut, 'DD/MM') as debut,
      (select count(*)::int from interventions i where i.type = 'corrective' and i.created_at >= s.debut and i.created_at < s.debut + interval '1 week') as dep,
      (select count(*)::int from interventions i where i.type <> 'corrective' and i.statut in ('terminee','validee','cloturee') and i.date_fin >= s.debut and i.date_fin < s.debut + interval '1 week') as vis
    from s order by s.debut
  `);
  return rows.map((r) => ({ label: `S${Number(r.sem)}`, debut: String(r.debut), depannages: n(r.dep), visites: n(r.vis) }));
}

// ---------- Échéances & qualité ----------

export async function echeances() {
  const [r] = await lignes(sql`
    select
      (select count(*)::int from non_conformites where statut <> 'cloturee') as nc,
      (select count(*)::int from non_conformites where statut <> 'cloturee' and date_echeance < now()) as nc_retard,
      (select count(*)::int from habilitations_technicien h join users u on u.id = h.technicien_id
         where u.actif = 1 and h.statut = 'valide' and h.date_expiration >= now() and h.date_expiration < now() + interval '60 days') as habil,
      (select count(*)::int from prestations where mode = 'contrat' and statut_contrat = 'actif' and renouvelee_par_id is null and date_fin >= now() and date_fin < now() + interval '60 days') as contrats,
      (select count(*)::int from garanties where date_fin >= now() and date_fin < now() + interval '60 days') as garanties,
      (select count(*)::int from mission_notes where type = 'piece_manquante' and regle_le is null and archive_le is null) as pieces,
      (select count(*)::int from devis where statut = 'envoye') as devis,
      (select count(*)::int from devis where statut = 'a_preparer') as devis_a_faire,
      (select count(*)::int from instruments_mesure where date_prochain_etalonnage < now() + interval '30 days') as instruments,
      (select count(*)::int from instruments_mesure where date_prochain_etalonnage < now()) as instruments_retard
  `);
  return {
    nc: n(r.nc),
    ncRetard: n(r.nc_retard),
    habilitations: n(r.habil),
    contrats: n(r.contrats),
    garanties: n(r.garanties),
    pieces: n(r.pieces),
    devis: n(r.devis),
    devisAFaire: n(r.devis_a_faire),
    instruments: n(r.instruments),
    instrumentsRetard: n(r.instruments_retard),
  };
}

/** Demande « personne bloquée » encore ouverte (la plus ancienne). */
export async function personneBloquee() {
  const [r] = await lignes(sql`
    select d.id, d.created_at, a.numero_interne as numero, c.raison_sociale as client, u.nom as technicien, i.statut as mission
    from demandes_client d
    join appareils a on a.id = d.appareil_id
    left join clients c on c.id = d.client_id
    left join interventions i on i.id = d.intervention_id
    left join users u on u.id = i.technicien_id
    where d.personne_bloquee = 1 and d.statut in ('nouvelle','prise_en_charge','planifiee')
    order by d.created_at asc limit 1
  `);
  return r ? { id: String(r.id), createdAt: new Date(r.created_at as Date), numero: String(r.numero), client: r.client ? String(r.client) : null, technicien: r.technicien ? String(r.technicien) : null, surPlace: r.mission === "en_cours" } : null;
}

/** Demande nouvelle la plus ancienne (pour « Plus ancienne : il y a … »). */
export async function plusAncienneDemande() {
  const [r] = await lignes(sql`select min(created_at) as d from demandes_client where statut = 'nouvelle'`);
  return r?.d ? new Date(r.d as string | Date) : null;
}
