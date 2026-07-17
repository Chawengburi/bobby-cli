# T05 — [session-memory repo] Declare outcome strings as API surface at each emit site

**Type:** Task
**Priority:** High
**Complexity:** S (half day)

**Repo:** this ticket's changes are in the **`session-memory`** repo
(`/Users/tanaphat/Work/000-chawengburi/session-memory/`), NOT `bobby-cli`.
It is listed under `bobby-cli/tickets/` alongside the others because it is
an obligation created by `bobby-cli/specs/12-spec-agent-legible-output.md`,
but the file changes below are all in the other repo.

## Summary

`bobby-cli`'s new `text`→`code` classifier (T02) works by string-matching
exact outcome strings emitted by the session-memory Worker's MCP tool
handlers. Spec 12 § 1.1 declares those strings part of the Worker's API
surface: **changing any of them is a breaking change** that must update the
`bobby-cli` classifier (T02) in the same change. This ticket fulfills the
spec's obligation to make that fact visible in the session-memory codebase
itself — a comment at each emit site, plus a note in that repo's own spec
set — so a future editor touching `session-memory/src/index.ts` sees the
warning before silently rewording a string and breaking `bobby-cli` in a
way neither repo's CI would catch (there is no cross-repo test coverage for
this).

## Background & Context

- Spec: `bobby-cli/specs/12-spec-agent-legible-output.md` § 1.1, "Two
  obligations come with this table," obligation 1: "these strings are
  hereby declared part of the session-memory Worker's API surface...
  This obligation must be recorded in the session-memory repo (a comment at
  each emit site plus a note in its spec set) as part of implementing this
  spec."
- The exact strings and their line numbers (verified 2026-07-17,
  `session-memory/src/index.ts` as of this writing — **re-verify line
  numbers before editing, they will have shifted if any other change has
  landed in this file since**):

| Line (approx.) | String |
|---|---|
| 637 | `Requires scope: memory:write` |
| 651 | `` `Duplicate detected (${(dup.score * 100).toFixed(0)}% match) — not stored. Existing entry ID: ${...}` `` |
| 679 | `` `Stored with ID: ${id} — note: similar entry exists (${(dup.score * 100).toFixed(0)}% match, ID: ${...}). Tagged as duplicate-candidate.` `` |
| 685 | `` `Stored. ID: ${id}` `` |
| 699 | `Requires scope: memory:write` (append handler) |
| 709 | `` `No entry found with ID: ${id}` `` |
| 740 | `` `Appended to entry ${id}. The original content is preserved and your update has been added with today's date.` `` |
| 762 | `Requires scope: memory:read` (recall handler) |
| 823 | `Nothing found matching that query.` |
| 863 | `Requires scope: memory:read` (list_recent handler) |
| 908 | `No entries found.` |
| 932 | `Requires scope: memory:delete` (forget handler) |
| 942 | `` `Entry ${id} not found.` `` |
| 962 | `` `Forgotten: ${id}` `` |

(Two additional strings exist at these handlers — `Addition cannot be
empty.` at ~714 and `Append failed: ${message}` at ~732 — bobby-cli
deliberately does NOT classify these; they fall to `code: "unclassified"` by
design. Still worth a one-line comment noting they're intentionally
unclassified downstream, so nobody "fixes" that gap.)

## Exact changes required

### 1. Comments at each emit site

In `session-memory/src/index.ts`, at each of the ~14 lines listed above
(re-grep for the current line numbers — use
`grep -n "Requires scope\|Duplicate detected\|Stored\|No entry found\|Appended to entry\|Nothing found\|No entries found\|Entry .* not found\|Forgotten:" src/index.ts`
to relocate them if they've drifted), add a one-line comment immediately
above (or on the same line, whichever fits the surrounding style)
referencing the contract:

```ts
// API surface (bobby-cli spec 12 §1.1): bobby-cli's CLI string-matches this
// exact text to classify outcomes. Changing this string is a breaking
// change for bobby-cli — update bobby-cli/specs/12-spec-agent-legible-output.md
// §1.1 and its classifier in the same change.
return { content: [{ type: "text" as const, text: `Stored. ID: ${id}` }] };
```

Adjust the exact wording per-site is not required — the same boilerplate
comment (or a one-line variant) above each of the ~14 return statements is
sufficient. Do not change any of the actual string literals — this ticket
is comments-only, zero behavior change.

### 2. Note in the session-memory spec set

Add a new short spec file (or a section appended to an existing relevant
one — check `session-memory/specs/README.md` for this repo's numbering
convention before picking a filename) documenting:

- That the MCP tool outcome strings listed above are consumed by an
  external CLI (`bobby-cli`) as a string-matched API contract, not just
  human-readable text.
- A pointer to `bobby-cli/specs/12-spec-agent-legible-output.md` § 1.1 as
  the canonical table.
- The rule: any change to one of these strings must be accompanied by a
  corresponding update to bobby-cli's classifier in the same
  logical change-set (even though the two repos have separate git
  histories, the note should say this explicitly so a session-memory-only
  contributor without bobby-cli context knows to flag it).
- A forward pointer to the roadmap direction (also from spec 12 § 1.1,
  "Bridge, not destination"): the long-term fix is for the Worker to return
  machine-readable outcomes via MCP `structuredContent` in the tool
  response, which would retire this string-matching contract — that
  Worker-side change is its own future spec in this repo, out of scope
  here (see the bobby-cli tickets README's "deliberately out of scope"
  section).

## Acceptance Criteria

1. Given `git diff` in the `session-memory` repo after this ticket, then
   every one of the ~14 emit sites listed above (re-verified against
   current line numbers, not blindly trusted from this ticket) has a
   comment referencing "bobby-cli spec 12" or equivalent, directly above or
   beside the string literal.
2. Given the same diff, then no string literal's actual text content has
   changed — this is comment-only.
3. Given `session-memory/specs/`, then a new or updated file exists
   documenting the API-surface obligation, cross-referencing
   `bobby-cli/specs/12-spec-agent-legible-output.md` § 1.1 by path.
4. `npm run build` (or this repo's equivalent typecheck/build command —
   check `session-memory/package.json`) still succeeds after the comment-only
   change (sanity check that no comment syntax broke compilation).

## Dependencies

None — independent of every other ticket in this set and can be done in
parallel with any of them. Listed after T01–T04 in the README's ordering
only because spec 12's obligation is "part of implementing this spec," i.e.
it should land in the same overall effort as the bobby-cli-side envelope
work, not because anything technically blocks it.

## Out of Scope

- Any change to session-memory's actual runtime behavior.
- Implementing the Worker `structuredContent` roadmap item — that is a
  future, separate spec in the session-memory repo (see the tickets
  README's "deliberately out of scope" section).
- The Worker 503-on-introspection-outage roadmap item — same, out of scope,
  separate future spec.
