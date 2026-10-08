import "server-only";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { demandesClient, interventions, missionChecklists, observateurAppareils, observateurs, rapports } from "@/db/schema";

// ==========================================================================
// Phase 25 — Temps réel.
//
// PostgreSQL signale chaque changement (déclencheurs de la migration 0021,
// canal « robus_changements »). Une seule connexion LISTEN par serveur
// reçoit ces signaux, retrouve la mission / l'appareil / le technicien
// concernés, puis prévient les écrans ouverts (flux /api/temps-reel) qui ont
// le droit de le savoir :
//   • bureau        → tout ;
//   • technicien    → ses missions, ses formations / habilitations ;
//   • observateur   → les appareils qui lui sont attribués.
// L'écran recharge alors seulement sa page (quelques dizaines de ms).
// ==========================================================================

export type Changement = {
  t: string;
  id?: string | null;
  i?: string | null; // mission
  a?: string | null; // appareil
  p?: string | null; // projet
  c?: string | null; // client
  u?: string | null; // technicien
  d?: string | null; // demande client
  r?: string | null; // rapport
  m?: string | null; // checklist de mission
  s?: string | null; // session de formation
  o?: string | null; // observateur
};

export type Abonne = {
  role: string;
  userId: string;
  /** Appareils visibles (observateur). */
  appareils?: Set<string>;
  envoyer: (c: Changement) => void;
};

type Etat = {
  abonnes: Set<Abonne>;
  demarrage?: Promise<void>;
  missions: Map<string, { a: string | null; u: string | null; p: string | null; quand: number }>;
};

const g = globalThis as unknown as { _robusTempsReel?: Etat };
const etat: Etat = (g._robusTempsReel ??= { abonnes: new Set(), missions: new Map() });

const TABLES_FORMATION = new Set(["formations_sessions", "formations_participants", "habilitations_technicien"]);

async function infosMission(id: string, forcer = false) {
  const c = etat.missions.get(id);
  if (c && !forcer && Date.now() - c.quand < 60_000) return c;
  const [m] = await db
    .select({ a: interventions.appareilId, u: interventions.technicienId, p: interventions.projetId })
    .from(interventions)
    .where(eq(interventions.id, id))
    .limit(1);
  const v = { a: m?.a ?? null, u: m?.u ?? null, p: m?.p ?? null, quand: Date.now() };
  etat.missions.set(id, v);
  if (etat.missions.size > 5000) etat.missions.delete(etat.missions.keys().next().value!);
  return v;
}

/** Complète un signal : mission, appareil et technicien concernés. */
async function completer(c: Changement): Promise<Changement> {
  if (c.t === "interventions" && c.id) c.i = c.id;
  if (c.t === "appareils" && c.id) c.a = c.id;
  if (c.t === "demandes_client" && c.id) c.d = c.id;
  try {
    if (!c.i && c.r) {
      const [r] = await db.select({ i: rapports.interventionId }).from(rapports).where(eq(rapports.id, c.r)).limit(1);
      c.i = r?.i ?? null;
    }
    if (!c.i && c.m) {
      const [m] = await db.select({ i: missionChecklists.interventionId }).from(missionChecklists).where(eq(missionChecklists.id, c.m)).limit(1);
      c.i = m?.i ?? null;
    }
    if (!c.a && c.d) {
      const [d] = await db.select({ a: demandesClient.appareilId }).from(demandesClient).where(eq(demandesClient.id, c.d)).limit(1);
      c.a = d?.a ?? null;
    }
    if (c.i) {
      // Une mission modifiée peut avoir changé de technicien : on relit.
      const m = await infosMission(c.i, c.t === "interventions");
      c.a ??= m.a;
      c.p ??= m.p;
      c.u ??= m.u;
    }
  } catch {
    /* le signal part quand même, sans les liens */
  }
  return c;
}

export function concerne(ab: Abonne, c: Changement) {
  if (ab.role === "administrateur" || ab.role === "responsable_qualite" || ab.role === "commercial") return true;
  if (ab.role === "technicien") {
    if (c.u && c.u === ab.userId) return true;
    if (TABLES_FORMATION.has(c.t) && !c.u) return true; // session modifiée : chaque technicien relit
    return false;
  }
  if (ab.role === "observateur") {
    if (c.t === "observateurs" || c.t === "observateur_appareils") return true; // droits modifiés
    return !!c.a && !!ab.appareils?.has(c.a);
  }
  return false;
}

async function diffuser(brut: string) {
  let c: Changement;
  try {
    c = JSON.parse(brut);
  } catch {
    return;
  }
  if (!etat.abonnes.size) return;
  c = await completer(c);
  for (const ab of etat.abonnes) {
    try {
      if (concerne(ab, c)) ab.envoyer(c);
    } catch {
      /* écran déconnecté */
    }
  }
}

/** Démarre (une seule fois) l'écoute des changements PostgreSQL. */
export function demarrerEcoute() {
  if (!etat.demarrage) {
    etat.demarrage = (async () => {
      const ecoute = postgres(process.env.DATABASE_URL!, { max: 1, idle_timeout: 0 });
      await ecoute.listen("robus_changements", (payload) => void diffuser(payload));
    })().catch((e) => {
      console.error("Temps réel : écoute impossible", e);
      etat.demarrage = undefined;
    });
  }
  return etat.demarrage;
}

export function abonner(ab: Abonne) {
  etat.abonnes.add(ab);
  return () => etat.abonnes.delete(ab);
}

export async function appareilsObservateur(userId: string) {
  const rows = await db
    .select({ a: observateurAppareils.appareilId })
    .from(observateurAppareils)
    .innerJoin(observateurs, eq(observateurAppareils.observateurId, observateurs.id))
    .where(eq(observateurs.userId, userId));
  return new Set(rows.map((r) => r.a));
}

export function nbEcransConnectes() {
  return etat.abonnes.size;
}
