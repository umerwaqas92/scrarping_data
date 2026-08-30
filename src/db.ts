import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data.db");

export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma("journal_mode = WAL");

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS profile (
    id         INTEGER PRIMARY KEY DEFAULT 1,
    content    TEXT    NOT NULL DEFAULT '',
    queries    TEXT    NOT NULL DEFAULT '[]',
    updated_at TEXT    NOT NULL DEFAULT ''
  );
`);

// Migration for existing tables without queries column
try {
  db.exec(`ALTER TABLE profile ADD COLUMN queries TEXT NOT NULL DEFAULT '[]'`);
} catch {
  // column already exists
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

export function getProfile(): ProfileDataResult | null {
  const row = db.prepare("SELECT * FROM profile WHERE id = 1").get() as ProfileRow | null;
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

export function saveProfile(content: string, queries?: string[]): void {
  const now = new Date().toISOString();
  const existing = getProfile();
  const finalQueries = Array.isArray(queries)
    ? queries.filter((q) => typeof q === "string" && q.trim().length > 0)
    : (existing?.queries ?? []);
  const queriesJson = JSON.stringify(finalQueries);

  db.prepare(`
    INSERT INTO profile (id, content, queries, updated_at) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, queries = excluded.queries, updated_at = excluded.updated_at
  `).run(content, queriesJson, now);
}

