import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const DATA_DIR = process.env.SPELLCHECK_DATA_DIR
  ? path.resolve(process.env.SPELLCHECK_DATA_DIR)
  : path.join(process.cwd(), 'data');

export function openDatabase(dbPath?: string): DatabaseSync {
  const file = dbPath ?? path.join(DATA_DIR, 'spellcheck.db');
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      word TEXT NOT NULL,
      freq INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (group_id, word)
    );
    CREATE INDEX IF NOT EXISTS idx_words_group ON words(group_id);
    CREATE TABLE IF NOT EXISTS queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      input TEXT NOT NULL,
      normalized TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      limit_n INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      candidates_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_queries_group ON queries(group_id, id);
  `);
  return db;
}
