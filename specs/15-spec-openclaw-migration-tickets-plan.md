# 15 Spec: openClaw Migration — Ticket Plan (T10–T16)

> **Status: ACCEPTED (2026-07-23) — 3 audit rounds complete, round 3 GO.**
> Same `spec-refinement-advisor` ritual this project used on specs 12–14:
> **Round 1** (cold-read): NO-GO — 4 blocking (B1–B4: a miscited
> success-criteria range, a legacy-file-deletion ordering gap, an
> unowned pre-flight question, an unverified local-test-bot capability
> claim) + 4 minor (M1–M4: a git-tracking overclaim, a path-citation gap,
> an undercounted ticket scope, an invisible graph edge), all fixed.
> **Round 2** (verifying round 1's fixes): NO-GO — 2 new blocking (the
> git-tracking fix overcorrected into a different false claim; the
> pre-flight-check fix didn't propagate into the ticket table), both
> fixed; all of round 1's fixes confirmed holding. **Round 3** (final
> holistic check): **GO** — 3 minor polish items (a residual overclaim,
> two graph-scope clarifications), all fixed.
>
> Ticket-writeable. This is a pre-ticket plan, not a design spec: spec 14 already owns all
> design decisions (two-layer skill shape, `--profile` scheme, `/logout`
> body, `/setup-memory` rewrite steps, migration/deletion step). This
> document's only job is to turn spec 14's six work items into a concrete
> set of tickets — IDs, file scope, repo, dependency order, and — the one
> piece of context spec 14 did not have when it was written — how each
> ticket's verification step is affected by this machine's `~/.openclaw/`
> install being a **local test sandbox, not the production deployment.**

Builds on: [14-spec-openclaw-migration.md](./14-spec-openclaw-migration.md)
(all design content — this doc adds no new design), `tickets/README.md`
(the T01–T09 ticket-writing/verification workflow this plan continues).

## New context since spec 14 was written (2026-07-23)

Spec 14's Success Criteria (§ "Success criteria") call for **live**
verification on 5 of its 9 items — **3, 4, 5, 6, and 9** ("exercised
live end to end," "exercised live," "a live test confirms," "exercised
live in an actual Discord turn"). Items 1, 2, 7, 8 are grep/`ls`/file-tree
checks, not live-Discord-turn checks. (Round-1 audit correction: an
earlier draft of this section miscited the range as "3–8," which both
wrongly included the grep-only items 7/8 and dropped item 9 — the one
live item most likely to be silently skipped if not named explicitly.)
Spec 14 itself doesn't say *where* live means, because at the time
nobody had asked. The owner has now clarified:

- This machine's `~/.openclaw/workspace/skills/` **is its own git repo**
  (round-1 audit correction: confirmed via `git status` — clean, on
  `main`). The *existing* skills this plan modifies in place —
  `login/`, `setup/`, `setup-memory/` — are all currently tracked there
  (alongside other unrelated skills such as `forget/`, out of scope for
  T10–T16; round-2 audit correction: an earlier draft overclaimed this
  covered "every T10–T14 file," checked, it does not). `bobby-cli/SKILL.md` (T10)
  and `logout/SKILL.md` (T13) don't exist yet — these tickets *create*
  new tracked files, they don't edit tracked ones. `AGENTS.md` (T14) lives
  in `~/.openclaw/workspace/` (one level up from `skills/`) and is
  currently untracked. `~/.bobby-cli/.env` and
  `~/.openclaw/scripts/session-memory-call.py` (also T14) sit outside this
  repo entirely. The "sandbox, not production" distinction is about which
  *deployment* this machine feeds, not about git tracking — this repo is
  real and local commits to the tracked skill files are fine to make
  here; what doesn't happen is any push/sync from this repo to whatever
  repo production actually runs from.
- **Production runs on Linux inside Docker**, on a separate host, from a
  separate repo this session has no access to.
- `~/.openclaw/.env` exists on this machine but (confirmed by reading it)
  contains only `AUTH_CENTER`/`SESSION_MEMORY_URL`/`AI_TOKEN` — no Discord
  bot token. `~/.openclaw/discord/command-deploy-cache.json` (round-1
  audit correction: an earlier draft cited this file as evidence a live
  test bot "can be run from here" — checked, it only holds
  `{version, updatedAt, hashes}`, command-registration hashes, no
  credentials at all) is **not** evidence either way. Whether this
  machine has its own separate Discord bot application/token configured
  somewhere else (`~/.openclaw/credentials/`, `~/.openclaw/service-env/`,
  or similar) is genuinely unconfirmed — see the open question below. No
  bot process is currently running (`ps aux` confirms).

**Implication for every ticket below:** "live, not assumed" verification
happens **against this local sandbox**, using whatever test
`AUTH_CENTER`/`SESSION_MEMORY_URL` this machine's `~/.openclaw/.env`
points at (an implementer must read `~/.openclaw/.env` at ticket-start
time and confirm it is *not* pointed at bobby-cli's real production
defaults before running anything — same T7/T8 caution spec 14 § 3.8
already applies to bobby-cli itself, now applying one level up to which
Discord bot/guild this session drives). Getting a change from "verified
locally" to "running in production" is **explicitly out of scope for
every ticket in this plan** — same `PRODUCTION-UPDATES.md` manual-only
rule `tickets/README.md`'s "Deliberately out of scope" section already
states for T01–T09, restated here because it now also covers a second
repo this plan touches.

### Pre-flight gate (owned by T10 — must pass before any live-Discord-turn
step in T11–T13 or T16 runs)

Open question, not yet answered: does this machine's `~/.openclaw`
install have its own separate Discord bot application/token (somewhere
outside `.env` — e.g. `~/.openclaw/credentials/` or
`~/.openclaw/service-env/`, unconfirmed which), distinct from whatever
bot production Docker runs? If yes, live-Discord-turn verification below
can proceed as written. If this local install actually shares Discord
application credentials with production (same bot token/application),
then driving a real Discord turn from this machine would act *as* the
production bot even though the skill files being tested are local-only —
materially riskier than the "just a sandbox" framing above assumes.

This is a **blocking pre-flight step, not a background open question**:
T10 (the first ticket in the dependency order below) must include, as
its own Acceptance Criterion, confirming which Discord
application/token this local install uses and recording that it is
separate from production, **before** T11's, T12's, T13's, or T16's own
Acceptance Criteria that involve an actual Discord turn are attempted. If
T10's check finds this machine shares production's bot credentials, stop
and escalate to the owner before writing or running any live-Discord-turn
ticket step — do not substitute a lower-fidelity check (e.g. CLI-only,
no real Discord turn) silently without flagging that the plan's
verification standard could not be met as designed.

## Ticket ID continuation

Last used ID is T09 (`tickets/T09-verification-trial-rerun.md`, closed
2026-07-20). T08 was retired, not reused (`tickets/README.md`). This plan
allocates **T10–T16**, continuing the sequence, not reusing T08.

## Ticket breakdown

| # | Ticket | Spec 14 § | Repo / path | Local-only or has a prod follow-up? |
|---|---|---|---|---|
| T10 | `bobby-cli/SKILL.md` (non-invocable reference skill) — shared base + Discord appendix — **plus** the Discord-bot-credential pre-flight check (see "Pre-flight gate" above; this second AC is spec-15-new, not from spec 14) | § 3.1, Decision 4 | `~/.openclaw/workspace/skills/bobby-cli/SKILL.md` (new file) | Local-only; prod copy is a manual follow-up, out of scope |
| T11 | `/login` rewrite | § 3.3 | `~/.openclaw/workspace/skills/login/SKILL.md` | Local-only |
| T12 | `/setup` rewrite | § 3.4 | `~/.openclaw/workspace/skills/setup/SKILL.md` | Local-only |
| T13 | `/logout` new skill | § 3.5 | `~/.openclaw/workspace/skills/logout/SKILL.md` | Local-only |
| T14 | `/setup-memory` rewrite (incl. `AGENTS.md` Identity Gate rewrite, `~/.bobby-cli/.env` write, bootstrap login, companion-skill check, smoke test, `session-memory-call.py` deletion) | § 3.6 | `~/.openclaw/workspace/skills/setup-memory/SKILL.md`, `~/.openclaw/workspace/AGENTS.md`, `~/.bobby-cli/.env` (written by the wizard, not by the ticket author), delete `~/.openclaw/scripts/session-memory-call.py` | Local-only |
| T15 | Migration step — delete pre-existing legacy session files | § 3.7 | `~/.openclaw/user-sessions/*.json`, `~/.openclaw/server-sessions/*.json` | Local-only (this machine's own legacy test files, not production users' files) |
| T16 | Verification — re-run spec 14's Success Criteria live, this sandbox | § "Success criteria" (all 9 items) | spans T10–T15 | Local-only, mirrors T09's role for specs 12/13 |

Why `bobby-cli/SKILL.md` (T10) is listed separately from T14 even though
both are part of "make `/setup-memory` deploy things": spec 14 § 3.1 treats
the reference skill's deployment as structurally independent of
`/setup-memory`'s wizard steps (the wizard doesn't write
`bobby-cli/SKILL.md` — nothing in § 3.6's step list does). Landing T10
first means T11–T13's thin bodies have something to point at when they say
"run the command from the bobby-cli skill's table," matching how
`tickets/README.md`'s own dependency graph sequences shared-artifact
tickets before their consumers (T01 before T02, etc.).

## Dependency order

Two different kinds of edge appear below, both drawn as plain `├──>`
arrows in the ASCII graph (this format has no solid/dashed distinction to
render) but distinguished by the bracketed `[live AC: …]` annotation next
to each node: **code/authoring dependencies** (unannotated — ticket A's
file content references or requires ticket B to exist) and
**live-test/runtime-sequencing dependencies** (annotated with
`[live AC: …]` — ticket A's *code* doesn't need ticket B, but ticket A's
live-Discord-turn Acceptance Criterion can't be exercised until ticket B
has actually run once against this sandbox). Conflating the two was a round-1 audit finding
(B2) against an earlier draft that put legacy-file deletion only right
before T16 — too late, since spec 14 § 3.7 requires legacy files gone
before *any* first post-migration `/login`/`/setup` call, not just before
a final consolidated check.

```
T10 (bobby-cli/SKILL.md reference + pre-flight Discord-credential check,
     see "Pre-flight gate" above — referenced by T11/T12/T13's bodies)
  │
  ├──> T15 [scheduling only, no code dependency on T10 — placed here so
  │         it lands early, not because its file deletion needs T10's
  │         code] (delete legacy session files — code-independent of
  │         T11-14, but every ticket below with a live-Discord-turn AC
  │         needs this to have already run; sequenced right after T10
  │         precisely so no later ticket's live test can accidentally run
  │         against a stale legacy file)
  │
  ├──> T11 (/login)          [live AC: needs T15 done]
  ├──> T13 (/logout)         [live AC: needs T15 done, AND T11's own live
  │                            test to have produced a logged-in profile
  │                            first — there is nothing to log out of
  │                            otherwise]
  ├──> T12 (/setup)          [live AC: needs T15 done, AND T14's bootstrap
  │                            login (§ 3.6 Step 2) to have run at least
  │                            once — spec 14 § 3.4's ordering-gate fix]
  └──> T14 (/setup-memory rewrite, AGENTS.md, ~/.bobby-cli/.env,
            delete session-memory-call.py — no `[live AC: …]` tag here:
            its own live steps, § 3.6 Steps 2/5, run against bobby-cli's
            default-path team identity, not any per-user profile file
            T15 clears, so it isn't gated on T15 the way T11/T12/T13 are)
         │
         └──> T16 [gates on ALL of T10–T15 landing, not just T14 — drawn
                    as T14's child only because T14 is last in read
                    order above, not because it's T16's sole prerequisite]
              (consolidated live verification — all 9 success
                    criteria re-checked together as a regression pass,
                    same role T09 played for specs 12/13; this is a
                    completeness/regression check, not the *only* place
                    live testing happens — T11/T12/T13 each already did
                    their own live-Discord-turn check per spec 14's
                    criteria 3/4/5 as part of landing their own ticket)
```

T11/T12/T13 are mutually independent in code — each is a thin,
separately-committable skill body depending only on T10 — but their live
Acceptance Criteria have the runtime-sequencing edges listed above
(T15 for all three; T14 additionally for T12; T11 additionally for T13).
A ticket-writer should schedule T15 to land (and be re-run if any
skill's live test needs a clean slate again) before attempting T11's,
T12's, or T13's own live-Discord-turn AC — not defer that cleanup to T16.

## Per-ticket notes for whoever writes the full tickets next

Each of T10–T16 should follow `tickets/README.md`'s existing shape
(self-contained, exact file paths, mechanically checkable AC, explicit
out-of-scope) and its Implementation Workflow section (read-only-the-ticket,
build/verify-by-running, diff-scope check, commit-per-ticket,
`/code-review` medium per commit). Specific to this ticket set:

- **Every ticket's Acceptance Criteria must say "verified against this
  machine's local `~/.openclaw` sandbox," not "verified in production."**
  No ticket in this set has a production deploy step — same
  `PRODUCTION-UPDATES.md` rule T01–T09 already followed, explicitly
  restated here since this is the first ticket set to touch the
  `~/.openclaw` tree at all.
- T11–T13's Acceptance Criteria should reuse spec 14's own exact bash
  snippets (§ 3.3–3.5) as the literal "Exact changes required" content —
  spec 14 already wrote these to implementation precision after 3 audit
  rounds; the ticket-writer's job is to package them with surrounding
  file-path/AC/out-of-scope scaffolding, not redesign them.
- T14 carries the most risk of scope creep — full § 3.6 scope is five
  artifacts/actions, not three: the skill body, the `AGENTS.md` Identity
  Gate rewrite, the `~/.bobby-cli/.env` write + Step 1b re-read gate, the
  bootstrap login + companion-skill check + smoke test (Steps 2/4/5), and
  the `session-memory-call.py` deletion. Consider whether it should be
  split further once written out in full ticket form; this plan does not
  decide that, flagging it for the ticket-writer to judge once T14's
  content is drafted.
- T16 should copy T09's structure (numbered checklist mapped 1:1 to spec
  14's 9 success-criteria items, PASS/MIXED/FAIL per item, same
  "left for the user" closing section for any cleanup the ticket itself
  can't do, e.g. stopping the test bot process it started).

## Out of scope for this ticket set (restated from spec 14, applies to T10–T16)

- Any production deploy — manual-only, `PRODUCTION-UPDATES.md`; no ticket's
  AC includes shipping to the Linux Docker production host.
- A converter for existing session files (spec 14 Decision 2 — re-login
  only).
- Device-code login (spec 14 Decision context / spec 13 § 4, still
  deferred).
- Anything not already decided in spec 14 — this plan does not reopen any
  of spec 14's 5 recorded Decisions.
