import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError, normalizeWord, validateFrequency } from './errors.ts';

export interface EntryRow {
  word: string;
  frequency: number;
}

export interface QueryRow {
  id: number;
  dict_id: number;
  dict_name: string;
  input: string;
  normalized: string;
  correct: number;
  threshold: number;
  limit: number;
  candidates: string;
  created_at: string;
}

export function defaultDbPath(): string {
  return process.env.SPELLCHECK_DB || path.join(process.cwd(), 'data', 'spellcheck.db');
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string = defaultDbPath()) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dictionaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dict_id INTEGER NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
        word TEXT NOT NULL,
        frequency INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (dict_id, word)
      );
      CREATE INDEX IF NOT EXISTS idx_entries_dict ON entries(dict_id);
      CREATE TABLE IF NOT EXISTS queries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dict_id INTEGER NOT NULL,
        dict_name TEXT NOT NULL,
        input TEXT NOT NULL,
        normalized TEXT NOT NULL,
        correct INTEGER NOT NULL,
        threshold INTEGER NOT NULL,
        "limit" INTEGER NOT NULL,
        candidates TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // ---------- dictionaries ----------

  createDictionary(name: string): number {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
      throw new AppError('INVALID_NAME', 'dictionary name must be 1-64 chars of [A-Za-z0-9_-]');
    }
    try {
      const r = this.db.prepare('INSERT INTO dictionaries (name) VALUES (?)').run(name);
      return Number(r.lastInsertRowid);
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        throw new AppError('DUPLICATE_DICTIONARY', `dictionary "${name}" already exists`, 409);
      }
      throw e;
    }
  }

  listDictionaries(): Array<{ id: number; name: string; entries: number; created_at: string }> {
    return this.db
      .prepare(
        `SELECT d.id, d.name, d.created_at, COUNT(e.id) AS entries
         FROM dictionaries d LEFT JOIN entries e ON e.dict_id = d.id
         GROUP BY d.id ORDER BY d.name`
      )
      .all() as any;
  }

  getDictionaryId(nameOrId: string | number): number {
    let row: any;
    if (typeof nameOrId === 'number' || /^\d+$/.test(String(nameOrId))) {
      row = this.db.prepare('SELECT id FROM dictionaries WHERE id = ?').get(Number(nameOrId));
    }
    if (!row) {
      row = this.db.prepare('SELECT id FROM dictionaries WHERE name = ?').get(String(nameOrId));
    }
    if (!row) throw new AppError('DICT_NOT_FOUND', `dictionary "${nameOrId}" not found`, 404);
    return Number(row.id);
  }

  // ---------- entries ----------

  listEntries(dictId: number): EntryRow[] {
    return this.db
      .prepare('SELECT word, frequency FROM entries WHERE dict_id = ? ORDER BY word')
      .all(dictId) as any;
  }

  addEntry(dictId: number, rawWord: string, rawFreq: unknown = 0): void {
    const word = normalizeWord(rawWord);
    const frequency = validateFrequency(rawFreq);
    try {
      this.db
        .prepare('INSERT INTO entries (dict_id, word, frequency) VALUES (?, ?, ?)')
        .run(dictId, word, frequency);
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        throw new AppError('DUPLICATE_WORD', `word "${word}" already exists in dictionary`, 409);
      }
      throw e;
    }
  }

  updateEntry(dictId: number, rawWord: string, rawFreq: unknown): void {
    const word = normalizeWord(rawWord);
    const frequency = validateFrequency(rawFreq);
    const r = this.db
      .prepare(`UPDATE entries SET frequency = ?, updated_at = datetime('now') WHERE dict_id = ? AND word = ?`)
      .run(frequency, dictId, word);
    if (Number(r.changes) === 0) {
      throw new AppError('WORD_NOT_FOUND', `word "${word}" not found in dictionary`, 404);
    }
  }

  deleteEntry(dictId: number, rawWord: string): void {
    const word = normalizeWord(rawWord);
    const r = this.db.prepare('DELETE FROM entries WHERE dict_id = ? AND word = ?').run(dictId, word);
    if (Number(r.changes) === 0) {
      throw new AppError('WORD_NOT_FOUND', `word "${word}" not found in dictionary`, 404);
    }
  }

  /**
   * Batch import inside a single transaction: any invalid row aborts the whole
   * import and rolls back, so no partial results are left behind.
   */
  importEntries(dictId: number, items: Array<{ word: unknown; frequency?: unknown }>): number {
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError('BAD_REQUEST', 'entries must be a non-empty array');
    }
    if (items.length > 200_000) {
      throw new AppError('BAD_REQUEST', 'too many entries in one import (max 200000)');
    }
    // Validate everything first for clear error reporting.
    const seen = new Set<string>();
    const rows: Array<{ word: string; frequency: number }> = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] ?? {};
      let word: string;
      let frequency: number;
      try {
        word = normalizeWord((it as any).word);
        frequency = validateFrequency((it as any).frequency ?? 0);
      } catch (e: any) {
        throw new AppError('IMPORT_FAILED', `import aborted at row ${i + 1}: ${e.message}`, 400, {
          row: i + 1,
        });
      }
      if (seen.has(word)) {
        throw new AppError('IMPORT_FAILED', `import aborted: duplicate word "${word}" inside the import file (row ${i + 1})`, 400, {
          row: i + 1,
          word,
        });
      }
      seen.add(word);
      rows.push({ word, frequency });
    }
    const insert = this.db.prepare('INSERT INTO entries (dict_id, word, frequency) VALUES (?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      for (const r of rows) insert.run(dictId, r.word, r.frequency);
      this.db.exec('COMMIT');
    } catch (e: any) {
      this.db.exec('ROLLBACK');
      if (String(e.message).includes('UNIQUE')) {
        throw new AppError(
          'IMPORT_FAILED',
          'import aborted and rolled back: a word already exists in the dictionary (duplicates are rejected)',
          409
        );
      }
      throw new AppError('IMPORT_FAILED', `import aborted and rolled back: ${e.message}`, 400);
    }
    return rows.length;
  }

  // ---------- query log ----------

  logQuery(q: {
    dictId: number;
    dictName: string;
    input: string;
    normalized: string;
    correct: boolean;
    threshold: number;
    limit: number;
    candidates: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT INTO queries (dict_id, dict_name, input, normalized, correct, threshold, "limit", candidates)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        q.dictId,
        q.dictName,
        q.input,
        q.normalized,
        q.correct ? 1 : 0,
        q.threshold,
        q.limit,
        JSON.stringify(q.candidates)
      );
  }

  listQueries(limit = 50): QueryRow[] {
    return this.db
      .prepare('SELECT * FROM queries ORDER BY id DESC LIMIT ?')
      .all(limit) as any;
  }
}
