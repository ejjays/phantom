export class ResolveTimeoutError extends Error {
  constructor() {
    super('RESOLVE_TIMEOUT');
    this.name = 'ResolveTimeoutError';
  }
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}
