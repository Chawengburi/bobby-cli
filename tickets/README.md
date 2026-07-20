# bobby-cli implementation tickets: specs 12 + 13

Source specs (both ACCEPTED — ticket-ready):

- `bobby-cli/specs/12-spec-agent-legible-output.md` (2026-07-17) — envelope
  extension (`code`/`hint`/structured fields), error-class enrichment,
  `auth show` normalization.
- `bobby-cli/specs/13-spec-skill-architecture.md` (2026-07-18) —
  single-file skill architecture (the hub-and-spoke + `schema render`
  generator design was retired before implementation).

Supporting/amended specs read while writing these tickets:
`06-spec-output-conventions.md`, `09-spec-agent-tool-schema.md`,
`03-spec-commands.md`, `11-spec-claude-code-skill.md`. Decision records:
`docs/sessions/SESSION-2026-07-17.md` (spec decisions + verification) and
`docs/sessions/SESSION-2026-07-18.md` (single-file architecture pivot) —
both in the chawengburi repo.

Every ticket below is self-contained — exact file paths, exact contracts
(copied inline, not just referenced), mechanically checkable acceptance
criteria, explicit out-of-scope. A fresh implementer should not need to open
the specs to do the work, only to understand *why* if curious.

## Implementation workflow (apply to every ticket)

Established during T01 (2026-07-20) — follow this for every remaining
ticket, one ticket per session/commit:

1. **Read only the ticket file.** Tickets are self-contained by design (see
   above) — don't open the source specs unless you want the *why*.
2. **Read every file you're about to edit before editing it** (not just the
   diff excerpt in the ticket — the whole enclosing function). The ticket's
   "Current code" section can drift from the real file; re-verify.
3. **Implement exactly the "Exact changes required" section.** Nothing
   outside the ticket's named files — check `git diff --stat` against the
   ticket's own file list before committing (see step 6).
4. **`npm run build`** — must compile clean before anything else.
5. **Verify every Acceptance Criterion by actually running something**, not
   by reading the code and asserting it looks right. Write throwaway
   scripts against `dist/` (mock `fetch` for unit-shaped ACs; use a real
   closed port / real live test-deployment call for transport-shaped ACs
   per the ticket's "Live-test safety" notes if present). Delete scratch
   files when done — they don't belong in the repo.
6. **Diff-scope check** — `git diff --stat` should match only the files the
   ticket names. If it doesn't, you scope-crept; back out the extra change
   or fold it into a separate ticket.
7. **Commit**, message references the ticket ID
   (`feat(...): T0X — ...`), body explains *why* not what (the diff already
   shows what). One ticket = one commit minimum, referenced diff-per-ticket
   must stay traceable.
8. **Run `/code-review` (medium effort)** against the new commit
   (`git diff HEAD~1...HEAD`, not the whole ahead-of-origin range — isolate
   to just this ticket's diff). Let it dispatch its finder/verify agents;
   don't skip verification just because a finding "sounds minor."
9. **Fix every CONFIRMED and PLAUSIBLE finding**, same actually-run
   verification standard as step 5 (e.g. re-test the exact failing input
   from the finder's repro before and after the fix). REFUTED findings need
   no action — don't "fix" something the review already disproved.
10. **Commit the review fixes separately**, message references the same
    ticket ID + "follow-up" (`fix(...): T0X follow-up — ...`), body names
    which findings were fixed and how they were verified.
11. **Report back concisely**: which ACs were verified (and how), the
    commit hash(es), and what the review found/fixed. No need to re-explain
    the ticket's own content back to the user — they already have it.

Repo-boundary and live-test-safety rules elsewhere in this file/the tickets
themselves still apply on top of this — this workflow is the *shape* of a
session, not a replacement for a given ticket's specific constraints.

## Implementation order and dependencies

Spec 12 (envelope) lands as one connected unit before the spec 13 skill
rewrite — the single-file skill can only be this thin once `code`/`hint`
exist to replace its prose. T05 (session-memory repo) and T06 (manifest)
both depend on the envelope tickets' shapes being final.

```
T01 (error class enrichment: status/networkCause + mcpClient scope detection)
  │
  ├──> T02 (memory success-code classifier + --tags input tolerance)
  │      │
  │      └──> T03 (failure code/hint envelope wiring — needs T01 + T02)
  │             │
  │             ├──> T04 (auth show envelope normalization)
  │             │
  │             └──> T06 (schema/tools.json 3-item checklist — needs T01–T04)
  │                    │
  │                    └──> T07 (SKILL.md single-file rewrite, ≤2.5KB)
  │                           │
  │                           └──> T09 (verification: re-run spec 11
  │                                      trial + spec 12/13 success
  │                                      criteria, live checks)
  │
  T05 (session-memory repo: comment emit sites + spec note)
      — independent, no code dependency on T01–T09, but logically part of
        "implementing spec 12" — land it alongside T01–T04, any time.
```

| # | Ticket | Type | Priority | Complexity | Depends on |
|---|---|---|---|---|---|
| T01 | [Error class enrichment (`status`/`networkCause`, mcpClient scope detection)](./T01-error-class-enrichment.md) | Task | Critical | M | — |
| T02 | [Memory outcome classifier + `--tags` input tolerance](./T02-memory-outcome-classifier.md) | Feature | Critical | M | T01 (sequenced after) |
| T03 | [Failure `code`+`hint` envelope wiring](./T03-failure-code-hint-envelope.md) | Feature | Critical | M | T01, T02 |
| T04 | [`auth show` envelope normalization](./T04-auth-show-envelope.md) | Task | High | S | none strictly — parallelizable with T02/T03 (see T04; listed here in sequence position only) |
| T05 | [session-memory repo: declare outcome strings as API surface](./T05-session-memory-string-obligation.md) | Task | High | S | none (parallel) |
| T06 | [`schema/tools.json` 3-item manifest checklist](./T06-manifest-update.md) | Task | Critical | M | T01, T02, T03, T04 |
| T07 | [Rewrite `SKILL.md` as ≤2.5KB single file](./T07-skill-single-file-rewrite.md) | Task | High | S | T06 |
| T09 | [Verification: re-run trial protocol + success criteria](./T09-verification-trial-rerun.md) | Task | Critical | M | T01–T07 |

8 tickets total. (T08, the `schema render` renderer, was retired 2026-07-18
with the architecture revision — see spec 13 § "Retired: the renderer".
The ID is not reused.)

## Note on repo boundaries

- T01, T02, T03, T04, T06 modify the `bobby-cli` repo
  (`/Users/tanaphat/Work/000-chawengburi/bobby-cli/`).
- T05 modifies the **`session-memory`** repo
  (`/Users/tanaphat/Work/000-chawengburi/session-memory/`) — it's listed
  here because it's an obligation created by spec 12, not because the code
  lives in this repo.
- T07 modifies the **`chawengburi`** repo's
  `.claude/skills/bobby-cli/SKILL.md` (project-level skill, not inside
  either CLI repo) plus one line in `bobby-cli/DEVELOPMENT.md`
  (the same-change rule).
- T09 spans all three repos (verification only, no repo is primary).

## Deliberately out of scope (do not create tickets for these)

Per explicit project direction, the following are **not** covered by any
ticket above, regardless of how related they may seem while implementing:

- **Deploying anything to production.** All production changes are
  manual-only, per `PRODUCTION-UPDATES.md`. No ticket's acceptance criteria
  include a deploy step.
- **The session-memory Worker's `structuredContent` roadmap change**
  (spec 12 § 1.1, "Bridge, not destination") — the long-term replacement
  for the `text`-string-matching contract T02/T05 implement. Its own future
  spec, on the session-memory repo's own schedule; must not block this
  ticket set.
- **The Worker's 503-on-introspection-outage roadmap item** (spec 12 § 2,
  "Known ambiguity (accepted degradation)") — distinguishing "auth-center
  is down" from "bad token" is a session-memory Worker change, not a
  bobby-cli one. Accepted as-is for this ticket set; the `not_logged_in`
  hint (T03) is already worded to avoid an agent looping re-login during
  such an outage.
- **The device-code login flow** (spec 13 § 6's forward pointer, spec 07
  roadmap / decision D4). `auth login`'s current email+password UX is
  unchanged by this ticket set.
- **A skill-file generator** (the retired `schema render` design, or
  anything like Google's `gws generate-skills`) — deliberately dropped
  2026-07-18; spec 13 § 3 defines the revisit path if hand-maintenance
  rots. Do not re-introduce it inside any ticket.
- **The openClaw migration** (spec 13 § 4/§ open questions) — shipping the
  single-file skill to `~/.openclaw/workspace/skills/bobby-cli/`, the
  `--profile discord-<userId>` paragraph, the `/login` DM flow, and the
  decided consolidation of openClaw's separate login/forget skills into
  the one bobby-cli skill (2026-07-18). This ticket set only produces the
  chawengburi-repo skill; the migration itself is a separate future effort
  with its own spec.
