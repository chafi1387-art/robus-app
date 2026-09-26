import "server-only";
import webpush from "web-push";
import { db } from "@/db";
import { pushAbonnements, users } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

// Phase 16 : envoi des notifications push (clés VAPID dans .env du serveur).
// Ne fait jamais échouer l'action métier qui l'appelle.
let configure = false;
function pret() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  if (!configure) {
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:admin@robuslift.be", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configure = true;
  }
  return true;
}

export type MessagePush = { titre: string; corps: string; url?: string; tag?: string };

export async function notifierUtilisateurs(userIds: string[], message: MessagePush) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length || !pret()) return 0;
  try {
    const abonnements = await db.select().from(pushAbonnements).where(inArray(pushAbonnements.userId, ids));
    let envoyes = 0;
    await Promise.all(
      abonnements.map(async (a) => {
        try {
          await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, JSON.stringify(message), { TTL: 60 * 60 * 24 });
          envoyes++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await db.delete(pushAbonnements).where(eq(pushAbonnements.id, a.id));
        }
      })
    );
    return envoyes;
  } catch {
    return 0;
  }
}

/** Tous les comptes bureau actifs (administrateur + responsable qualité). */
export async function notifierBureau(message: MessagePush) {
  try {
    const bureau = await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, ["administrateur", "responsable_qualite"]), eq(users.actif, 1)));
    return notifierUtilisateurs(bureau.map((u) => u.id), message);
  } catch {
    return 0;
  }
}

export function clePubliqueVapid() {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}
