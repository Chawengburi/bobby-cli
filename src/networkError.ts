// Node's fetch() collapses every connection-level failure into a bare "fetch
// failed" TypeError, with the actionable detail (ECONNREFUSED, ENOTFOUND, ...)
// buried in `.cause`. Surface that so "server is down" reads differently from
// "wrong password" both for a human reading the terminal and an agent parsing --json.
export function describeNetworkError(err: unknown, url: string): string {
  if (err instanceof TypeError) {
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code) return `Could not reach ${url} (${cause.code})`;
  }
  return err instanceof Error ? err.message : String(err);
}
