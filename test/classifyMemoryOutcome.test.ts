import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyMemoryOutcome } from "../src/core/classifyMemoryOutcome.js";

// These strings are session-memory's literal `text` output. If the Worker ever
// changes its wording, these tests are what fails — which is the point: the
// classifier is a parser against someone else's format, so drift must be loud.
// Contract: tickets/T02-memory-outcome-classifier.md.

test("stored", () => {
  assert.deepEqual(classifyMemoryOutcome("Stored. ID: abc-123"), {
    code: "stored",
    id: "abc-123",
  });
});

test("duplicate_candidate reports similarity as a 0-1 fraction", () => {
  assert.deepEqual(
    classifyMemoryOutcome(
      "Stored with ID: new-1 — note: similar entry exists (88% match, ID: old-9). Tagged as duplicate-candidate.",
    ),
    { code: "duplicate_candidate", id: "new-1", similarity: 0.88, existingId: "old-9" },
  );
});

test("duplicate_rejected carries no new id, only the existing one", () => {
  assert.deepEqual(
    classifyMemoryOutcome("Duplicate detected (100% match) — not stored. Existing entry ID: 43a0d8d6"),
    { code: "duplicate_rejected", similarity: 1, existingId: "43a0d8d6" },
  );
});

test("appended", () => {
  assert.deepEqual(classifyMemoryOutcome("Appended to entry e-7. New content length 240."), {
    code: "appended",
    id: "e-7",
  });
});

test("forgotten", () => {
  assert.deepEqual(classifyMemoryOutcome("Forgotten: e-7"), { code: "forgotten", id: "e-7" });
});

test("not_found — append shape", () => {
  assert.deepEqual(classifyMemoryOutcome("No entry found with ID: missing-1"), {
    code: "not_found",
    id: "missing-1",
  });
});

test("not_found — forget shape", () => {
  assert.deepEqual(classifyMemoryOutcome("Entry missing-2 not found."), {
    code: "not_found",
    id: "missing-2",
  });
});

test("empty recall and empty show both mean zero results", () => {
  assert.deepEqual(classifyMemoryOutcome("Nothing found matching that query."), {
    code: "results",
    count: 0,
  });
  assert.deepEqual(classifyMemoryOutcome("No entries found."), { code: "results", count: 0 });
});

test("counts result entries by header line", () => {
  const text = ["1. [7/29/2026 · bobby-cli · meeting] (100% match)", "a", "", "2. [7/30/2026 · claude · work] (66% match)", "b"].join("\n");
  assert.deepEqual(classifyMemoryOutcome(text), { code: "results", count: 2 });
});

test("blank lines inside entry content do not split the count", () => {
  // This is why T02 counts header lines instead of splitting on "\n\n":
  // stored text is arbitrary user input and routinely contains blank lines.
  const text = [
    "1. [7/29/2026 · bobby-cli · notes] (90% match)",
    "first paragraph",
    "",
    "second paragraph",
    "",
    "2. [7/30/2026 · claude · work] (66% match)",
    "body",
  ].join("\n");
  assert.deepEqual(classifyMemoryOutcome(text), { code: "results", count: 2 });
});

test("highest leading index wins when entry content mimics a header", () => {
  // Documents the known limit of T02's counting rule rather than pretending
  // it is airtight: one real entry whose body contains `1. [` / `2. [` lines
  // is counted as 2. Content-shaped false positives are accepted by the spec
  // — if that ever becomes a real problem, T02 is what has to change first.
  const text = ["1. [7/29/2026 · bobby-cli · notes] (90% match)", "my list:", "1. [not a real header]", "2. [also not]"].join("\n");
  assert.deepEqual(classifyMemoryOutcome(text), { code: "results", count: 2 });
});

test("unrecognised text is unclassified, never guessed", () => {
  assert.deepEqual(classifyMemoryOutcome("something the worker has never said"), {
    code: "unclassified",
  });
});

test("classification does not leak regex state between calls", () => {
  // ENTRY_HEADER is a module-level /g regex — a lastIndex leak here would make
  // the second identical call return a different answer.
  const text = "1. [7/29/2026 · bobby-cli · x] (90% match)\nbody";
  assert.deepEqual(classifyMemoryOutcome(text), classifyMemoryOutcome(text));
});
