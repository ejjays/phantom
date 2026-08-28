export class ResolveTimeoutError extends Error {
  constructor() {
    super('resolution timed out');
    this.name = 'ResolveTimeoutError';
  }
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}
