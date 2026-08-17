import { CliUsageError } from "./config.js";

// Validated locally rather than shipped to the server: `parseInt("abc")` is
// NaN, JSON.stringify turns NaN into null, and the server then rejects it with
// a type error — a round-trip that ends in a `server` code for what is plainly
// bad local input.
// Digits-only before Number(), not Number() alone: Number("1e3") is 1000 and
// Number("0x10") is 16, both of which pass Number.isInteger and would ship a
// value the caller never typed. `1e20` would even survive the integer check and
// reach the server — the exact round-trip this validation exists to prevent.
//
// Throws instead of returning a result envelope: this lives in core/, and a
// core module that returns commands/memory.ts's CallToolResult would invert the
// layering. Each caller catches CliUsageError and wraps it in its own envelope,
// which is how the message stays identical to what memory callers saw before
// this moved out of commands/memory.ts.
export function parseLimit(raw: string, flag: string, max?: number): number {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new CliUsageError(`${flag} must be a positive whole number — got "${raw}".`);
  }
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new CliUsageError(`${flag} must be a positive whole number — got "${raw}".`);
  }
  if (max !== undefined && n > max) {
    throw new CliUsageError(`${flag} must be ${max} or less — got "${raw}".`);
  }
  return n;
}
