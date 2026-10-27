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
  return { code: 'INTERNAL_ERROR', message: '처리하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.' };
}
