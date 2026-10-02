import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { levenshtein } from '../src/levenshtein';
import { openDatabase } from '../src/db';
import { SpellService, parseWordlist } from '../src/service';
import { ApiError } from '../src/errors';

function makeService(): { service: SpellService; dir: string; dbFile: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spelltest-'));
  const dbFile = path.join(dir, 'test.db');
  const service = new SpellService(openDatabase(dbFile));
  service.createGroup('g');
  return { service, dir, dbFile };
}

// 1. 事先给定的词对核对编辑距离
test('levenshtein 已知词对', () => {
  const pairs: [string, string, number][] = [
    ['kitten', 'sitting', 3],
    ['flaw', 'lawn', 2],
    ['book', 'back', 2],
    ['', '', 0],
    ['a', '', 1],
    ['abc', 'abc', 0],
    ['abc', 'abd', 1],
    ['abc', 'abcd', 1],
    ['abcd', 'acd', 1],
    ['receive', 'recieve', 2], // 相邻交换按普通编辑距离计为 2
    ['saturday', 'sunday', 3],
  ];
  for (const [a, b, d] of pairs) {
    assert.equal(levenshtein(a, b), d, `${a} <-> ${b}`);
    assert.equal(levenshtein(b, a), d, `${b} <-> ${a}（对称）`);
  }
});

// 2. 正确拼写的词被明确识别
test('正确词识别', () => {
  const { service } = makeService();
  service.addWord('hello', 100, 'g');
  const r = service.check('hello', 'g');
  assert.equal(r.correct, true);
  assert.deepEqual(r.candidates, []);
});

// 3. 阈值边界：距离 2 的词在 threshold=1 时不出现，threshold=2 时出现
test('阈值边界', () => {
  const { service } = makeService();
  service.addWord('kitten', 10, 'g');
  service.addWord('sitting', 10, 'g');
  const r1 = service.check('kitten', 'g', 0, 10);
  assert.equal(r1.correct, true);
  const r2 = service.check('kittn', 'g', 1, 10);
  assert.deepEqual(r2.candidates.map((c) => c.word), ['kitten']);
  const r3 = service.check('kiten', 'g', 1, 10); // 距离 kitten 为 1? kiten->kitten 插 1
  assert.ok(r3.candidates.some((c) => c.word === 'kitten'));
  const r4 = service.check('sittin', 'g', 1, 10);
  assert.deepEqual(r4.candidates.map((c) => c.word), ['sitting']);
  const r5 = service.check('sittin', 'g', 0, 10);
  assert.deepEqual(r5.candidates, []);
});

// 4. 大小写统一处理，原文保留
test('大小写归一与原文保留', () => {
  const { service } = makeService();
  service.addWord('Hello', 50, 'g'); // 存储为小写
  const r = service.check('HELLO', 'g');
  assert.equal(r.correct, true);
  assert.equal(r.input, 'HELLO');
  assert.equal(r.normalized, 'hello');
});

// 5. 并列排序：同距离先词频降序，再字典序
test('候选排序规则', () => {
  const { service } = makeService();
  service.addWord('bar', 5, 'g');
  service.addWord('bat', 50, 'g');
  service.addWord('bad', 50, 'g');
  const r = service.check('ban', 'g', 1, 10);
  assert.deepEqual(
    r.candidates.map((c) => c.word),
    ['bad', 'bat', 'bar'] // bad/bat 词频 50 并列按字典序，bar 词频低排后
  );
});

// 6. 词条删除后不再出现在候选中，但历史记录保留当时输出
test('词条删除与历史保留', () => {
  const { service } = makeService();
  service.addWord('alpha', 10, 'g');
  const before = service.check('alpa', 'g', 1, 10);
  assert.deepEqual(before.candidates.map((c) => c.word), ['alpha']);
  service.deleteWord('alpha', 'g');
  const after = service.check('alpa', 'g', 1, 10);
  assert.deepEqual(after.candidates, []);
  const hist = service.history('g');
  assert.equal(hist.length, 2);
  const old = hist.find((h) => h.id !== undefined && h.candidates.length > 0);
  assert.ok(old, '历史记录中应保留删除前的候选结果');
  assert.equal(old!.candidates[0].word, 'alpha');
});

// 7. 错误导入：非法行导致整体失败，不留下部分结果
test('错误导入整体回滚', () => {
  const { service } = makeService();
  assert.throws(
    () =>
      service.importWords(
        [
          { word: 'good', freq: 1 },
          { word: 'bad123', freq: 2 },
          { word: 'neg', freq: -5 },
        ],
        'g'
      ),
    (e: any) => e instanceof ApiError && e.code === 'IMPORT_FAILED'
  );
  assert.equal(service.listWords('g').length, 0);
});

// 8. 重复词条处理：导入跳过并报告，单个添加报 409
test('重复词条处理', () => {
  const { service } = makeService();
  service.addWord('dup', 1, 'g');
  const report = service.importWords(
    [
      { word: 'dup', freq: 2 },
      { word: 'dup', freq: 3 },
      { word: 'new', freq: 4 },
    ],
    'g'
  );
  assert.equal(report.inserted, 1);
  assert.deepEqual(report.skippedDuplicates, ['dup', 'dup']);
  assert.throws(
    () => service.addWord('dup', 9, 'g'),
    (e: any) => e instanceof ApiError && e.code === 'DUPLICATE_WORD' && e.status === 409
  );
});

// 9. 非法字符与非法阈值
test('参数校验', () => {
  const { service } = makeService();
  assert.throws(() => service.check('hello!', 'g'), (e: any) => e.code === 'INVALID_WORD');
  assert.throws(() => service.check('hello', 'g', 3), (e: any) => e.code === 'INVALID_THRESHOLD');
  assert.throws(() => service.addWord('x', 1.5, 'g'), (e: any) => e.code === 'INVALID_FREQ');
  assert.throws(() => service.check('a', 'nosuch'), (e: any) => e.code === 'GROUP_NOT_FOUND');
});

// 10. 不同分组互不影响
test('分组隔离', () => {
  const { service } = makeService();
  service.createGroup('other');
  service.addWord('isolated', 1, 'other');
  const r = service.check('isolated', 'g', 2, 10);
  assert.equal(r.correct, false);
  assert.deepEqual(r.candidates, []);
});

// 11. 重启后（重新打开同一数据库文件）词典与查询记录仍在
test('重启后数据持久', () => {
  const { service, dbFile } = makeService();
  service.addWord('persist', 42, 'g');
  service.check('persit', 'g', 1, 10);
  const reopened = new SpellService(openDatabase(dbFile));
  const r = reopened.check('persist', 'g');
  assert.equal(r.correct, true);
  const hist = reopened.history('g');
  assert.ok(hist.length >= 2);
  assert.equal(hist[hist.length - 1].input, 'persit');
});

// 12. 词表解析
test('parseWordlist', () => {
  const entries = parseWordlist('# comment\napple,10\n\nBanana, 20\n');
  assert.deepEqual(entries, [
    { word: 'apple', freq: 10 },
    { word: 'Banana', freq: 20 },
  ]);
});
