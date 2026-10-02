/**
 * Rebuildable bulk word-list generator (deterministic, no network).
 * Writes data/bulk-dict.txt with ~6000 synthetic "words" and frequencies.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const onsets = ['b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'br', 'cr', 'st', 'tr', 'pl', 'gr', 'sh', 'ch'];
const nuclei = ['a', 'e', 'i', 'o', 'u', 'ai', 'ea', 'oo', 'ou', 'ie'];
const codas = ['b', 'd', 'g', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'x', 'nd', 'st', 'lk', 'mp', 'ng', 'sh', 'ss', 'tt'];

// deterministic PRNG (mulberry32)
let seed = 20260216;
function rnd(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}

const words = new Set<string>();
while (words.size < 6000) {
  let w = pick(onsets) + pick(nuclei) + pick(codas);
  if (rnd() < 0.5) w += pick(nuclei) + pick(codas);
  if (rnd() < 0.2) w += pick(codas);
  if (w.length >= 3 && w.length <= 12) words.add(w);
}

const lines = [...words].sort().map((w) => `${w},${Math.floor(rnd() * 1000)}`);
const out = path.join(process.cwd(), 'data', 'bulk-dict.txt');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '# generated bulk dictionary (deterministic)\n' + lines.join('\n') + '\n');
console.log(`wrote ${lines.length} words to ${out}`);
