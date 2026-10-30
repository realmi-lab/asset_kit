export class KitError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'KitError';
    this.code = code;
    this.status = status;
  }
}

export function publicError(error) {
  if (error instanceof KitError) return { code: error.code, message: error.message, ...(error.upstream ? { upstream: error.upstream } : {}) };
  return { code: 'INTERNAL_ERROR', message: '예상하지 못한 오류로 처리하지 못했습니다. 다시 시도하고, 계속되면 asset-kit doctor로 설정을 확인하세요.' };
}
