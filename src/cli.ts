#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Store, defaultDbPath } from './db.ts';
import { Checker } from './checker.ts';
import { startServer, parseWordlistFile } from './server.ts';
import { AppError } from './errors.ts';

const USAGE = [
  'spellcheck - local dictionary spell-check backend',
  '',
  'Usage: node src/cli.ts <command> [args]',
  '',
  'Commands:',
  '  serve [--port N]                      Start HTTP API (default: pick a free port)',
  '  dict-create <name>                    Create a dictionary group',
  '  dict-list                             List dictionary groups',
  '  import <dict> <file>                  Batch import word list ("word[,freq]" per line)',
  '  add <dict> <word> [freq]              Add an entry',
  '  update <dict> <word> <freq>           Update entry frequency',
  '  remove <dict> <word>                  Delete an entry',
  '  check <dict> <word> [--threshold 0-2] [--limit N]',
  '  explain <dict> <word> [--limit N]     Show edit distance to nearest entries',
  '  history [--limit N]                   Show query log',
  '  export <dict>                         Export entries as JSON',
  '',
  'Env: SPELLCHECK_DB overrides the database path (default: data/spellcheck.db).',
].join('\n');

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function run(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(USAGE);
    return;
  }
  const store = new Store(defaultDbPath());
  const checker = new Checker(store);
  try {
    switch (cmd) {
      case 'serve': {
        const p = flag(args, 'port');
        const { port: actual } = await startServer(store, p ? Number(p) : 0);
        console.log(`API listening on http://127.0.0.1:${actual}  (db: ${defaultDbPath()})`);
        return; // keep process alive
      }
      case 'dict-create': {
        const id = store.createDictionary(args[0]);
        console.log(`created dictionary "${args[0]}" (id=${id})`);
        break;
      }
      case 'dict-list': {
        console.table(store.listDictionaries());
        break;
      }
      case 'import': {
        const [dict, file] = args;
        const dictId = store.getDictionaryId(dict);
        const items = parseWordlistFile(file);
        const n = store.importEntries(dictId, items);
        checker.invalidate(dictId);
        console.log(`imported ${n} entries into "${dict}"`);
        break;
      }
      case 'add': {
        const dictId = store.getDictionaryId(args[0]);
        store.addEntry(dictId, args[1], args[2] ?? 0);
        checker.invalidate(dictId);
        console.log('ok');
        break;
      }
      case 'update': {
        const dictId = store.getDictionaryId(args[0]);
        store.updateEntry(dictId, args[1], args[2]);
        checker.invalidate(dictId);
        console.log('ok');
        break;
      }
      case 'remove': {
        const dictId = store.getDictionaryId(args[0]);
        store.deleteEntry(dictId, args[1]);
        checker.invalidate(dictId);
        console.log('ok');
        break;
      }
      case 'check': {
        const dictId = store.getDictionaryId(args[0]);
        const r = checker.check(
          dictId,
          args[0],
          args[1],
          flag(args, 'threshold') ?? 2,
          flag(args, 'limit') ?? 10
        );
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case 'explain': {
        const dictId = store.getDictionaryId(args[0]);
        const r = checker.explain(dictId, args[1], flag(args, 'limit') ?? 20);
        console.table(r.rows);
        break;
      }
      case 'history': {
        const limit = Number(flag(args, 'limit') ?? 20);
        for (const q of store.listQueries(limit)) {
          console.log(
            `#${q.id} [${q.created_at}] dict=${q.dict_name} input="${q.input}" correct=${q.correct ? 'yes' : 'no'} candidates=${q.candidates}`
          );
        }
        break;
      }
      case 'export': {
        const dictId = store.getDictionaryId(args[0]);
        console.log(JSON.stringify(store.listEntries(dictId), null, 2));
        break;
      }
      default:
        console.error(`unknown command: ${cmd}\n${USAGE}`);
        process.exitCode = 2;
    }
  } finally {
    if (cmd !== 'serve') store.close();
  }
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  run(process.argv.slice(2)).catch((e) => {
    if (e instanceof AppError) {
      console.error(`error [${e.code}]: ${e.message}`);
    } else {
      console.error(`error: ${e?.message ?? e}`);
    }
    process.exitCode = 1;
  });
}
