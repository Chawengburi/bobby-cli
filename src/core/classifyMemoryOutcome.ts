// Parses session-memory's `text` passthrough into a canonical `code` plus
// outcome-specific structured fields. Contract: bobby-cli/tickets/T02-memory-outcome-classifier.md
// (per spec 12 § 1.1). Every pattern here must match that ticket's table
// exactly — this is not a place to "improve" or generalize the matching.

export type MemoryOutcome =
  | { code: "stored"; id: string }
  | { code: "duplicate_candidate"; id: string; similarity: number; existingId: string }
  | { code: "duplicate_rejected"; similarity: number; existingId: string }
  | { code: "appended"; id: string }
  | { code: "forgotten"; id: string }
  | { code: "not_found"; id: string }
  | { code: "results"; count: number }
  | { code: "unclassified" };

const STORED = /^Stored\. ID: (.+)$/;
const DUPLICATE_CANDIDATE =
  /^Stored with ID: (.+) — note: similar entry exists \((\d+)% match, ID: (.+)\)\. Tagged as duplicate-candidate\.$/;
const DUPLICATE_REJECTED = /^Duplicate detected \((\d+)% match\) — not stored\. Existing entry ID: (.+)$/;
const APPENDED = /^Appended to entry (.+?)\. /;
const FORGOTTEN = /^Forgotten: (.+)$/;
const NOT_FOUND_APPEND = /^No entry found with ID: (.+)$/;
const NOT_FOUND_FORGET = /^Entry (.+) not found\.$/;
const RECALL_EMPTY = /^Nothing found matching that query\.$/;
const SHOW_EMPTY = /^No entries found\.$/;
// Worker emit format: `${i + 1}. [${date} · ${source}${tags}]` at the start of a line
// (session-memory/src/index.ts:917). Entry content is arbitrary user text and can
// contain its own blank lines or lines shaped like `1. [...]` — count header lines,
// never split on "\n\n".
const ENTRY_HEADER = /^(\d+)\. \[/gm;

export function classifyMemoryOutcome(text: string): MemoryOutcome {
  let m: RegExpExecArray | null;

  if ((m = STORED.exec(text))) {
    return { code: "stored", id: m[1] };
  }
  if ((m = DUPLICATE_CANDIDATE.exec(text))) {
    return { code: "duplicate_candidate", id: m[1], similarity: Number(m[2]) / 100, existingId: m[3] };
  }
  if ((m = DUPLICATE_REJECTED.exec(text))) {
    return { code: "duplicate_rejected", similarity: Number(m[1]) / 100, existingId: m[2] };
  }
  if ((m = APPENDED.exec(text))) {
    return { code: "appended", id: m[1] };
  }
  if ((m = FORGOTTEN.exec(text))) {
    return { code: "forgotten", id: m[1] };
  }
  if ((m = NOT_FOUND_APPEND.exec(text))) {
    return { code: "not_found", id: m[1] };
  }
  if ((m = NOT_FOUND_FORGET.exec(text))) {
    return { code: "not_found", id: m[1] };
  }
  if (RECALL_EMPTY.test(text) || SHOW_EMPTY.test(text)) {
    return { code: "results", count: 0 };
  }

  const headerMatches = [...text.matchAll(ENTRY_HEADER)];
  if (headerMatches.length > 0) {
    // Normally match count and the highest leading index agree. If pathological
    // user content produces a mismatch, the highest leading index wins (per
    // T02's counting rule) since it reflects the Worker's own numbering.
    const highestIndex = Math.max(...headerMatches.map((h) => Number(h[1])));
    return { code: "results", count: highestIndex };
  }

  return { code: "unclassified" };
}
