/**
 * Demo: builds a fresh demo database and shows
 *  1) a missing-letter typo   ("speling"  -> "spelling")
 *  2) an extra-letter typo    ("bookk"    -> "book")
 *  3) a substitution typo     ("recieve"  -> "receive")
 *  4) how changing a frequency reorders same-distance candidates
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Store } from './db.ts';
import { Checker } from './checker.ts';
import { parseWordlistFile } from './server.ts';

const dbPath = path.join(process.cwd(), 'data', 'demo.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(dbPath + suffix); } catch { /* ignore */ }
}

const store = new Store(dbPath);
const checker = new Checker(store);

const dictId = store.createDictionary('demo');
const items = parseWordlistFile(path.join(process.cwd(), 'data', 'demo-dict.txt'));
const n = store.importEntries(dictId, items);
checker.invalidate(dictId);
console.log(`== imported ${n} demo entries ==\n`);

function show(word: string, note: string): void {
  const r = checker.check(dictId, 'demo', word, 2, 5);
  console.log(`-- ${note}: check "${word}" (correct=${r.correct})`);
  for (const c of r.candidates) {
    console.log(`   ${c.word.padEnd(14)} distance=${c.distance}  frequency=${c.frequency}`);
  }
  if (r.candidates.length === 0) console.log('   (no candidates)');
  console.log();
}

show('speling', 'missing letter');
show('bookk', 'extra letter');
show('definately', 'substitution (a -> i)');

console.log('== frequency tuning: "ther" candidates before/after boosting "their" ==');
show('ther', 'before');
store.updateEntry(dictId, 'their', 5000);
checker.invalidate(dictId);
show('ther', 'after "their" frequency -> 5000');

console.log('== query history (persisted in data/demo.db) ==');
for (const q of store.listQueries(10)) {
  console.log(`#${q.id} input="${q.input}" correct=${!!q.correct} candidates=${q.candidates}`);
}
store.close();
