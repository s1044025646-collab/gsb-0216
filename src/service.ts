import { DatabaseSync } from 'node:sqlite';
import { levenshtein } from './levenshtein';
import { ApiError } from './errors';
import {
  normalizeWord,
  validateFreq,
  validateGroupName,
  validateLimit,
  validateThreshold,
} from './validate';

export interface Candidate {
  word: string;
  freq: number;
  distance: number;
}

export interface CheckResult {
  input: string;
  normalized: string;
  group: string;
  threshold: number;
  limit: number;
  correct: boolean;
  candidates: Candidate[];
}

export interface ImportReport {
  inserted: number;
  skippedDuplicates: string[];
}

export class SpellService {
  constructor(private db: DatabaseSync) {}

  createGroup(rawName: unknown): { id: number; name: string } {
    const name = validateGroupName(rawName);
    try {
      const r = this.db
        .prepare('INSERT INTO groups (name) VALUES (?)')
        .run(name);
      return { id: Number(r.lastInsertRowid), name };
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        throw new ApiError('DUPLICATE_GROUP', `词典分组已存在: ${name}`, 409);
      }
      throw e;
    }
  }

  listGroups(): { id: number; name: string; wordCount: number }[] {
    return this.db
      .prepare(
        `SELECT g.id, g.name, COUNT(w.id) AS wordCount
         FROM groups g LEFT JOIN words w ON w.group_id = g.id
         GROUP BY g.id ORDER BY g.name`
      )
      .all() as any;
  }

  private groupId(name: string): number {
    const row = this.db
      .prepare('SELECT id FROM groups WHERE name = ?')
      .get(name) as { id: number } | undefined;
    if (!row) throw new ApiError('GROUP_NOT_FOUND', `词典分组不存在: ${name}`, 404);
    return row.id;
  }

  addWord(rawWord: unknown, rawFreq: unknown, groupName: string): { word: string; freq: number } {
    const word = normalizeWord(rawWord);
    const freq = validateFreq(rawFreq);
    const gid = this.groupId(groupName);
    try {
      this.db.prepare('INSERT INTO words (group_id, word, freq) VALUES (?, ?, ?)').run(gid, word, freq);
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        throw new ApiError('DUPLICATE_WORD', `词条已存在: ${word}（分组 ${groupName}）`, 409);
      }
      throw e;
    }
    return { word, freq };
  }

  updateWord(rawWord: unknown, rawFreq: unknown, groupName: string): { word: string; freq: number } {
    const word = normalizeWord(rawWord);
    const freq = validateFreq(rawFreq);
    const gid = this.groupId(groupName);
    const r = this.db
      .prepare("UPDATE words SET freq = ?, updated_at = datetime('now') WHERE group_id = ? AND word = ?")
      .run(freq, gid, word);
    if (r.changes === 0) {
      throw new ApiError('WORD_NOT_FOUND', `词条不存在: ${word}（分组 ${groupName}）`, 404);
    }
    return { word, freq };
  }

  deleteWord(rawWord: unknown, groupName: string): { word: string } {
    const word = normalizeWord(rawWord);
    const gid = this.groupId(groupName);
    const r = this.db.prepare('DELETE FROM words WHERE group_id = ? AND word = ?').run(gid, word);
    if (r.changes === 0) {
      throw new ApiError('WORD_NOT_FOUND', `词条不存在: ${word}（分组 ${groupName}）`, 404);
    }
    return { word };
  }

  // 批量导入：先全量校验，任何非法行都会整体中止（事务回滚），不留下部分结果。
  // 重复词条（文件内重复或库中已存在）跳过并在报告中列出。
  importWords(
    entries: { word: unknown; freq: unknown }[],
    groupName: string
  ): ImportReport {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new ApiError('BAD_REQUEST', '导入内容必须是非空数组');
    }
    const gid = this.groupId(groupName);
    const errors: { index: number; word: unknown; error: string }[] = [];
    const normalized: { word: string; freq: number }[] = [];
    entries.forEach((e, i) => {
      try {
        normalized.push({ word: normalizeWord(e?.word), freq: validateFreq(e?.freq) });
      } catch (err: any) {
        errors.push({ index: i, word: e?.word, error: err.message });
      }
    });
    if (errors.length > 0) {
      throw new ApiError('IMPORT_FAILED', `导入失败：${errors.length} 行非法，未写入任何数据`, 400, errors);
    }
    const seen = new Set<string>();
    const skippedDuplicates: string[] = [];
    const insert = this.db.prepare('INSERT INTO words (group_id, word, freq) VALUES (?, ?, ?)');
    const exists = this.db.prepare('SELECT 1 FROM words WHERE group_id = ? AND word = ?');
    let inserted = 0;
    this.db.exec('BEGIN');
    try {
      for (const { word, freq } of normalized) {
        if (seen.has(word) || exists.get(gid, word)) {
          skippedDuplicates.push(word);
          continue;
        }
        seen.add(word);
        insert.run(gid, word, freq);
        inserted++;
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { inserted, skippedDuplicates };
  }

  listWords(groupName: string): { word: string; freq: number }[] {
    const gid = this.groupId(groupName);
    return this.db
      .prepare('SELECT word, freq FROM words WHERE group_id = ? ORDER BY word')
      .all(gid) as any;
  }

  check(
    rawWord: unknown,
    groupName: string,
    rawThreshold?: unknown,
    rawLimit?: unknown
  ): CheckResult {
    if (typeof rawWord !== 'string') {
      throw new ApiError('INVALID_WORD', '单词必须是非空字符串');
    }
    const input = rawWord; // 保留用户输入原文
    const normalized = normalizeWord(rawWord);
    const threshold = validateThreshold(rawThreshold);
    const limit = validateLimit(rawLimit);
    const gid = this.groupId(groupName);

    const rows = this.db
      .prepare('SELECT word, freq FROM words WHERE group_id = ?')
      .all(gid) as { word: string; freq: number }[];

    const exact = rows.find((r) => r.word === normalized);
    let candidates: Candidate[] = [];
    if (!exact) {
      candidates = rows
        .map((r) => ({ word: r.word, freq: r.freq, distance: levenshtein(normalized, r.word) }))
        .filter((c) => c.distance <= threshold)
        .sort((a, b) => a.distance - b.distance || b.freq - a.freq || (a.word < b.word ? -1 : 1))
        .slice(0, limit);
    }
    const result: CheckResult = {
      input,
      normalized,
      group: groupName,
      threshold,
      limit,
      correct: Boolean(exact),
      candidates,
    };
    this.db
      .prepare(
        'INSERT INTO queries (group_id, input, normalized, threshold, limit_n, correct, candidates_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(gid, input, normalized, threshold, limit, exact ? 1 : 0, JSON.stringify(candidates));
    return result;
  }

  explain(rawFrom: unknown, rawTo: unknown, groupName: string) {
    const from = normalizeWord(rawFrom);
    const to = normalizeWord(rawTo);
    this.groupId(groupName);
    return {
      from,
      to,
      distance: levenshtein(from, to),
      note: '标准 Levenshtein 距离：插入/删除/替换各计一步，不含相邻交换',
    };
  }

  history(groupName: string, limit = 50) {
    const gid = this.groupId(groupName);
    const rows = this.db
      .prepare(
        'SELECT id, input, normalized, threshold, limit_n AS limitN, correct, candidates_json, created_at FROM queries WHERE group_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(gid, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      input: r.input,
      normalized: r.normalized,
      threshold: r.threshold,
      limit: r.limitN,
      correct: Boolean(r.correct),
      candidates: JSON.parse(r.candidates_json),
      createdAt: r.created_at,
    }));
  }

  exportWords(groupName: string): string {
    const words = this.listWords(groupName);
    return words.map((w) => `${w.word},${w.freq}`).join('\n') + (words.length ? '\n' : '');
  }
}

// 解析 CSV 词表文件：每行 "word,freq"，允许 # 开头的注释与空行。
export function parseWordlist(text: string): { word: string; freq: number }[] {
  const out: { word: string; freq: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.lastIndexOf(',');
    if (idx < 0) {
      out.push({ word: t, freq: NaN });
    } else {
      out.push({ word: t.slice(0, idx).trim(), freq: Number(t.slice(idx + 1).trim()) });
    }
  }
  return out;
}
