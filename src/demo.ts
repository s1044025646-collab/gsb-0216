// 演示脚本：导入演示词表，展示漏字/多字/替换三类错误的候选，
// 再调整词频观察同距离候选顺序变化，最后做批量查询计时。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDatabase } from './db';
import { SpellService, parseWordlist } from './service';

function show(title: string, result: any) {
  console.log(`\n=== ${title} ===`);
  console.log(`输入: ${result.input}  正确拼写: ${result.correct}`);
  if (result.candidates.length === 0) {
    console.log('候选: （空）');
  } else {
    for (const c of result.candidates) {
      console.log(`  ${c.word}  距离=${c.distance}  词频=${c.freq}`);
    }
  }
}

function main() {
  const dbFile = path.join(process.cwd(), 'data', 'demo.db');
  if (fs.existsSync(dbFile)) fs.rmSync(dbFile);
  const service = new SpellService(openDatabase(dbFile));

  service.createGroup('demo');
  const demoCsv = fs.readFileSync(path.join(process.cwd(), 'data', 'demo-words.csv'), 'utf-8');
  const report = service.importWords(parseWordlist(demoCsv), 'demo');
  console.log(`导入演示词表: ${report.inserted} 个词条`);

  show('漏字（recieve -> receive）', service.check('recieve', 'demo', 2, 5));
  show('多字（spellingg -> spelling）', service.check('spellingg', 'demo', 2, 5));
  show('替换（form -> from 等）', service.check('from', 'demo', 1, 5));
  show('替换错误（frend -> friend）', service.check('frend', 'demo', 2, 5));

  console.log('\n=== 调整词频前：helo 的同距离候选 ===');
  service.addWord('hell', 100, 'demo');
  service.addWord('help', 100, 'demo');
  service.addWord('hero', 100, 'demo');
  show('helo（三个候选距离均为 1，词频相同，按字典序）', service.check('helo', 'demo', 2, 5));
  service.updateWord('hero', 9999, 'demo');
  show('把 hero 词频调到 9999 后（同距离按词频降序）', service.check('helo', 'demo', 2, 5));

  // 批量查询计时
  const bulkFile = path.join(process.cwd(), 'data', 'bulk-words.csv');
  if (!fs.existsSync(bulkFile)) {
    console.log('\n未找到 data/bulk-words.csv，请先运行 npm run gen-data');
    return;
  }
  service.createGroup('bulk');
  const bulkReport = service.importWords(parseWordlist(fs.readFileSync(bulkFile, 'utf-8')), 'bulk');
  console.log(`\n导入批量词表: ${bulkReport.inserted} 个词条`);
  const samples = ['kanero', 'tuvami', 'zolape', 'mireku', 'sabino', 'word', 'helo', 'frend'];
  const t0 = process.hrtime.bigint();
  const ROUNDS = 200;
  for (let i = 0; i < ROUNDS; i++) {
    service.check(samples[i % samples.length], 'bulk', 2, 10);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`批量查询: ${ROUNDS} 次 / ${bulkReport.inserted} 词条，总耗时 ${ms.toFixed(1)} ms，平均 ${(ms / ROUNDS).toFixed(2)} ms/次`);
}

main();
