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
    id      INTEGER PRIMARY KEY DEFAULT 1,
    content TEXT    NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  );
`);

export interface ProfileRow {
  id: number;
  content: string;
  updated_at: string;
}

export function getProfile(): ProfileRow | null {
  return db.prepare("SELECT * FROM profile WHERE id = 1").get() as ProfileRow | null;
}

export function saveProfile(content: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO profile (id, content, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(content, now);
}
