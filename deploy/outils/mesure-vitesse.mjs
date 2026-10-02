// Mesure du temps de réponse serveur des pages principales (lecture seule).
// Usage (sur le serveur, dans le dossier de l'application) :
//   node deploy/outils/mesure-vitesse.mjs [http://localhost:3000]
// Crée un jeton de session temporaire (administrateur + un technicien) avec
// AUTH_SECRET, appelle chaque page 4 fois et affiche le temps médian.
import "dotenv/config";
import postgres from "postgres";
import { encode } from "@auth/core/jwt";

const base = process.argv[2] || "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;

async function cookie(u) {
  const parts = [];
  for (const salt of ["authjs.session-token", "__Secure-authjs.session-token"]) {
    const t = await encode({ token: { sub: u.id, id: u.id, role: u.role, name: u.nom, email: u.email }, secret, salt, maxAge: 600 });
    parts.push(`${salt}=${t}`);
  }
  return parts.join("; ");
}

async function mesurer(chemin, ck) {
  const temps = [];
  let code = 0;
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    const r = await fetch(base + chemin, { headers: { cookie: ck, "x-forwarded-proto": "https" }, redirect: "manual" });
    await r.arrayBuffer();
    temps.push(performance.now() - t0);
    code = r.status;
  }
  temps.sort((a, b) => a - b);
  const med = Math.round((temps[1] + temps[2]) / 2);
  console.log(`${String(med).padStart(5)} ms  ${code}  ${chemin}`);
}

const [admin] = await sql`select id, nom, email, role from users where role = 'administrateur' and actif = 1 order by created_at limit 1`;
const [tech] = await sql`select u.id, u.nom, u.email, u.role from users u where u.role = 'technicien' and u.actif = 1
  order by (select count(*) from interventions i where i.technicien_id = u.id) desc limit 1`;
const [projet] = await sql`select id from projets order by created_at desc limit 1`;
const [mission] = await sql`select id from interventions order by created_at desc limit 1`;

if (admin) {
  const ck = await cookie(admin);
  console.log(`== Bureau (${admin.nom})`);
  const pages = ["/responsable", "/responsable/projets", "/responsable/interventions", "/responsable/techniciens", "/responsable/habilitations", "/responsable/sous-traitance", "/responsable/demandes", "/responsable/signalements", "/responsable/documents"];
  if (tech) pages.push(`/responsable/techniciens/${tech.id}`, `/responsable/techniciens/${tech.id}?tab=habilitations`, `/responsable/techniciens/${tech.id}?tab=missions`);
  if (projet) pages.push(`/responsable/projets/${projet.id}`);
  if (mission) pages.push(`/responsable/missions/${mission.id}`);
  for (const p of pages) await mesurer(p, ck);
}
if (tech) {
  const ck = await cookie(tech);
  console.log(`== Technicien (${tech.nom})`);
  for (const p of ["/technicien", "/technicien?vue=semaine", "/technicien/heures", "/technicien/formations", "/technicien/profil", "/technicien/signaler", "/technicien/signalements", "/technicien/appareils"]) await mesurer(p, ck);
}
await sql.end();
