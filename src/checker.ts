import { levenshtein } from './levenshtein.ts';
import { normalizeWord, validateLimit, validateThreshold } from './errors.ts';
import { Store } from './db.ts';
import type { EntryRow } from './db.ts';

export interface Candidate {
  word: string;
  distance: number;
  frequency: number;
}

export interface CheckResult {
  input: string;
  normalized: string;
  correct: boolean;
  threshold: number;
  limit: number;
  candidates: Candidate[];
}

/**
 * Spell checker with a small per-dictionary cache of the entry list.
 * The cache is invalidated on any dictionary mutation, so updates take
 * effect on the very next query.
 */
export class Checker {
  private cache = new Map<number, EntryRow[]>();
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  invalidate(dictId: number): void {
    this.cache.delete(dictId);
  }

  private entries(dictId: number): EntryRow[] {
    let list = this.cache.get(dictId);
    if (!list) {
      list = this.store.listEntries(dictId);
      this.cache.set(dictId, list);
    }
    return list;
  }

  check(
    dictId: number,
    dictName: string,
    rawWord: string,
    rawThreshold: unknown = 2,
    rawLimit: unknown = 10,
    log = true
  ): CheckResult {
    const normalized = normalizeWord(rawWord);
    const threshold = validateThreshold(rawThreshold);
    const limit = validateLimit(rawLimit);

    const entries = this.entries(dictId);
    const correct = entries.some((e) => e.word === normalized);

    const all: Candidate[] = [];
    for (const e of entries) {
      // cheap length-difference prune (valid: distance >= |len diff|)
      if (Math.abs(e.word.length - normalized.length) > threshold) continue;
      const distance = levenshtein(normalized, e.word);
      if (distance <= threshold) {
        all.push({ word: e.word, distance, frequency: e.frequency });
      }
    }
    // distance asc, then frequency desc, then word asc
    all.sort((a, b) => a.distance - b.distance || b.frequency - a.frequency || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
    const candidates = all.slice(0, limit);

    const result: CheckResult = {
      input: rawWord,
      normalized,
      correct,
      threshold,
      limit,
      candidates,
    };
    if (log) {
      this.store.logQuery({
        dictId,
        dictName,
        input: rawWord,
        normalized,
        correct,
        threshold,
        limit,
        candidates,
      });
    }
    return result;
  }

  /** Like check(), but returns distances for every entry (for "explain"). */
  explain(dictId: number, rawWord: string, rawLimit: unknown = 20): { normalized: string; rows: Candidate[] } {
    const normalized = normalizeWord(rawWord);
    const limit = validateLimit(rawLimit);
    const rows: Candidate[] = this.entries(dictId).map((e) => ({
      word: e.word,
      distance: levenshtein(normalized, e.word),
      frequency: e.frequency,
    }));
    rows.sort((a, b) => a.distance - b.distance || b.frequency - a.frequency || (a.word < b.word ? -1 : 1));
    return { normalized, rows: rows.slice(0, limit) };
  }
}
