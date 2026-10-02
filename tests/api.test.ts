import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Store } from '../src/db.ts';
import { startServer } from '../src/server.ts';

let store: Store;
let server: any;
let base: string;
let dir: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spellcheck-api-'));
  store = new Store(path.join(dir, 'api.db'));
  const started = await startServer(store, 0); // free port
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
  await fetch(`${base}/dictionaries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'api' }),
  });
  await fetch(`${base}/dictionaries/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entries: [
        { word: 'hello', frequency: 100 },
        { word: 'hell', frequency: 50 },
        { word: 'help', frequency: 40 },
      ],
    }),
  });
});

after(async () => {
  server.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GET check returns candidates', async () => {
  const res = await fetch(`${base}/dictionaries/api/check?word=helo&threshold=2&limit=5`);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.normalized, 'helo');
  // both "hello" and "hell" are distance 1; higher frequency wins
  assert.equal(body.candidates[0].word, 'hello');
  assert.equal(body.candidates[1].word, 'hell');
});

test('error codes: invalid word / threshold / missing dict', async () => {
  let body: any = await (await fetch(`${base}/dictionaries/api/check?word=he11o`)).json();
  assert.equal(body.error.code, 'INVALID_WORD');
  body = await (await fetch(`${base}/dictionaries/api/check?word=hello&threshold=5`)).json();
  assert.equal(body.error.code, 'INVALID_THRESHOLD');
  const res = await fetch(`${base}/dictionaries/nope/check?word=hello`);
  assert.equal(res.status, 404);
  body = await res.json();
  assert.equal(body.error.code, 'DICT_NOT_FOUND');
});

test('entry CRUD via API affects subsequent checks', async () => {
  await fetch(`${base}/dictionaries/api/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word: 'world', frequency: 10 }),
  });
  let body: any = await (await fetch(`${base}/dictionaries/api/check?word=world`)).json();
  assert.equal(body.correct, true);
  await fetch(`${base}/dictionaries/api/entries/world`, { method: 'DELETE' });
  body = await (await fetch(`${base}/dictionaries/api/check?word=world`)).json();
  assert.equal(body.correct, false);
});

test('query history endpoint records checks', async () => {
  const body: any = await (await fetch(`${base}/queries?limit=10`)).json();
  assert.ok(body.queries.length >= 3);
  assert.ok(body.queries.some((q: any) => q.input === 'helo'));
});

test('export endpoint lists entries', async () => {
  const body: any = await (await fetch(`${base}/dictionaries/api/entries`)).json();
  assert.ok(body.entries.some((e: any) => e.word === 'hello'));
});
