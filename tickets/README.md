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
  with its own spec — see the T17–T21 section below.

---

# openClaw migration tickets: spec 16 (T17–T21)

Source: `bobby-cli/specs/16-spec-openclaw-consolidated-skill.md` (ACCEPTED
2026-07-24, 3 audit rounds + 2 post-acceptance amendments). Builds on and
supersedes spec 14 § 3.1 (spec 14 itself ACCEPTED 2026-07-20, 3 audit
rounds) — spec 16 inherits every section of spec 14 except § 3.1 (layering)
and the parts of § 3.4/§ 3.6 that change forces to move.

Same self-containment standard as T01–T09 above: exact file paths, exact
contracts copied inline (not just referenced), mechanically checkable
acceptance criteria, explicit out-of-scope. The "Implementation workflow"
section above applies to these tickets too, with one addition: several of
these tickets have **live-Discord-turn** acceptance criteria in addition
to file-content criteria — read each ticket's own live-test-safety /
pre-flight sections before running those, don't skip straight to file
edits and call it done.

## Retired: T10–T13 (spec 15's four-skill layering) — IDs not reused

A prior spec, `specs/15-spec-openclaw-migration-tickets-plan.md`, had
allocated ticket IDs T10–T16 for spec 14 § 3.1's original design: a
non-invocable `bobby-cli` reference skill plus four separate invocable
skills (`login`, `setup`, `logout`, `setup-memory`). That plan's ticket
files were never written — spec 16 (2026-07-24) superseded spec 14 § 3.1
before implementation began, replacing the four-skill layering with one
consolidated invocable `bobby-cli` skill (§ 1) plus a separately-renamed
`setup-chawengburi` (§ 2). `specs/15-spec-openclaw-migration-tickets-plan.md`
itself was drafted but never committed and does not exist in this repo;
the table below is reconstructed from the design-decision record in
spec 16's own header, which is the authoritative source for what T10–T16
were for.

Per this project's own established precedent (see T08's retirement note
above): **retired tickets are not reused.** T10–T13 are retired outright —
their functional intent is fully superseded by T17 below, which
implements all three actions (login/setup/logout) as one file rather than
three separate ones, so there is no direct old-ticket-to-new-ticket
mapping for these four. T14–T16 are not retired — their intent carries
forward, retargeted to this spec's layering, under new IDs (T17–T21 start
at T17 since T16 is the last ID spec 15 allocated, even though T16 itself
is being retargeted rather than reused verbatim — starting clean at T17
keeps it unambiguous that these are new tickets against a new design, not
edits to ticket files that were never written).

| Old ID | Was for (spec 15 plan, spec 14 § 3.1 layering) | Disposition |
|---|---|---|
| T10 | Non-invocable `bobby-cli/SKILL.md` reference skill + Discord-bot-credential pre-flight check | **Retired** — spec 16's `bobby-cli` skill is user-invocable, not a reference skill; a different file with a different purpose (§ 1). Pre-flight check's *intent* carried forward into **T17** (the first ticket in the new set needing live-Discord-turn testing). |
| T11 | `/login` rewrite (thin skill) | **Retired** — folded into **T17**'s LOGIN action. |
| T12 | `/setup` rewrite (thin skill) | **Retired** — folded into **T17**'s SETUP action. |
| T13 | `/logout` new skill | **Retired** — folded into **T17**'s LOGOUT action. |
| T14 | `/setup-memory` rewrite (env config, `AGENTS.md` rewrite, bootstrap login, companion-skill check, smoke test, delete `session-memory-call.py`) | **Retargeted → T18** (`setup-chawengburi`, spec 16 § 2/§ 2a/§ 2b). |
| T15 | Migration: delete pre-existing legacy `~/.openclaw/user-sessions/*.json` / `server-sessions/*.json` files | **Retargeted → T20** (spec 14 § 3.7, inherited unchanged by spec 16). |
| T16 | Verification: live-exercise the spec 14 success criteria in this sandbox | **Retargeted → T21** (spec 16's own self-contained 10-item success-criteria list, § "Success criteria"). |

**New in spec 16's layering, no old-ID equivalent:** T19 (archive
`login/`/`setup/`/`setup-memory/` into `old_skills/`, spec 16 § 3) — the
retired four-skill plan rewrote `login`/`setup` in place and added
`logout` alongside them, so it never needed an archival step. The
consolidation is what creates three now-redundant directories that need
somewhere inert to go.

## Note on repo boundaries (T17–T21)

- **T17, T18, T19** modify `~/.openclaw/workspace/` (openClaw's skill
  workspace) — **a separate git repo from `bobby-cli`**, confirmed clean
  on `main` (`90debb4 feat: add /forget skill for magic link password
  reset`) at the time these tickets were written, per spec 15's own audit
  (restated in spec 16 § 3). Not the `bobby-cli` CLI repo, not the
  `chawengburi` project repo that owns T07's `SKILL.md`.
- **T20** touches `~/.openclaw/user-sessions/` and
  `~/.openclaw/server-sessions/` — runtime state directories, not inside
  any git repo at all.
- **T21** spans the openClaw workspace repo (read-only checks) plus a live
  Discord server/DM on this sandbox's bot — no repo is primary.
- This machine's `~/.openclaw` install is a **local test sandbox, not
  production** (production runs on Linux/Docker, a separate host and
  repo — spec 15's audit, restated in spec 16 § 2b). Every live-Discord-turn
  acceptance criterion in T17–T21 carries this constraint; see each
  ticket's pre-flight/live-test-safety section before running one.

## Implementation order and dependencies

```
T17 (bobby-cli/SKILL.md — consolidated login+setup+logout skill,
     + Discord-bot-credential pre-flight gate, + one live LOGIN smoke test)
  │
  └──> T18 (setup-chawengburi/SKILL.md — renamed from setup-memory,
       │     + the 4-edit AGENTS.md delta — needs T17 since its own text
       │     and companion-skill check reference /bobby_cli login|setup
       │     and skills/bobby-cli/SKILL.md)
       │
       ├──> T19 (archive login/, setup/, setup-memory/ into old_skills/ —
       │         must land after replacements exist, not before)
       │
       ├──> T20 (delete pre-existing legacy user-sessions/server-sessions
       │         files — no hard technical dependency on T17/T18, but
       │         sequenced after so "first post-migration login" is
       │         meaningful, and independent of T19)
       │
       └──> T21 (verification: live-exercise all 10 spec 16 success
                  criteria, including realistic full-Thai-sentence
                  model-invocation tests and the §2b fresh-$HOME
                  portability check — needs T17+T18+T19+T20 all landed)
```

| # | Ticket | Type | Priority | Complexity | Depends on |
|---|---|---|---|---|---|
| T17 | [`bobby-cli/SKILL.md` — consolidated skill (login+setup+logout) + Discord-bot-credential pre-flight gate](./T17-bobby-cli-consolidated-skill.md) | Feature | Critical | L | — |
| T18 | [`setup-chawengburi/SKILL.md` (renamed from `setup-memory`) + `AGENTS.md` rewrite](./T18-setup-chawengburi-agents-md.md) | Feature | Critical | L | T17 |
| T19 | [Archive `login/`, `setup/`, `setup-memory/` into `old_skills/`](./T19-archive-legacy-skills.md) | Chore | High | S | T17, T18 |
| T20 | [Delete pre-existing legacy `user-sessions`/`server-sessions` files](./T20-legacy-session-file-deletion.md) | Chore | Critical | XS | T17, T18 (sequencing only) |
| T21 | [Verification: live-exercise all 10 spec 16 success criteria](./T21-verification-live-success-criteria.md) | Task | Critical | M | T17, T18, T19, T20 |

5 tickets total (T17–T21). T10–T13 retired, IDs not reused (see table
above). T14–T16 retargeted to T18/T20/T21 respectively, also not reused as
literal IDs — T17–T21 are freshly-cut tickets against spec 16's design,
not edits to files that were never written.

## Deliberately out of scope (T17–T21) — do not create tickets for these

- **Real admin-role enforcement on the SETUP action.** Spec 16 explicitly
  decided against this (§ "Explicitly decided against, this conversation")
  — the live `/setup` skill's frontmatter says "Admin-only" but no role or
  permission check exists anywhere today, and openClaw's `ctx.MemberRoleIds`
  would need new config this project doesn't have. Revisit if this ever
  needs to be a real ticket; not part of T17–T21.
- **A session-file format converter** for the pre-existing legacy
  `user-sessions`/`server-sessions` files — spec 14 § Decisions item 2
  explicitly decided against this (one-time re-login instead). Revisit
  only if a real production Discord user base exists by the time this
  actually ships (it doesn't today).
- **Real Docker/Linux production host testing**, or testing against
  production's real `AUTH_CENTER`/`SESSION_MEMORY_URL` — spec 16 § 2b
  explicitly does not claim this is verified; out of scope for this
  sandbox-only ticket set, same boundary specs 14/15 already established.
- **The exact Thai-wording copy-review pass** spec 16 itself lists as
  open, non-blocking polish (§ "Open items") — T17–T21 verify *behavior*
  (correct routing, correct action resolution), not final tone/prose
  quality of the Thai messages.
- **`/forget`** (openClaw's password-reset flow) — spec 16 § 3.5
  inheritance: no bobby-cli involvement exists or is proposed; untouched
  by this ticket set.
