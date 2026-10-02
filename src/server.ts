import * as http from 'node:http';
import * as fs from 'node:fs';
import { Store } from './db.ts';
import { Checker } from './checker.ts';
import { AppError } from './errors.ts';

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function sendError(res: http.ServerResponse, e: unknown): void {
  if (e instanceof AppError) {
    send(res, e.status, { error: { code: e.code, message: e.message, details: e.details ?? null } });
  } else {
    send(res, 500, { error: { code: 'INTERNAL_ERROR', message: String((e as Error)?.message ?? e) } });
  }
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError('BAD_REQUEST', 'request body must be valid JSON');
  }
}

export function createServer(store: Store): http.Server {
  const checker = new Checker(store);

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const method = req.method ?? 'GET';

      // GET /health
      if (method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true });
      }

      // GET /dictionaries | POST /dictionaries {name}
      if (parts.length === 1 && parts[0] === 'dictionaries') {
        if (method === 'GET') return send(res, 200, { dictionaries: store.listDictionaries() });
        if (method === 'POST') {
          const body = await readBody(req);
          const id = store.createDictionary(body.name);
          return send(res, 201, { id, name: body.name });
        }
      }

      // /dictionaries/:dict/...
      if (parts[0] === 'dictionaries' && parts.length >= 2) {
        const dictId = store.getDictionaryId(parts[1]);

        // POST /dictionaries/:dict/import  {entries:[{word,frequency}]}
        if (parts.length === 3 && parts[2] === 'import' && method === 'POST') {
          const body = await readBody(req);
          const count = store.importEntries(dictId, body.entries);
          checker.invalidate(dictId);
          return send(res, 201, { imported: count });
        }

        // GET /dictionaries/:dict/entries  (export)
        if (parts.length === 3 && parts[2] === 'entries' && method === 'GET') {
          return send(res, 200, { entries: store.listEntries(dictId) });
        }

        // POST /dictionaries/:dict/entries {word, frequency}
        if (parts.length === 3 && parts[2] === 'entries' && method === 'POST') {
          const body = await readBody(req);
          store.addEntry(dictId, body.word, body.frequency ?? 0);
          checker.invalidate(dictId);
          return send(res, 201, { ok: true });
        }

        // PATCH/DELETE /dictionaries/:dict/entries/:word
        if (parts.length === 4 && parts[2] === 'entries') {
          if (method === 'PATCH' || method === 'PUT') {
            const body = await readBody(req);
            store.updateEntry(dictId, parts[3], body.frequency);
            checker.invalidate(dictId);
            return send(res, 200, { ok: true });
          }
          if (method === 'DELETE') {
            store.deleteEntry(dictId, parts[3]);
            checker.invalidate(dictId);
            return send(res, 200, { ok: true });
          }
        }

        // GET /dictionaries/:dict/check?word=&threshold=&limit=
        if (parts.length === 3 && parts[2] === 'check' && method === 'GET') {
          const word = url.searchParams.get('word');
          if (word === null) throw new AppError('BAD_REQUEST', 'missing query parameter "word"');
          const result = checker.check(
            dictId,
            parts[1],
            word,
            url.searchParams.get('threshold') ?? 2,
            url.searchParams.get('limit') ?? 10
          );
          return send(res, 200, result);
        }

        // GET /dictionaries/:dict/explain?word=&limit=
        if (parts.length === 3 && parts[2] === 'explain' && method === 'GET') {
          const word = url.searchParams.get('word');
          if (word === null) throw new AppError('BAD_REQUEST', 'missing query parameter "word"');
          return send(res, 200, checker.explain(dictId, word, url.searchParams.get('limit') ?? 20));
        }
      }

      // GET /queries?limit=
      if (parts.length === 1 && parts[0] === 'queries' && method === 'GET') {
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 500);
        return send(res, 200, { queries: store.listQueries(limit) });
      }

      throw new AppError('NOT_FOUND', `no route for ${method} ${url.pathname}`, 404);
    } catch (e) {
      sendError(res, e);
    }
  });
}

/** Start the server. Port 0 (default) picks a free port automatically. */
export function startServer(store: Store, port = 0): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(store);
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, port: actual });
    });
  });
}

/** Parse a word-list file: one "word[,frequency]" per line, '#' comments. */
export function parseWordlistFile(file: string): Array<{ word: string; frequency: number }> {
  const text = fs.readFileSync(file, 'utf8');
  const items: Array<{ word: string; frequency: number }> = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [w, f] = t.split(/[,\t]/).map((s) => s.trim());
    items.push({ word: w, frequency: f === undefined || f === '' ? 0 : Number(f) });
  }
  return items;
}
