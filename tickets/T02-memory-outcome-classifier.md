# T02 — Classify memory-domain outcomes into `code` + structured fields, and relax `--tags` input handling

**Type:** Feature
**Priority:** Critical
**Complexity:** M (1–2 days)

## Summary

Every `memory *` command's `--json` output today buries the real outcome
(stored vs. duplicate vs. not-found vs. appended) inside a free-form `text`
string, forcing any caller to string-match it themselves. This ticket adds a
`code` field (from a fixed, canonical enum — defined below) plus outcome-
specific structured fields (`id`, `similarity`, `existingId`, `count`) to
every `memory *` command's success envelope, by parsing the server's `text`
against an exact-string contract. It also relaxes `--tags` input handling
per spec 12 §3.

This ticket implements spec 12 §1.1 (the `text`→`code` table) for the
**success** rows only. The `permission_denied` row (the one row that flips
`ok:false`) is detected at the transport layer by T01 and is *consumed*
here (T03) — this ticket's classifier only needs to worry about codes that
keep `ok: true`.

## Background & Context

- Spec: `bobby-cli/specs/12-spec-agent-legible-output.md` § 1 and § 1.1.
- Source of truth for the exact server strings:
  `session-memory/src/index.ts` (a different repo — this ticket only reads
  it as a reference; do not edit it here, see T05).

## THE canonical `code` enum

This is **the** enum — every other ticket and every per-tool
`output_schema` in `schema/tools.json` (T06) must be a subset of this list,
never an addition to it. If a future need arises for a new code, that is a
spec change, not a silent extension in code.

Success codes (envelope keeps `ok: true`):

| `code` | Meaning |
|---|---|
| `stored` | memory remember, stored cleanly |
| `duplicate_candidate` | memory remember, stored but ≥85% similar to an existing entry |
| `duplicate_rejected` | memory remember, rejected as >95% duplicate (not stored) |
| `appended` | memory append succeeded |
| `forgotten` | memory forget succeeded |
| `not_found` | memory append/forget targeted a nonexistent ID · uploader fetch on an id that does not exist, or whose markdown is not indexed yet (spec 18 § 6.3 — exit 0, the question was answered) |
| `results` | memory recall/show, uploader search — including empty results |
| `fetched` | uploader fetch returned a document's markdown (spec 17 § 3.3) |
| `unclassified` | the server `text` didn't match any known pattern — never guess |
| `status` | auth show (see T04) |

Failure codes (`ok: false`, exit 1) — implemented by T03, listed here only
so this enum is complete in one place:

| `code` | Meaning |
|---|---|
| `not_logged_in` | no local credentials, or session-memory 401 |
| `login_failed` | auth-center rejected `auth login` credentials (401 during login) |
| `permission_denied` | scope denied (session-memory 200 + `Requires scope:` text, or auth-center 403) |
| `network` | server unreachable |
| `server` | server rejected the request (other 4xx/5xx). On `uploader *` the envelope also carries `reason`, auth-center's own slug — five server-side conditions share this one code, and only `reason` tells them apart |
| `usage` | bad local input (unknown flag, missing arg) |

## The exact `text` → `code` contract (this ticket implements the success rows)

Copied verbatim from spec 12 § 1.1. "Exactly" means exactly **per each
row's stated matching mode**: rows marked "(prefix match)" are contractual
on the prefix only (the tail is informative and may drift); every other
row is a full-string match. Never match looser than the row states:

| Server `text` pattern (canonical) | `code` | Extracted fields |
|---|---|---|
| `Stored. ID: <id>` | `stored` | `id` |
| `Stored with ID: <id> — note: similar entry exists (<N>% match, ID: <matchId>). Tagged as duplicate-candidate.` | `duplicate_candidate` | `id`, `similarity` (= N/100), `existingId` (= matchId) |
| `Duplicate detected (<N>% match) — not stored. Existing entry ID: <id>` | `duplicate_rejected` | `similarity` (= N/100), `existingId` |
| `Appended to entry <id>. …` (prefix match) | `appended` | `id` |
| `Forgotten: <id>` | `forgotten` | `id` |
| `No entry found with ID: <id>` (append) | `not_found` | `id` |
| `Entry <id> not found.` (forget) | `not_found` | `id` |
| `Nothing found matching that query.` (recall, empty) | `results` | `count: 0` |
| `No entries found.` (show/list, empty) / numbered entry list | `results` | `count` (0 for the former, else counted per the rule below) |

**Counting rule for the numbered entry list (load-bearing — do not
improvise):** the Worker formats each entry as
`` `${i + 1}. [${date} · ${source}${tags}]` `` on its own line, followed by
the entry content, entries joined with `"\n\n"`
(`session-memory/src/index.ts:917`). Entry content is **arbitrary user
text** — it can contain blank lines and even lines that look like
`1. [something]`. Therefore: `count` = number of lines matching the
header regex `/^\d+\. \[/m` applied to the whole `text` — do NOT count by
splitting on `"\n\n"` (miscounts any multi-paragraph memory). If header
lines are found, the highest leading index and the match count should
agree; if they don't (pathological user content), prefer the highest
leading index. A test case with a stored memory containing blank lines is
required (AC10b).

Notes (copied from spec, load-bearing):

- `similarity` is a **0–1 float** (e.g. `0.97`). The server text says `"97%
  match"` — divide by 100. Precision is bounded to 0.01 steps (the Worker's
  emit sites round with `toFixed(0)`) — do not fabricate more precision.
- Anything that doesn't match one of the rows above → `code: "unclassified"`
  with the untouched `text` alongside it. This includes the Worker's
  append-validation strings (`Addition cannot be empty.`,
  `Append failed: <message>`) — they intentionally have no row.
- `duplicate_rejected` and `not_found` stay `ok: true` / exit 0 — this is
  deliberate (spec 12: open question 1, deferred), do not change exit
  behavior for these two.
- Known spec wart (do not "fix" it the wrong way): spec 12 § 1's envelope
  table omits `existingId` from the `duplicate_candidate` row, while § 1.1
  includes it. **§ 1.1 governs** — emit `existingId` for
  `duplicate_candidate` as this ticket's type definition does.

## Where to implement

Add a new module, e.g. `bobby-cli/src/core/classifyMemoryOutcome.ts`,
exporting one function:

```ts
export type MemoryOutcome =
  | { code: "stored"; id: string }
  | { code: "duplicate_candidate"; id: string; similarity: number; existingId: string }
  | { code: "duplicate_rejected"; similarity: number; existingId: string }
  | { code: "appended"; id: string }
  | { code: "forgotten"; id: string }
  | { code: "not_found"; id: string }
  | { code: "results"; count: number }
  | { code: "unclassified" };

export function classifyMemoryOutcome(text: string): MemoryOutcome { ... }
```

Wire it into `bobby-cli/src/commands/memory.ts`'s `callTool()` /
`emit()` path: on a successful `mcpToolCall()` return, run
`classifyMemoryOutcome(text)` and spread its fields into the JSON envelope
alongside the existing `{ ok: true, text }`, e.g.
`{ ok: true, code: "stored", id: "mem_123", text: "Stored. ID: mem_123" }`.
The existing `text` field must remain byte-identical to today's output —
this is additive only (spec 12 success criterion 1: "existing spec 11 skill
keeps working unmodified").

`not_found` needs to distinguish append-vs-forget's two different strings
(`No entry found with ID: <id>` vs `Entry <id> not found.`) — both map to
the same `code`/field shape, so the classifier can match either regex and
normalize to the same output; which command called it is irrelevant to the
caller.

## Input tolerance (spec 12 § 3)

In `bobby-cli/src/commands/memory.ts`'s `parseTags()`:

- `--tags ''` (empty string) must be treated exactly as if `--tags` were
  omitted (currently: check what happens today — `parseTags` already
  returns `undefined` for a falsy `tags` value, so verify this is already
  correct; if commander itself rejects an empty-string option value before
  it reaches `parseTags`, fix at the option definition instead).
- Trailing/duplicate commas in `--tags` (e.g. `a,,b,`) must be normalized,
  not errored: after `.split(",")`, the existing `.map(t => t.trim()).filter(Boolean)`
  already drops empty segments — verify this handles `a,,b,` → `["a", "b"]`
  correctly and add this exact case to the acceptance criteria below as a
  regression check (don't assume — verify, per spec 12 success criterion 6).

## Acceptance Criteria

1. Given server text `Stored. ID: mem_123`, when classified, then result is
   `{ code: "stored", id: "mem_123" }`.
2. Given server text `Stored with ID: mem_5 — note: similar entry exists (87% match, ID: mem_2). Tagged as duplicate-candidate.`,
   when classified, then result is `{ code: "duplicate_candidate", id: "mem_5", similarity: 0.87, existingId: "mem_2" }`.
3. Given server text `Duplicate detected (97% match) — not stored. Existing entry ID: mem_9`,
   when classified, then result is `{ code: "duplicate_rejected", similarity: 0.97, existingId: "mem_9" }`.
4. Given server text `Appended to entry mem_7. The original content is preserved and your update has been added with today's date.`
   (this is the real Worker string at `session-memory/src/index.ts:740` —
   but remember only the prefix `Appended to entry <id>. ` is contractual;
   the classifier must also pass with any different tail), when classified,
   then result is `{ code: "appended", id: "mem_7" }`. Add a second case
   with a made-up tail (e.g. `Appended to entry mem_7. Whatever.`) to prove
   the match is anchored on the prefix only.
5. Given server text `Forgotten: mem_4`, when classified, then result is
   `{ code: "forgotten", id: "mem_4" }`.
6. Given server text `No entry found with ID: mem_zz`, when classified, then
   result is `{ code: "not_found", id: "mem_zz" }`.
7. Given server text `Entry mem_zz not found.`, when classified, then result
   is `{ code: "not_found", id: "mem_zz" }`.
8. Given server text `Nothing found matching that query.`, when classified,
   then result is `{ code: "results", count: 0 }`.
9. Given server text `No entries found.`, when classified, then result is
   `{ code: "results", count: 0 }`.
10. Given server text that is a numbered list of N entries (as
    `memory show`/`memory recall` return today), when classified, then
    result is `{ code: "results", count: N }`, counted per the header-regex
    rule above (`/^\d+\. \[/m`).
10b. Given a numbered list where one entry's content contains blank lines
    (multi-paragraph memory), when classified, then `count` still equals
    the number of entries, not the number of blank-line-separated blocks.
11. Given server text `Addition cannot be empty.` or any string not matching
    the table, when classified, then result is `{ code: "unclassified" }`
    — never any other code.
12. Given `bobby-cli memory remember 'x' --json` runs successfully against a
    real/test deployment, when the output is inspected, then it contains
    both the original `text` field (unchanged from today's output) and the
    new `code`/`id` fields, and `ok: true`.
13. Given `bobby-cli memory show --tags '' --json`, when run, then it behaves
    identically to `bobby-cli memory show --json` (no tag filter applied,
    no error).
14. Given `bobby-cli memory show --tags 'a,,b,' --json`, when run, then the
    effective tag filter is exactly `["a", "b"]` (verify via a debug log or
    by checking the request the CLI would send — this can be checked by
    temporarily logging `tagFilterArgs()`'s input during manual testing;
    remove any debug logging before landing).
15. `npm run build` compiles with no TypeScript errors.

## Dependencies

Depends on T01 landing first (project decision: T01's error-path changes
and T02's success-path classifier are sequenced together as the first two
envelope tickets; T02 does not technically import anything from T01, but
both must land before T03, which wires both together).

## Out of Scope

- The `permission_denied` failure code and any `ok: false` output — that's
  T01 (detection) + T03 (envelope wiring).
- `hint` text on any envelope — T03.
- `auth show`'s envelope — T04.
- Changing the *content* of `text` itself — it stays byte-identical to
  today's server-passthrough string.
- `duplicate_rejected`/`not_found` becoming `ok: false` — explicitly out of
  scope per spec 12's open question 1 (deferred to the openClaw migration).
