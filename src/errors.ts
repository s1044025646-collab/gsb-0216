export type ErrorCode =
  | 'INVALID_WORD'
  | 'INVALID_FREQ'
  | 'INVALID_THRESHOLD'
  | 'INVALID_LIMIT'
  | 'INVALID_GROUP'
  | 'GROUP_NOT_FOUND'
  | 'WORD_NOT_FOUND'
  | 'DUPLICATE_WORD'
  | 'DUPLICATE_GROUP'
  | 'IMPORT_FAILED'
  | 'BAD_REQUEST'
  | 'NOT_FOUND';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number = 400,
    public details?: unknown
  ) {
    super(message);
  }
}
