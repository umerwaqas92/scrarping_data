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
          id            TEXT PRIMARY KEY,
          title         TEXT NOT NULL DEFAULT '',
          url           TEXT NOT NULL DEFAULT '',
          source        TEXT NOT NULL DEFAULT '',
          author        TEXT NOT NULL DEFAULT '',
          author_avatar TEXT NOT NULL DEFAULT '',
          content       TEXT NOT NULL DEFAULT '',
          proposal      TEXT NOT NULL DEFAULT '',
          note          TEXT NOT NULL DEFAULT '',
          item          TEXT NOT NULL DEFAULT '',
          applied_at    TEXT NOT NULL DEFAULT '',
          updated_at    TEXT NOT NULL DEFAULT ''
        )
      `;
      await q`ALTER TABLE applied_jobs ADD COLUMN IF NOT EXISTS author_avatar TEXT NOT NULL DEFAULT ''`;
      await q`ALTER TABLE applied_jobs ADD COLUMN IF NOT EXISTS author_url TEXT NOT NULL DEFAULT ''`;
      await q`ALTER TABLE applied_jobs ADD COLUMN IF NOT EXISTS item TEXT NOT NULL DEFAULT ''`;
      await q`ALTER TABLE applied_jobs ADD COLUMN IF NOT EXISTS url TEXT NOT NULL DEFAULT ''`;
      await q`ALTER TABLE applied_jobs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT ''`;
      await q`ALTER TABLE applied_jobs ADD COLUMN IF NOT EXISTS author TEXT NOT NULL DEFAULT ''`;
      await q`ALTER TABLE applied_jobs ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT ''`;
      await q`ALTER TABLE applied_jobs ADD COLUMN IF NOT EXISTS proposal TEXT NOT NULL DEFAULT ''`;
      await q`ALTER TABLE applied_jobs ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT ''`;
      await q`ALTER TABLE applied_jobs ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT ''`;
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
  url: string;
  source: string;
  author: string;
  author_avatar: string;
  author_url: string;
  content: string;
  proposal: string;
  note: string;
  item: string;
  applied_at: string;
  updated_at: string;
}

export interface AppliedJobInput {
  id: string;
  title?: string;
  url?: string;
  source?: string;
  author?: string;
  author_avatar?: string;
  authorAvatar?: string;
  author_url?: string;
  authorUrl?: string;
  content?: string;
  proposal?: string;
  note?: string;
  /** Serialized FeedItem snapshot (JSON string). */
  item?: string;
  appliedAt?: string;
}

export async function getAppliedJobs(): Promise<AppliedJobRow[]> {
  await ensureSchema();
  return (await getSql()`
    SELECT id, title, url, source, author, author_avatar, author_url, content, proposal, note, item, applied_at, updated_at
    FROM applied_jobs ORDER BY applied_at DESC
  `) as AppliedJobRow[];
}

export async function getAppliedJob(id: string): Promise<AppliedJobRow | null> {
  await ensureSchema();
  const rows = (await getSql()`
    SELECT id, title, url, source, author, author_avatar, author_url, content, proposal, note, item, applied_at, updated_at
    FROM applied_jobs WHERE id = ${id}
  `) as AppliedJobRow[];
  return rows[0] ?? null;
}

/**
 * Insert or update an applied job. Callers send the full record, so all fields
 * are overwritten (this lets a note be cleared). The original applied_at is
 * preserved on update; updated_at always moves forward.
 */
export async function saveAppliedJob(input: AppliedJobInput): Promise<AppliedJobRow | null> {
  await ensureSchema();
  const now = new Date().toISOString();
  const when = input.appliedAt || now;
  const avatar = input.author_avatar || input.authorAvatar || "";
  const authorUrl = input.author_url || input.authorUrl || "";
  await getSql()`
    INSERT INTO applied_jobs
      (id, title, url, source, author, author_avatar, author_url, content, proposal, note, item, applied_at, updated_at)
    VALUES (
      ${input.id}, ${input.title ?? ""}, ${input.url ?? ""}, ${input.source ?? ""},
      ${input.author ?? ""}, ${avatar}, ${authorUrl}, ${input.content ?? ""}, ${input.proposal ?? ""},
      ${input.note ?? ""}, ${input.item ?? ""}, ${when}, ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      title         = excluded.title,
      url           = excluded.url,
      source        = excluded.source,
      author        = excluded.author,
      author_avatar = CASE WHEN excluded.author_avatar <> '' THEN excluded.author_avatar ELSE applied_jobs.author_avatar END,
      author_url    = CASE WHEN excluded.author_url <> '' THEN excluded.author_url ELSE applied_jobs.author_url END,
      content       = excluded.content,
      proposal      = excluded.proposal,
      note          = excluded.note,
      item          = CASE WHEN excluded.item <> '' THEN excluded.item ELSE applied_jobs.item END,
      applied_at    = CASE WHEN applied_jobs.applied_at = '' THEN excluded.applied_at ELSE applied_jobs.applied_at END,
      updated_at    = excluded.updated_at
  `;
  return getAppliedJob(input.id);
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
