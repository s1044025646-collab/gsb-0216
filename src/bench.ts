/**
 * Bulk-query benchmark: imports the generated ~6000-word dictionary into a
 * fresh database, runs 500 spell-check queries, and reports elapsed time.
 * No strict performance target — informational only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Store } from './db.ts';
import { Checker } from './checker.ts';
import { parseWordlistFile } from './server.ts';

const dataDir = path.join(process.cwd(), 'data');
const listFile = path.join(dataDir, 'bulk-dict.txt');
if (!fs.existsSync(listFile)) {
  console.error('bulk word list missing — run `npm run gen:words` first');
  process.exit(1);
}

const dbPath = path.join(dataDir, 'bench.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(dbPath + suffix); } catch { /* ignore */ }
}

const store = new Store(dbPath);
const checker = new Checker(store);
const dictId = store.createDictionary('bulk');

let t0 = performance.now();
const items = parseWordlistFile(listFile);
const imported = store.importEntries(dictId, items);
checker.invalidate(dictId);
const importMs = performance.now() - t0;

// deterministic pseudo-random queries: some correct, some mutated
let seed = 42;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const words = items.map((i) => i.word);
const queries: string[] = [];
for (let i = 0; i < 500; i++) {
  const w = words[Math.floor(rnd() * words.length)];
  const mode = rnd();
  if (mode < 0.34) queries.push(w); // correct
  else if (mode < 0.67) queries.push(w.slice(0, Math.max(1, w.length - 1))); // missing letter
  else queries.push(w + 'q'); // extra letter
}

t0 = performance.now();
let hits = 0;
for (const q of queries) {
  const r = checker.check(dictId, 'bulk', q, 2, 10);
  if (r.candidates.length > 0) hits++;
}
const queryMs = performance.now() - t0;

console.log(`dictionary size : ${imported} entries`);
console.log(`import time     : ${importMs.toFixed(1)} ms`);
console.log(`queries         : ${queries.length} (threshold=2, limit=10)`);
console.log(`query time      : ${queryMs.toFixed(1)} ms total, ${(queryMs / queries.length).toFixed(2)} ms/query avg`);
console.log(`with candidates : ${hits}/${queries.length}`);
store.close();
