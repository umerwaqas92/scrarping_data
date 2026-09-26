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
      await q`
        CREATE TABLE IF NOT EXISTS cookies (
          platform   TEXT PRIMARY KEY,
          content    TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT ''
        )
      `;
      await q`
        CREATE TABLE IF NOT EXISTS applied_jobs (
          id         TEXT PRIMARY KEY,
          title      TEXT NOT NULL DEFAULT '',
          applied_at TEXT NOT NULL DEFAULT ''
        )
      `;
      await q`
        CREATE TABLE IF NOT EXISTS resume (
          id             INTEGER PRIMARY KEY DEFAULT 1,
          filename       TEXT NOT NULL DEFAULT '',
          content_base64 TEXT NOT NULL DEFAULT '',
          updated_at     TEXT NOT NULL DEFAULT ''
        )
      `;
      await q`
        CREATE TABLE IF NOT EXISTS apify_keys (
          id         TEXT PRIMARY KEY,
          label      TEXT NOT NULL DEFAULT '',
          token      TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT ''
        )
      `;
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

// ── Cookies ──────────────────────────────────────────────────────────────────

export interface CookieRow {
  platform: string;
  content: string;
  updated_at: string;
}

export async function getAllCookies(): Promise<CookieRow[]> {
  await ensureSchema();
  return (await getSql()`SELECT platform, content, updated_at FROM cookies`) as CookieRow[];
}

export async function getCookie(platform: string): Promise<CookieRow | null> {
  await ensureSchema();
  const rows = (await getSql()`SELECT platform, content, updated_at FROM cookies WHERE platform = ${platform}`) as CookieRow[];
  return rows[0] ?? null;
}

export async function saveCookie(platform: string, content: string): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  await getSql()`
    INSERT INTO cookies (platform, content, updated_at) VALUES (${platform}, ${content}, ${now})
    ON CONFLICT (platform) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `;
}

export async function deleteCookie(platform: string): Promise<void> {
  await ensureSchema();
  await getSql()`DELETE FROM cookies WHERE platform = ${platform}`;
}

// ── Applied jobs (posts marked as applied) ───────────────────────────────────

export interface AppliedJobRow {
  id: string;
  title: string;
  applied_at: string;
}

export async function getAppliedJobs(): Promise<AppliedJobRow[]> {
  await ensureSchema();
  return (await getSql()`
    SELECT id, title, applied_at FROM applied_jobs ORDER BY applied_at DESC
  `) as AppliedJobRow[];
}

export async function saveAppliedJob(id: string, title: string, appliedAt: string): Promise<void> {
  await ensureSchema();
  await getSql()`
    INSERT INTO applied_jobs (id, title, applied_at) VALUES (${id}, ${title}, ${appliedAt})
    ON CONFLICT (id) DO UPDATE SET title = excluded.title, applied_at = excluded.applied_at
  `;
}

export async function deleteAppliedJob(id: string): Promise<void> {
  await ensureSchema();
  await getSql()`DELETE FROM applied_jobs WHERE id = ${id}`;
}

// ── Resume (PDF used as email attachment) ────────────────────────────────────

export interface ResumeRow {
  filename: string;
  content_base64: string;
  updated_at: string;
}

export async function getResumeRecord(): Promise<ResumeRow | null> {
  await ensureSchema();
  const rows = (await getSql()`
    SELECT filename, content_base64, updated_at FROM resume WHERE id = 1
  `) as ResumeRow[];
  return rows[0] ?? null;
}

export async function saveResumeRecord(filename: string, contentBase64: string): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  await getSql()`
    INSERT INTO resume (id, filename, content_base64, updated_at) VALUES (1, ${filename}, ${contentBase64}, ${now})
    ON CONFLICT (id) DO UPDATE SET filename = excluded.filename, content_base64 = excluded.content_base64, updated_at = excluded.updated_at
  `;
}

export async function deleteResumeRecord(): Promise<void> {
  await ensureSchema();
  await getSql()`DELETE FROM resume WHERE id = 1`;
}

// ── Apify keys (managed at runtime via the UI) ───────────────────────────────

export interface ApifyKeyRow {
  id: string;
  label: string;
  token: string;
  updated_at: string;
}

export async function getApifyKeys(): Promise<ApifyKeyRow[]> {
  await ensureSchema();
  return (await getSql()`
    SELECT id, label, token, updated_at FROM apify_keys ORDER BY updated_at ASC
  `) as ApifyKeyRow[];
}

export async function addApifyKey(label: string, token: string): Promise<ApifyKeyRow> {
  await ensureSchema();
  const id = `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  await getSql()`
    INSERT INTO apify_keys (id, label, token, updated_at) VALUES (${id}, ${label}, ${token}, ${now})
  `;
  return { id, label, token, updated_at: now };
}

export async function deleteApifyKey(id: string): Promise<void> {
  await ensureSchema();
  await getSql()`DELETE FROM apify_keys WHERE id = ${id}`;
}
