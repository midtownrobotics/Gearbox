// SPDX-License-Identifier: AGPL-3.0-only
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Opens the agent's local SQLite database. Modules create their own tables. */
export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
}

export function getMeta(db: Database, key: string) {
  return db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key)
    ?.value;
}

export function setMeta(db: Database, key: string, value: string) {
  db.query(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
