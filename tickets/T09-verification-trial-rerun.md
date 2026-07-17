# T09 — Re-run the spec 11 trial protocol against the single-file skill, verify success criteria

**Type:** Task
**Priority:** Critical
**Complexity:** M (1–2 days)

## Summary

This is the closing acceptance ticket for the whole spec 12 + spec 13
effort — it does not add new product code (beyond fixing whatever this
verification finds broken). It re-executes the spec 11 trial protocol using
the new single-file `SKILL.md` (T07 — the hub-and-spoke/renderer design
was retired 2026-07-18 before implementation; there are no spoke files),
and separately verifies the specific success criteria from specs 12 and 13
that require a live run rather than a code read. Do this ticket last,
after T01–T07 have all landed.

## Background & Context

- Spec: `bobby-cli/specs/11-spec-claude-code-skill.md` § "Trial protocol
  and success criteria" — the original 5-point protocol.
- Spec: `bobby-cli/specs/12-spec-agent-legible-output.md` § "Success
  criteria" (6 items).
- Spec: `bobby-cli/specs/13-spec-skill-architecture.md` (2026-07-18
  single-file revision) § "Success criteria" (4 items).
- Session record: `docs/sessions/SESSION-2026-07-17.md` — the 2026-07-17
  live scope-denial verification this ticket's criterion 6 below repeats
  end-to-end with the finished CLI (the earlier verification was done
  by hand against raw HTTP calls, not through the shipped `bobby-cli`
  binary).

## Live-test safety (read BEFORE any live item)

Same rule as T03's "Live-test safety" section: `src/core/config.ts:21–22`
defaults to the **production** URLs — before any live check, export
`AUTH_CENTER`/`SESSION_MEMORY_URL` to the test deployment
(`https://auth-center.tanaphat-jaroonrueang.workers.dev` /
`https://second-brain.tanaphat-jaroonrueang.workers.dev/mcp`), never edit
`~/.bobby-cli/credentials.json` (use `--profile` scratch profiles), and
never let a raw `sm_live_*` token reach stdout/stderr or a transcript.
Token minting/cleanup mechanics for item 6: follow T03's "Live-test
safety" steps 1–4.

## What to verify (checklist — every item must be explicitly checked, not assumed)

### A. Spec 11 trial protocol, re-run with the new skill in place

1. **Parity** — all five operations (recall-at-start, remember with ≥3
   tags, append on update, forget on cleanup, show for review) succeed
   through the CLI in a real Claude Code session using only the rewritten
   single-file SKILL.md (no fallback to MCP tools, no manual `--help`
   lookups needed).
2. **Latency** — per-call wall time stays under ~1.5s p95, measured from
   session transcript timestamps (same method as the original 2026-07-13
   trial).
3. **No leakage** — `grep -r "sm_live_" <session transcript files>` returns
   no matches.
4. **Error legibility** — induce at least one real failure (e.g.
   `memory append` against a bogus ID) and confirm the agent acts correctly
   on the `code`/`hint` fields **without needing to decode a raw error
   message** — this is a stronger bar than the original spec 11 criterion
   (which only required decoding *a* message), since the whole point of
   spec 12 is that `hint` makes decoding unnecessary.
5. **Schema fidelity** — confirm the trial never needed a command/flag not
   present in SKILL.md's memory/auth command tables.

### B. Spec 12 success criteria requiring a live check

6. **Coverage, exercised against a real scoped token** (spec 12 success
   criterion 2 — explicitly requires a real token, not a simulation, per
   the 2026-07-17 review finding that a simulated version of this exact
   check is what let the original bug through): mint (or reuse if still
   valid) an auth-center API token scoped to `memory:read` only, then run
   `bobby-cli memory remember 'verification test' --json` against it —
   confirm output is `{ ok: false, code: "permission_denied", scope: "memory:write", ... }`
   with exit code 1, and that `bobby-cli memory show --json` with the same
   token succeeds normally. **Revoke or delete the test token/credentials
   file after this check** (per the project's existing practice — see the
   2026-07-17 session record, which did the same for its verification
   token).
7. **Diet realized**: `wc -c` on the final `SKILL.md` is ≤ ~2560 bytes
   (should already be true from T07 — re-confirm after any later ticket
   touched it), and the trial in section A above passes with this file.
8. **No leakage (grep over new output paths)**: beyond the transcript grep
   in item 3, specifically grep the *source code* added by T01–T04 (`git
   diff` or the finished files) for any reference to `creds.apiToken`,
   `apiToken`, or `sm_live_` being assigned into any of the new `code`/
   `hint`/structured-field construction sites — confirm none of T02/T03's
   new fields are accidentally sourced from the credentials object.
9. **Edge behaviors** (spec 12 success criterion 6, "verify don't assume"):
   (a) confirm commander `usage` errors under `--json` emit the failure
   envelope on stdout, not plain text on stderr (re-verify T03's
   acceptance criterion 7 held after all later tickets); (b) confirm
   `bobby-cli memory recall 'no matches for this query xyz' --json`
   against an empty result set actually returns `code: "results", count: 0`
   end-to-end (re-verify T02's acceptance criteria 8/9 through the real
   binary, not just the unit-level classifier).

### C. Spec 13 (single-file revision) success criteria requiring a live check

10. **Single file**: the skill directory contains exactly one `.md` file
    (`SKILL.md`); no `auth.md`/`memory.md`/other spokes exist
    (spec 13 success criterion 1).
11. **Table–manifest agreement**: every command/flag in SKILL.md's memory
    and auth tables matches the post-T06 `schema/tools.json`
    (`command` paths + `input_schema` flags for all 8 tools) — spot-check
    row by row; this is the hand-maintained drift surface the same-change
    rule protects.
12. **Same-change rule recorded**: `bobby-cli/DEVELOPMENT.md`'s
    command-change checklist names both `schema/tools.json` and the
    deployed SKILL.md tables (spec 13 success criterion 3).

## Acceptance Criteria

Every numbered item in sections A–C above (12 total) has been explicitly
executed (not assumed from code review) and its result recorded. If any
item fails, this ticket is not done — either fix the underlying issue (filing
it against the ticket that owns that code, e.g. a T02 classifier bug goes
back to T02) and re-verify, or, if
the fix is trivial and clearly scoped to this verification pass, fix it
directly as part of closing this ticket and note what was changed.

## Dependencies

Depends on T01–T07 all landing first. This is the last ticket in
implementation order.

## Out of Scope

- Fixing anything beyond what this verification pass discovers — this
  ticket is verification-first, not a place to add new scope.
- The openClaw migration's own trial (a separate future effort, not this
  ticket — see README's "deliberately out of scope").
- Deploying anything to production — manual-only per
  `PRODUCTION-UPDATES.md`, never part of a ticket's acceptance criteria.
