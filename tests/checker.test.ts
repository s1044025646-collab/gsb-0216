import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Store } from '../src/db.ts';
import { Checker } from '../src/checker.ts';
import { AppError } from '../src/errors.ts';

let dir: string;
let dbPath: string;
let store: Store;
let checker: Checker;
let dictId: number;

const DEMO: Array<{ word: string; frequency: number }> = [
  { word: 'book', frequency: 900 },
  { word: 'boot', frequency: 150 },
  { word: 'boom', frequency: 150 }, // same distance & freq as boot -> alphabetical tie-break
  { word: 'books', frequency: 400 },
  { word: 'cat', frequency: 950 },
  { word: 'bat', frequency: 300 },
  { word: 'cats', frequency: 350 },
  { word: 'spelling', frequency: 500 },
  { word: 'spilling', frequency: 120 },
];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spellcheck-'));
  dbPath = path.join(dir, 'test.db');
  store = new Store(dbPath);
  checker = new Checker(store);
  dictId = store.createDictionary('main');
  store.importEntries(dictId, DEMO);
  checker.invalidate(dictId);
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('correctly spelled word is recognized', () => {
  const r = checker.check(dictId, 'main', 'book');
  assert.equal(r.correct, true);
  assert.equal(r.candidates[0].word, 'book');
  assert.equal(r.candidates[0].distance, 0);
});

test('candidates sorted by distance, then frequency desc, then alphabetical', () => {
  const r = checker.check(dictId, 'main', 'boo', 1, 10);
  // distance 1: book(900), books(400 via insert? "boo"->"books" is 2) ...
  const d1 = r.candidates.filter((c) => c.distance === 1).map((c) => c.word);
  assert.deepEqual(d1, ['book', 'boot', 'boom'].sort((a, b) => {
    const f: Record<string, number> = { book: 900, boot: 150, boom: 150 };
    return f[b] - f[a] || a.localeCompare(b);
  }));
  // tie between boot/boom (same freq) broken alphabetically
  const tie = r.candidates.filter((c) => c.frequency === 150 && c.distance === 1);
  assert.deepEqual(tie.map((c) => c.word), ['boom', 'boot']);
});

test('threshold boundary: distance 2 excluded at threshold=1, included at 2', () => {
  const r1 = checker.check(dictId, 'main', 'boo', 1, 10);
  assert.ok(!r1.candidates.some((c) => c.word === 'books')); // distance 2
  const r2 = checker.check(dictId, 'main', 'boo', 2, 10);
  assert.ok(r2.candidates.some((c) => c.word === 'books' && c.distance === 2));
});

test('threshold above 2 is rejected', () => {
  assert.throws(() => checker.check(dictId, 'main', 'book', 3), (e: any) => e.code === 'INVALID_THRESHOLD');
});

test('case is normalized; original input preserved in log', () => {
  const r = checker.check(dictId, 'main', 'BoOk');
  assert.equal(r.normalized, 'book');
  assert.equal(r.correct, true);
  const log = store.listQueries(1)[0];
  assert.equal(log.input, 'BoOk');
  assert.equal(log.normalized, 'book');
});

test('invalid characters rejected with INVALID_WORD', () => {
  for (const bad of ['book1', 'boo k', 'book!', "don't", '']) {
    assert.throws(() => checker.check(dictId, 'main', bad), (e: any) => e.code === 'INVALID_WORD');
  }
});

test('limit caps result count; empty result when nothing within threshold', () => {
  const r = checker.check(dictId, 'main', 'boo', 2, 2);
  assert.equal(r.candidates.length, 2);
  const none = checker.check(dictId, 'main', 'zzzz', 2, 10);
  assert.equal(none.correct, false);
  assert.deepEqual(none.candidates, []);
});

test('entry deletion takes effect on next query', () => {
  store.deleteEntry(dictId, 'book');
  checker.invalidate(dictId);
  const r = checker.check(dictId, 'main', 'book');
  assert.equal(r.correct, false);
  assert.ok(!r.candidates.some((c) => c.word === 'book'));
});

test('duplicate word rejected', () => {
  assert.throws(() => store.addEntry(dictId, 'BOOK', 5), (e: any) => e.code === 'DUPLICATE_WORD');
});

test('bad frequency rejected', () => {
  for (const f of [-1, 1.5, NaN, 'abc']) {
    assert.throws(() => store.addEntry(dictId, 'newword', f), (e: any) => e.code === 'INVALID_FREQUENCY');
  }
});

test('failed import rolls back completely', () => {
  const before = store.listEntries(dictId).length;
  assert.throws(
    () =>
      store.importEntries(dictId, [
        { word: 'alpha', frequency: 1 },
        { word: 'book', frequency: 1 }, // duplicate of existing
      ]),
    (e: any) => e.code === 'IMPORT_FAILED'
  );
  assert.equal(store.listEntries(dictId).length, before);
  assert.throws(
    () => store.importEntries(dictId, [{ word: 'bad word!', frequency: 1 }]),
    (e: any) => e.code === 'IMPORT_FAILED'
  );
  assert.equal(store.listEntries(dictId).length, before);
});

test('dictionaries are isolated from each other', () => {
  const other = store.createDictionary('other');
  store.importEntries(other, [{ word: 'zebra', frequency: 10 }]);
  checker.invalidate(other);
  const r = checker.check(other, 'other', 'book');
  assert.equal(r.correct, false);
  assert.deepEqual(r.candidates, []);
});

test('query history survives restart with original input and output', () => {
  checker.check(dictId, 'main', 'Speling', 2, 5);
  store.close();
  const store2 = new Store(dbPath);
  const log = store2.listQueries(10);
  assert.equal(log.length, 1);
  assert.equal(log[0].input, 'Speling');
  assert.equal(log[0].normalized, 'speling');
  const candidates = JSON.parse(log[0].candidates);
  assert.equal(candidates[0].word, 'spelling');
  // dictionary still works after restart
  const checker2 = new Checker(store2);
  const r = checker2.check(dictId, 'main', 'speling');
  assert.equal(r.candidates[0].word, 'spelling');
  store2.close();
  // reopen handle for afterEach cleanup
  store = new Store(dbPath);
});
