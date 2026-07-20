// Node's fetch() collapses every connection-level failure into a bare "fetch
// failed" TypeError, with the actionable detail (ECONNREFUSED, ENOTFOUND, ...)
// buried in `.cause`. Surface that so "server is down" reads differently from
// "wrong password" both for a human reading the terminal and an agent parsing --json.
export function describeNetworkError(err: unknown, url: string): string {
  const code = networkErrorCode(err);
  if (code) return `Could not reach ${url} (${code})`;
  return err instanceof Error ? err.message : String(err);
}

// Bare error code (e.g. "ECONNREFUSED") for structured error fields, separate
// from describeNetworkError()'s human-formatted message.
export function networkErrorCode(err: unknown): string | undefined {
  if (err instanceof TypeError) {
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code) return cause.code;
  }
  return undefined;
}
