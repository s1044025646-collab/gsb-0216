import { ApiError } from './errors';

const WORD_RE = /^[A-Za-z]+$/;

// 统一规则：词条规范化为小写存储与比较；原始输入另行保留。
export function normalizeWord(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ApiError('INVALID_WORD', '单词必须是非空字符串');
  }
  if (raw.length > 64) {
    throw new ApiError('INVALID_WORD', '单词长度不能超过 64 个字符');
  }
  if (!WORD_RE.test(raw)) {
    throw new ApiError('INVALID_WORD', `单词只能包含英文字母: ${JSON.stringify(raw)}`);
  }
  return raw.toLowerCase();
}

export function validateFreq(raw: unknown): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 1e12) {
    throw new ApiError('INVALID_FREQ', `词频必须是 0 到 1e12 之间的整数，收到: ${JSON.stringify(raw)}`);
  }
  return n;
}

export function validateThreshold(raw: unknown, fallback = 2): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 2) {
    throw new ApiError('INVALID_THRESHOLD', `阈值必须是 0、1 或 2，收到: ${JSON.stringify(raw)}`);
  }
  return n;
}

export function validateLimit(raw: unknown, fallback = 10): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw new ApiError('INVALID_LIMIT', `结果数量必须是 1 到 100 的整数，收到: ${JSON.stringify(raw)}`);
  }
  return n;
}

export function validateGroupName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 64) {
    throw new ApiError('INVALID_GROUP', '词典分组名必须是 1-64 字符的非空字符串');
  }
  return raw.trim();
}
