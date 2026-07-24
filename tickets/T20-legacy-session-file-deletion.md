# T20 — Delete pre-existing legacy `user-sessions`/`server-sessions` files

**Type:** Chore
**Priority:** Critical
**Complexity:** XS (< 2h)

**Repo:** none (filesystem operation on `~/.openclaw/`, not inside any git
repo — `user-sessions/` and `server-sessions/` are runtime state
directories, not tracked by the `~/.openclaw/workspace/skills/` repo T17–T19
touch). See tickets README "Note on repo boundaries."

## Summary

Deletes every pre-existing `~/.openclaw/user-sessions/*.json` and
`~/.openclaw/server-sessions/*.json` file before first use of the new
`bobby-cli`/`setup-chawengburi` skills. This is spec 14 § 3.7 (Decision 2),
inherited unchanged by spec 16 (spec 16's "Unchanged, inherited verbatim
from spec 14" list explicitly names § 3.7). Carries forward the intent of
retired plan item `T15` (spec 15, never implemented — same migration step,
scoped against the old four-skill layering; the deletion itself is
layering-independent, so its intent transfers here unchanged).

## Background & Context

- Source: spec 14 § 3.7, "Existing session files are not converted —
  one-time re-login (Decision 2)," full text reproduced below since this
  ticket must be self-contained.
- **The real bug this prevents, not just cleanup:** the legacy session
  files (`{discordUserId, userId, email, apiToken, tokenLabel,
  createdAt}`) do not match bobby-cli's `Credentials` shape
  (`authCenterUrl`/`sessionMemoryUrl`/`email`/`tenantId`/`apiToken`/
  `apiTokenId`/`apiTokenLabel`/`scopes`/`createdAt`/`expiresAt` —
  `src/core/config.ts:24`). `loadCredentials()`
  (`src/core/config.ts:58-65`) is `JSON.parse(...) as Credentials` — a
  type-cast, not runtime shape validation — and returns `null` only on a
  missing file or invalid JSON *syntax*. A legacy file is syntactically
  valid JSON, so it "successfully" parses into an object missing
  `sessionMemoryUrl`/`authCenterUrl`/etc. as `undefined`. This does **not**
  cleanly produce a `not_logged_in` code the way a missing file would — it
  more likely surfaces as a raw fetch/network error against `undefined` as
  a URL, a worse failure mode than the "please log in again" path this
  migration is trying to guarantee.
- **Decided** (spec 14 § Decisions, item 2): no format converter — at this
  project's dev/trial scale, requiring each existing DM/guild user to run
  `/bobby_cli login`/`/bobby_cli setup` once after this migration ships is
  cheaper than writing and maintaining a one-time converter script.
  Because `BOBBY_CLI_PROFILES_DIR` points at these exact same existing
  directories (`~/.openclaw/user-sessions`, `~/.openclaw/server-sessions`
  — spec 14 § 3.2's F4 fix, unchanged by spec 16), "re-login" needs **no
  directory move**: a fresh `bobby-cli auth login --profile "$SENDER_ID"`
  (or the guild `cp` in T17's SETUP action) simply overwrites the legacy
  ad hoc JSON in place with a proper `Credentials`-shaped file.
- **Why this must happen before first use, not "eventually get
  overwritten":** without this deletion, any Discord user who has not yet
  re-run `/bobby_cli login`/`/bobby_cli setup` sees the worse failure mode
  above (raw fetch error) instead of the correct `not_logged_in` →
  "run `/bobby_cli login` again" path T18's `AGENTS.md` self-heal rule
  (Edit 1, item 5) is built to handle. Leaving stale files in place would
  make that self-heal rule untestable in T21 for any Discord identity that
  predates this migration.

## Exact changes required

```bash
rm -f ~/.openclaw/user-sessions/*.json
rm -f ~/.openclaw/server-sessions/*.json
```
Run once, as part of shipping this migration — not left as a "someday"
cleanup step. If either directory does not exist or is already empty,
that is not an error; the goal state (no pre-migration files remaining) is
already satisfied.

**Do not delete the directories themselves** — `~/.openclaw/user-sessions/`
and `~/.openclaw/server-sessions/` must still exist as the target of
`BOBBY_CLI_PROFILES_DIR` for T17's LOGIN/SETUP actions to write into
(`bobby-cli auth login --profile ...` and the SETUP `cp` both write into
these directories; if they don't exist, confirm bobby-cli or the wizard
step creates them on write — if not, `mkdir -p` both after the `rm`).

## Acceptance Criteria

1. Given `~/.openclaw/user-sessions/`, then `ls ~/.openclaw/user-sessions/*.json`
   (or the equivalent glob) returns no files that predate this ticket's
   execution timestamp.
2. Given `~/.openclaw/server-sessions/`, then the same check returns no
   files that predate this ticket's execution timestamp.
3. Given both directories, then they still exist on disk (not deleted) and
   remain writable — confirmed by running a fresh
   `BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions bobby-cli auth show
   --profile "__T20_smoke__" --json` (expect `loggedIn:false`, not a
   directory-not-found error) after the deletion.
4. Given any pre-migration Discord identity (DM user or guild) that had a
   legacy session file before this ticket ran, then their first post-
   migration `/bobby_cli login` or `/bobby_cli setup` call — after T17/T18
   have landed — produces a clean `not_logged_in` → re-login path (per
   T18's `AGENTS.md` Edit 1 item 5), not a raw fetch/network error against
   an `undefined` URL. (This specific behavioral check may be exercised
   together with T21's live login/setup criteria rather than repeated
   standalone, since it needs the full stack in place — note the result
   here regardless of which ticket's session executes it.)

## Dependencies

No hard technical dependency — the `rm` itself doesn't require T17/T18/T19
to exist. Sequenced after T17/T18 (so the "first post-migration login"
AC4 above is meaningful — logging in via the *new* `/bobby_cli login`
path, not the old Python-helper one) and before T21 (verification depends
on this having run, per spec 16 success criterion 8). Independent of T19
(archiving the old skill directories is unrelated to these runtime session
files).

## Out of Scope

- Writing a session-file format converter — explicitly decided against
  (spec 14 § Decisions, item 2). Revisit only if a real production Discord
  user base exists by the time this actually ships to production (spec 14
  § 3.7's own revisit condition; it doesn't today).
- Any change to `bobby-cli`'s `loadCredentials()` type-cast behavior — the
  gap described above is accepted as-is; this ticket's deletion is the
  agreed mitigation, not a CLI code fix.
- Production's own legacy session files — this ticket only touches this
  sandbox host (`~/.openclaw/`); production runs on a separate host/repo
  per spec 16 § 2b, out of scope here same as the rest of this ticket set.
