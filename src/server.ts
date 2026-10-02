import * as http from 'node:http';
import { openDatabase } from './db';
import { SpellService } from './service';
import { ApiError } from './errors';

export function createServer(service: SpellService): http.Server {
  return http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      const payload = JSON.stringify(body, null, 2);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(payload);
    };
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const q = url.searchParams;
      const body = await readBody(req);
      const json = body ? JSON.parse(body) : {};

      // 路由
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/groups') {
        return send(201, service.createGroup(json.name));
      }
      if (req.method === 'GET' && url.pathname === '/groups') {
        return send(200, service.listGroups());
      }
      if (parts[0] === 'groups' && parts.length >= 2) {
        const group = parts[1];
        if (req.method === 'POST' && parts[2] === 'words' && parts.length === 3) {
          return send(201, service.addWord(json.word, json.freq, group));
        }
        if (req.method === 'GET' && parts[2] === 'words' && parts.length === 3) {
          return send(200, service.listWords(group));
        }
        if (req.method === 'PUT' && parts[2] === 'words' && parts.length === 4) {
          return send(200, service.updateWord(parts[3], json.freq, group));
        }
        if (req.method === 'DELETE' && parts[2] === 'words' && parts.length === 4) {
          return send(200, service.deleteWord(parts[3], group));
        }
        if (req.method === 'POST' && parts[2] === 'import' && parts.length === 3) {
          return send(200, service.importWords(json.words, group));
        }
        if (req.method === 'GET' && parts[2] === 'history' && parts.length === 3) {
          return send(200, service.history(group, q.get('limit') ? Number(q.get('limit')) : 50));
        }
        if (req.method === 'GET' && parts[2] === 'export' && parts.length === 3) {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end(service.exportWords(group));
        }
      }
      if (req.method === 'GET' && url.pathname === '/check') {
        return send(
          200,
          service.check(q.get('word') ?? json.word, q.get('group') ?? '', q.get('threshold'), q.get('limit'))
        );
      }
      if (req.method === 'POST' && url.pathname === '/check') {
        return send(200, service.check(json.word, json.group ?? '', json.threshold, json.limit));
      }
      if (req.method === 'GET' && url.pathname === '/explain') {
        return send(200, service.explain(q.get('from'), q.get('to'), q.get('group') ?? ''));
      }
      throw new ApiError('NOT_FOUND', `路由不存在: ${req.method} ${url.pathname}`, 404);
    } catch (e: any) {
      if (e instanceof ApiError) {
        return send(e.status, { error: { code: e.code, message: e.message, details: e.details } });
      }
      if (e instanceof SyntaxError) {
        return send(400, { error: { code: 'BAD_REQUEST', message: '请求体不是合法 JSON' } });
      }
      return send(500, { error: { code: 'INTERNAL', message: String(e.message ?? e) } });
    }
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5 * 1024 * 1024) reject(new ApiError('BAD_REQUEST', '请求体过大', 413));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

if (require.main === module) {
  const db = openDatabase();
  const service = new SpellService(db);
  // 端口可通过 PORT 环境变量或 --port 参数配置；默认 0 表示自动选择空闲端口。
  const argIdx = process.argv.indexOf('--port');
  const port = argIdx > 0 ? Number(process.argv[argIdx + 1]) : Number(process.env.PORT ?? 0);
  const server = createServer(service);
  server.listen(port, () => {
    const addr = server.address() as any;
    console.log(`拼写检查服务已启动: http://127.0.0.1:${addr.port}`);
  });
}
