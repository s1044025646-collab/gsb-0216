// 生成可重建的批量演示词表（确定性伪随机，约 4000 词），写入 data/bulk-words.csv
import * as fs from 'node:fs';
import * as path from 'node:path';

const CONS = 'bcdfghjklmnprstvwz';
const VOWEL = 'aeiou';

// 简单可复现的 LCG 伪随机数发生器
let seed = 20260216;
function rand(): number {
  // 32 位 LCG，使用 Math.imul 避免浮点精度损失
  seed = (Math.imul(seed, 1103515245) + 12345) | 0;
  return (seed >>> 0) / 4294967296;
}
function pick(s: string): string {
  return s[Math.floor(rand() * s.length)];
}
function makeWord(): string {
  const syllables = 2 + Math.floor(rand() * 3);
  let w = '';
  for (let i = 0; i < syllables; i++) {
    w += pick(CONS) + pick(VOWEL);
    if (rand() < 0.4) w += pick(CONS);
  }
  return w;
}

const words = new Set<string>();
while (words.size < 4000) {
  words.add(makeWord());
}
const lines = [...words].sort().map((w, i) => `${w},${(i * 7919) % 5000}`);
const file = path.join(__dirname, '..', '..', 'data', 'bulk-words.csv');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, lines.join('\n') + '\n', 'utf-8');
console.log(`已生成 ${lines.length} 个词条 -> ${file}`);
