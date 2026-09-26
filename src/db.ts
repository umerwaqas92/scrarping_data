import { neon } from "@neondatabase/serverless";

/**
 * Neon Postgres data layer (serverless-friendly, no native modules).
 *
 * Replaces the previous better-sqlite3 implementation so the backend can run
 * on Vercel, where the filesystem is read-only/ephemeral.
 */

let sql: ReturnType<typeof neon> | null = null;

function getSql(): ReturnType<typeof neon> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Missing DATABASE_URL environment variable. Set your Neon Postgres connection string.");
  }
  if (!sql) {
    sql = neon(url);
  }
  return sql;
}

let schemaReady: Promise<void> | null = null;

/** Idempotently create the schema (runs once per cold start). */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const q = getSql();
      await q`
        CREATE TABLE IF NOT EXISTS profile (
          id         INTEGER PRIMARY KEY DEFAULT 1,
          content    TEXT    NOT NULL DEFAULT '',
          queries    TEXT    NOT NULL DEFAULT '[]',
          updated_at TEXT    NOT NULL DEFAULT ''
        )
      `;
      await q`ALTER TABLE profile ADD COLUMN IF NOT EXISTS queries TEXT NOT NULL DEFAULT '[]'`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export interface ProfileRow {
  id: number;
  content: string;
  queries: string;
  updated_at: string;
}

export interface ProfileDataResult {
  id: number;
  content: string;
  queries: string[];
  updated_at: string;
}

export async function getProfile(): Promise<ProfileDataResult | null> {
  await ensureSchema();
  const rows = (await getSql()`SELECT * FROM profile WHERE id = 1`) as ProfileRow[];
  const row = rows[0];
  if (!row) return null;

  let parsedQueries: string[] = [];
  try {
    if (row.queries) {
      const q = JSON.parse(row.queries);
      if (Array.isArray(q)) {
        parsedQueries = q.filter((item) => typeof item === "string" && item.trim().length > 0);
      }
    }
  } catch {
    parsedQueries = [];
  }

  return {
    id: row.id,
    content: row.content || "",
    queries: parsedQueries,
    updated_at: row.updated_at || "",
  };
}

export async function saveProfile(content: string, queries?: string[]): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  const existing = await getProfile();
  const finalQueries = Array.isArray(queries)
    ? queries.filter((q) => typeof q === "string" && q.trim().length > 0)
    : (existing?.queries ?? []);
  const queriesJson = JSON.stringify(finalQueries);

  await getSql()`
    INSERT INTO profile (id, content, queries, updated_at) VALUES (1, ${content}, ${queriesJson}, ${now})
    ON CONFLICT (id) DO UPDATE SET content = excluded.content, queries = excluded.queries, updated_at = excluded.updated_at
  `;
}
