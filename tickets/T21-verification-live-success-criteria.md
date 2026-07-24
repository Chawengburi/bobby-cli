# T21 — Live verification of all 10 spec 16 success criteria

**Type:** Task
**Priority:** Critical
**Complexity:** M (1–2 days)

**Repo:** spans `~/.openclaw/` (filesystem + the workspace skills repo) and
a live Discord server/DM on this sandbox's bot. No `bobby-cli` or
`chawengburi` repo changes expected from this ticket (verification-first —
see "Out of Scope"). See tickets README "Note on repo boundaries."

## Summary

This is the closing acceptance ticket for the T17–T20 effort — it does not
add new product code beyond fixing whatever this verification finds
broken. It exercises, live, every one of spec 16's 10 success criteria
(`bobby-cli/specs/16-spec-openclaw-consolidated-skill.md` § "Success
criteria"), reproduced in full below so this ticket needs no other file
open to execute. Do this ticket last, after T17–T20 have all landed.
Carries forward the intent of retired plan item `T16` (spec 15, never
implemented — same "live-exercise the success criteria" role, retargeted
to this spec's 10 self-contained criteria instead of spec 14's original
list, several of which named commands (`/login`, `/setup`, `/setup-memory`)
that don't exist under this spec's layering).

## Discord-bot-credential pre-flight gate

Before any live-Discord-turn item below, confirm T17's pre-flight gate
(see T17 "Discord-bot-credential pre-flight gate") is still valid — i.e.
`~/.openclaw/openclaw.json`'s `channels.discord.token`/`channels.discord.guilds`
haven't changed since T17's confirmation was recorded. If they have,
re-run T17's gate checks before proceeding. Never paste a raw Discord bot
token or a raw `sm_live_*` token into this ticket's execution notes, a
commit, or a session record.

## What to verify (every item below must be explicitly executed, not assumed)

### 1. Skill directory layout

`~/.openclaw/workspace/skills/` contains: one user-invocable `bobby-cli`
skill (registers `/bobby_cli`, T17, all three actions), one
user-invocable `setup-chawengburi` skill (registers `/setup_chawengburi`,
T18), the unchanged `forget` skill, and an `old_skills/` folder holding
the three archived originals verified inert per T19. No skill directory
claims the `login`, `setup`, or `setup-memory` command names anymore.
(`ls ~/.openclaw/workspace/skills/` plus the loader re-check from T19 AC6.)

### 2. Helper script fully removed

`~/.openclaw/scripts/session-memory-call.py` no longer exists (`test -f`
fails); no skill invokes raw `curl`/`urllib` against auth-center or
session-memory (`grep -rl "curl\|urllib" ~/.openclaw/workspace/skills/`
excluding archived `old_skills/` — those may still reference it, they're
inert, not a violation).

### 3. Personal memory, live end to end

A DM user runs `/bobby_cli login`, immediately has working personal
memory through the `bobby-cli`-backed LOGIN action — not assumed from code
review, actually executed in a real Discord DM turn. After login, send a
DM message that should trigger a `memory recall` or `memory remember` and
confirm it succeeds using the newly-created profile.

### 4. Public/shared memory, live end to end, both orderings

- A guild admin runs `/setup_chawengburi` once, then `/bobby_cli setup` in
  a guild, and all members get shared memory — exercised live.
- Running `/bobby_cli setup` **before** `/setup_chawengburi` has ever run
  (use a fresh guild, or a state where the shared team token doesn't exist
  yet) produces the explicit "รัน `/setup_chawengburi` ก่อน" message (T17's
  SETUP Step 3), not a raw `cp` failure.
- Running `/bobby_cli setup` a **second time** on an already-set-up guild
  triggers the confirm-before-overwrite prompt (T17's SETUP Step 2), not a
  silent overwrite.

### 5. `AGENTS.md` routing and self-heal

`AGENTS.md`'s Discord Identity Gate routes every memory op through
bobby-cli with the correct `--profile`/`BOBBY_CLI_PROFILES_DIR` for both
the DM and guild paths (T18's command table). Mechanically:
`grep -c "session-memory-call.py" ~/.openclaw/workspace/AGENTS.md` returns
`0`, and `grep -E "(^|[^_])/login|(^|[^_])/setup([^_]|$)"
~/.openclaw/workspace/AGENTS.md` returns zero matches. Then, live: induce
a `code:"not_logged_in"` response from a memory op (e.g. call it against a
profile with no session file) and confirm the agent deletes that profile's
file (T18's `AGENTS.md` Edit 1 item 5), not just reports the error.

### 6. Environment portability (spec 16 § 2b), mechanically checked

`setup-chawengburi`'s Step 0/1/1b are run once against a fresh, empty
`HOME` **before** ever touching this machine's real `~/.bobby-cli` state:
```bash
HOME=$(mktemp -d) bobby-cli --version
```
Confirm this fails cleanly with a message equivalent to the documented
admin message ("`npm install -g @babyferret/bobby-cli` first") when `bobby-cli` isn't
resolvable relative to that fake `HOME`'s `PATH` expectations, or
succeeds identically to normal if `bobby-cli` is genuinely on the global
`PATH` (global installs aren't `HOME`-scoped — if so, note this and
instead verify Step 1b's gate under the fresh `HOME`):
```bash
HOME=$(mktemp -d) bash -c 'grep -c "^AUTH_CENTER=" ~/.bobby-cli/.env; grep -c "^SESSION_MEMORY_URL=" ~/.bobby-cli/.env'
```
Confirm both `grep`s fail/return `0` against the empty fresh `HOME` (no
`~/.bobby-cli/.env` exists there), proving Step 1b's gate would correctly
stop rather than silently proceed to Step 2 (`auth login`) — i.e. the
wizard's mechanical gate, not just documentation, actually blocks on a
genuinely fresh host. Delete the temp `HOME` directory afterward.

### 7. No token leakage

`grep -r "sm_live_" <any bot logs / session transcripts available on this
sandbox>` returns no matches. No `sm_live_*` token appears in any
Discord-visible message during any of the live checks above.

### 8. Legacy session files deleted before first use

Confirm T20 ran: `ls ~/.openclaw/user-sessions/*.json
~/.openclaw/server-sessions/*.json` (if any exist at this point) are all
dated at or after T20's execution and T17/T18's re-login testing — i.e.
none predate the migration's own `/bobby_cli login`/`/bobby_cli setup`
re-runs. If any pre-migration file was found still present, that's a T20
regression — file it back against T20, don't silently fix it here beyond
noting it.

### 9. Duplicate-write debounce guidance + typing-indicator behavior

The `remember` duplicate-write debounce guidance (spec 14 § 3.9,
unchanged by spec 16) is present in the deployed `AGENTS.md` text — grep
for the no-retry rule (check `AGENTS.md`'s Memory Behavior section for
language equivalent to "don't call `remember` again for the same fact
inside one turn / while awaiting a result"). Separately, the
`remember`-specific typing/thinking-indicator behavior (spec 14 § 3.10) is
exercised live in an actual Discord turn — send a message that triggers a
`remember` call and confirm the bot shows a typing/thinking indicator
rather than appearing to hang silently during the call.

### 10. Disambiguation and realistic-phrasing intent matching, live

**Bare-keyword / no-signal cases:**
- Sending `/bobby_cli` with no recognizable action produces the
  clarifying question (T17 Step 0), not a guess.
- A message with signals for more than one action (e.g. mentions both
  "login" and "setup" with no clear indication which is current) also
  produces the clarifying question, not a silent pick.
- "login foo bar" (extraneous trailing text after a bare action word) is
  checked once, confirming the trailing text is discarded — LOGIN fires
  correctly and the trailing text ("foo bar") is never treated as, echoed
  as, or logged as a credential.

**Realistic full-Thai-sentence cases — mandatory per amendment 2, bare
keywords alone do NOT satisfy this criterion.** For **each** of the three
actions, exercised live with **no leading slash** (plain-text,
model-invocation path — this is now the *primary* trigger path for this
bot's actual non-technical-staff audience, not a slash-command fallback),
using a realistic full sentence a non-technical staff member (e.g.
housekeeping, front-desk) would actually type:
- LOGIN: e.g. "อยากจะ login ค่ะ" or "ขอเข้าสู่ระบบหน่อยครับ"
- SETUP: e.g. "ช่วย setup ให้หน่อยได้ไหมคะ"
- LOGOUT: a natural equivalent Thai sentence for logout intent

For each, confirm both:
- (a) the `bobby-cli` skill is triggered at all from plain conversation
  (this is the specific concern flagged in T17's "Structural risk this
  amplifies" section — the plain-text model-invocation path is weaker for
  a consolidated multi-action skill and may simply fail to load the skill
  at all; this must be checked, not assumed to work because Step 0's logic
  is correct on paper), and
- (b) once loaded, Step 0 resolves the correct action from the full
  sentence rather than misfiring on the leading words ("อยากจะ"/"ขอ"/
  "ช่วย" must not be mistaken for the action itself).

If (a) fails for any of the three (skill never triggers from natural
plain-text Thai), that is a real, reportable gap in this ticket's
findings — not a silent pass, even though it may not be fixable by
editing `SKILL.md` alone (it may require adjusting the skill's frontmatter
`description` further, or is a structural openClaw limitation outside this
ticket set's scope — see spec 16 "Why this exists"/T17's structural-risk
note). Report which of the three fired correctly and which didn't; fix
what's fixable within this ticket's scope (wording/description tuning),
file anything structural as a follow-up rather than silently accepting
failure.

## Acceptance Criteria

Every numbered item (1–10) above has been explicitly executed (not
assumed from a code read) and its result recorded. If any item fails,
this ticket is not done — either fix the underlying issue (filing it
against the ticket that owns that file, e.g. a Step 0 wording bug goes
back to T17) and re-verify, or, if the fix is trivial and clearly scoped
to this verification pass (e.g. a wording tweak to the frontmatter
`description` to improve model-invocation reliability for item 10), fix it
directly as part of closing this ticket and note exactly what was changed
and why.

## Dependencies

Depends on T17, T18, T19, T20 all landing first. This is the last ticket
in the T17–T21 implementation order.

## Out of Scope

- Fixing anything beyond what this verification pass discovers.
- Real production Docker/Linux host testing, or testing against
  production's real `AUTH_CENTER`/`SESSION_MEMORY_URL` — spec 16 § 2b
  explicitly does not claim this is verified; this sandbox is a local test
  environment only (spec 15's own audit boundary), out of scope here same
  as it was for specs 14/15/16.
- Adding real admin-role enforcement to the SETUP action — spec 16
  explicitly decided against this; not reopened by a verification ticket.
- The Thai-wording copy-review pass spec 16 itself lists as open,
  non-blocking polish (§ "Open items") — this ticket verifies *behavior*
  (correct action resolution, correct routing), not final tone/prose
  quality of the Thai messages.
