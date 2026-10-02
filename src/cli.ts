import * as fs from 'node:fs';
import { openDatabase } from './db';
import { SpellService, parseWordlist } from './service';
import { ApiError } from './errors';

const USAGE = `用法: node dist/cli.js <命令> [参数]

命令:
  serve [--port N]                     启动 HTTP 服务（默认自动选空闲端口）
  create-group <name>                  创建词典分组
  groups                               列出分组
  import <group> <file.csv>            批量导入词表（每行 word,freq）
  add <group> <word> <freq>            新增词条
  update <group> <word> <freq>         修改词频
  remove <group> <word>                删除词条
  words <group>                        列出词条
  check <group> <word> [--threshold 0-2] [--limit N]
  explain <group> <from> <to>          解释两个词的编辑距离
  history <group> [limit]              查看查询历史
  export <group> [file]                导出词表（CSV）
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || cmd === 'help' || cmd === '--help') {
    process.stdout.write(USAGE);
    return;
  }
  if (cmd === 'serve') {
    const { createServer } = await import('./server');
    const service = new SpellService(openDatabase());
    const port = flag(args, '--port') ? Number(flag(args, '--port')) : Number(process.env.PORT ?? 0);
    const server = createServer(service);
    server.listen(port, () => {
      console.log(`拼写检查服务已启动: http://127.0.0.1:${(server.address() as any).port}`);
    });
    return;
  }
  const service = new SpellService(openDatabase());
  const out = (v: unknown) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  switch (cmd) {
    case 'create-group':
      return out(service.createGroup(args[0]));
    case 'groups':
      return out(service.listGroups());
    case 'import': {
      const [group, file] = args;
      if (!group || !file) throw new ApiError('BAD_REQUEST', '用法: import <group> <file.csv>');
      const text = fs.readFileSync(file, 'utf-8');
      return out(service.importWords(parseWordlist(text), group));
    }
    case 'add':
      return out(service.addWord(args[1], args[2], args[0]));
    case 'update':
      return out(service.updateWord(args[1], args[2], args[0]));
    case 'remove':
      return out(service.deleteWord(args[1], args[0]));
    case 'words':
      return out(service.listWords(args[0]));
    case 'check':
      return out(
        service.check(args[1], args[0], flag(args, '--threshold'), flag(args, '--limit'))
      );
    case 'explain':
      return out(service.explain(args[1], args[2], args[0]));
    case 'history':
      return out(service.history(args[0], args[1] ? Number(args[1]) : 50));
    case 'export': {
      const csv = service.exportWords(args[0]);
      if (args[1]) {
        fs.writeFileSync(args[1], csv, 'utf-8');
        return out(`已导出到 ${args[1]}`);
      }
      return out(csv);
    }
    default:
      process.stderr.write(USAGE);
      throw new ApiError('BAD_REQUEST', `未知命令: ${cmd}`);
  }
}

main().catch((e) => {
  if (e instanceof ApiError) {
    console.error(`错误 [${e.code}] ${e.message}`);
    if (e.details) console.error(JSON.stringify(e.details, null, 2));
  } else {
    console.error(`错误 ${e.message ?? e}`);
  }
  process.exitCode = 1;
});
