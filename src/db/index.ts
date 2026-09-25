import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

// En dev, next reload garde une seule connexion (évite d'épuiser les slots Postgres).
const globalForDb = globalThis as unknown as { _robusPg?: ReturnType<typeof postgres> };

const client = globalForDb._robusPg ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb._robusPg = client;

export const db = drizzle(client, { schema });
