export type ErrorCode =
  | 'INVALID_WORD'
  | 'INVALID_FREQUENCY'
  | 'INVALID_THRESHOLD'
  | 'INVALID_LIMIT'
  | 'INVALID_NAME'
  | 'DUPLICATE_WORD'
  | 'DUPLICATE_DICTIONARY'
  | 'DICT_NOT_FOUND'
  | 'WORD_NOT_FOUND'
  | 'IMPORT_FAILED'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  details?: unknown;

  constructor(code: ErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const WORD_RE = /^[A-Za-z]+$/;

/** Validate a raw user-supplied word; returns the normalized (lowercase) form. */
export function normalizeWord(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AppError('INVALID_WORD', 'word must be a non-empty string of English letters');
  }
  if (raw.length > 64) {
    throw new AppError('INVALID_WORD', 'word is too long (max 64 characters)');
  }
  if (!WORD_RE.test(raw)) {
    throw new AppError('INVALID_WORD', `word "${raw}" contains non-letter characters; only A-Z/a-z allowed`);
  }
  return raw.toLowerCase();
}

export function validateFrequency(raw: unknown): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 1_000_000_000) {
    throw new AppError('INVALID_FREQUENCY', 'frequency must be an integer between 0 and 1,000,000,000');
  }
  return n;
}

export function validateThreshold(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 2) {
    throw new AppError('INVALID_THRESHOLD', 'threshold must be an integer between 0 and 2');
  }
  return n;
}

export function validateLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 100) {
    throw new AppError('INVALID_LIMIT', 'limit must be an integer between 1 and 100');
  }
  return n;
}
