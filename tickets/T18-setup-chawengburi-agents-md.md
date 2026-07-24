# T18 — Create `setup-chawengburi/SKILL.md` (renamed from `setup-memory`) and rewrite `AGENTS.md`

**Type:** Feature
**Priority:** Critical
**Complexity:** L (3–5 days — full wizard rewrite + a 4-edit `AGENTS.md`
content delta that must match spec 16 § 2a exactly)

**Repo:** `~/.openclaw/workspace/` — same separate repo as T17, not
`bobby-cli`, not `chawengburi`. See tickets README "Note on repo
boundaries."

## Summary

Creates `~/.openclaw/workspace/skills/setup-chawengburi/SKILL.md` (renamed
from `setup-memory`, registers as `/setup_chawengburi`) as a **new** file —
the live `setup-memory/SKILL.md` is left untouched here and archived
unmodified by T19, a separate ticket — and rewrites
`~/.openclaw/workspace/AGENTS.md` in place with the four edits spec 16
§ 2a specifies exactly. This is `bobby-cli/specs/16-spec-openclaw-consolidated-skill.md`
§ 2 + § 2a, copied inline below. Carries forward the intent of retired
plan item `T14` (spec 15, never implemented — `/setup-memory` rewrite),
retargeted to this spec's single-skill layering.

## Background & Context

- Source: spec 16 § 2 (why `setup-chawengburi` stays a separate skill, not
  folded into `bobby-cli`), § 2a (exact `AGENTS.md` delta), § 2b
  (environment portability — design properties this ticket must satisfy;
  full live *verification* of § 2b is T21's job, not this ticket's).
- **Why this stays separate from `bobby-cli`** (spec 16 § 2, owner's
  framing): this skill configures system-prompt/harness bootstrap state
  (`~/.bobby-cli/.env`, `AGENTS.md`'s Identity Gate, the admin's own
  shared team login) rather than a per-user or per-guild identity action —
  a one-time host-bootstrap wizard, structurally different in audience
  (host admin, run once) and blast radius (writes env files, rewrites
  `AGENTS.md`, deletes the old helper script) from the three repeatable
  user-facing actions T17 implements. This was considered and rejected for
  consolidation for the same isolation reasons spec 14 § 3.1 already used
  to justify keeping `setup-memory` separate from `login`/`setup` — not
  reopened by this spec, just renamed.
- The underlying step content (Steps 0/1/1b/2/5) is unchanged from spec 14
  § 3.6 — reproduced in full below since this ticket must be self-contained.
  Only Step 3 (`AGENTS.md` content), Step 4 (companion-skill check), and
  every user-facing `/login`/`/setup` text reference outside Step 3 are
  retargeted for this spec's layering.
- **Two content gaps spec 16 leaves unresolved that this ticket must fill,
  flagged explicitly (not silently assumed):**
  - `[ASSUMPTION]` **Frontmatter.** Spec 16 says "renamed... Content is
    spec 14 § 3.6, with three retargets" but never prints the new
    frontmatter block. Derived below by taking the live
    `setup-memory/SKILL.md` frontmatter (read in full while writing this
    ticket) and updating only `name` and `description` to match the new
    name/scope — no other frontmatter field changes.
  - `[ASSUMPTION]` **Completion message.** Spec 14 § 3.6 never specified
    new completion-message text for `/setup-memory` (its step list ends at
    "Step 5 — smoke test" with no completion section). Spec 16's retarget
    rule 2 ("every place spec 14 § 3.6 says `/login`/`/setup` in
    user-facing text outside the `AGENTS.md`-writing step is retargeted")
    applies to the completion message too, since it's user-facing text
    outside Step 3. The live `setup-memory/SKILL.md`'s current completion
    message (read in full while writing this ticket) is the base text;
    retargeted below to name `/bobby_cli login`/`/bobby_cli setup` and
    to stop naming `session-memory-call.py` (deleted by this same ticket's
    Step 3 rewrite — the line would otherwise be false the moment this
    ticket lands). Flag this for the Thai-wording copy-review pass spec 16
    itself lists as open, non-blocking polish (§ "Open items").
- This ticket does not touch `bobby-cli`'s source code — everything here
  is skill/config files in the openClaw workspace repo.

## Part A — `setup-chawengburi/SKILL.md` (new file)

Create `~/.openclaw/workspace/skills/setup-chawengburi/SKILL.md`:

````markdown
---
name: setup-chawengburi
description: "Bootstrap bobby-cli/session-memory for this OpenClaw instance — configures ~/.bobby-cli/.env, the admin's shared team login, writes AGENTS.md's bobby-cli command table, and verifies the connection"
user-invocable: true
metadata:
  {
    "openclaw": {
      "emoji": "🧠"
    }
  }
---

# Setup Chawengburi Skill

> **STRICT WIZARD — follow this script exactly.**
> - Execute steps in the order written. Do not skip decision points.
> - Use the user's language.
> - Do not print raw tokens, token previews, session JSON, Bearer headers, or local session/credential paths in the final user-facing reply.

When the user runs `/setup_chawengburi`, bootstrap this OpenClaw instance
so `/bobby_cli login`/`/bobby_cli setup` work.

---

## Step 0 — bobby-cli present on this host

```bash
bobby-cli --version
```
Missing/not on `PATH` → tell the admin to `npm install -g bobby-cli` first
and stop. Every later step assumes this succeeded.

---

## Step 1 — Guided save-flow for `AUTH_CENTER`/`SESSION_MEMORY_URL`

Write to **`~/.bobby-cli/.env`** (not `~/.openclaw/.env` — bobby-cli never
reads that file; confirmed `src/index.ts` only loads the cwd `.env` and
`~/.bobby-cli/.env`):
```
AUTH_CENTER=<url>
SESSION_MEMORY_URL=<url>
```
`AI_TOKEN` is not written to this file — bobby-cli mints and stores its
own token via `auth login` in Step 2. Ask for each missing value, same
guided prompt/parse shape as the old wizard, until both are present.

---

## Step 1b — Mechanical refusal, not a default

Before Step 2 runs, confirm both URLs are actually present:
```bash
grep -c '^AUTH_CENTER=' ~/.bobby-cli/.env
grep -c '^SESSION_MEMORY_URL=' ~/.bobby-cli/.env
```
Either count is `0` (or the file doesn't exist yet, so `grep` exits
non-zero with no count — treat identically to a `0` count) → **stop**, do
not run Step 2, and re-prompt Step 1. This is a checkable gate the wizard
script must read and act on, not a guarantee the shell enforces on its
own — never silently fall through to Step 2 without both counts being
nonzero.

---

## Step 2 — Admin bootstrap login

```bash
BOBBY_CLI_EMAIL="<email>" BOBBY_CLI_PASSWORD="<password>" \
  bobby-cli auth login --json
```
No `--profile` — the shared team identity is bobby-cli's own default path
(`~/.bobby-cli/credentials.json`), the same one `/bobby_cli setup` (T17)
reads via `cp`. Only reachable after Step 1b's gate passes.

---

## Step 3 — Install the rewritten `AGENTS.md`

Programmatically write `~/.openclaw/workspace/AGENTS.md`, same
backup-before-overwrite behavior as the current wizard. Apply the exact
four edits below (Part B of this ticket) to the file currently live at
`~/.openclaw/workspace/AGENTS.md`. Everything in the current file outside
those four edited sections is carried over unchanged.

`~/.openclaw/scripts/session-memory-call.py` (the old ~180-line
hand-written JSON-RPC/SSE-parsing helper) is deleted as part of this step
— bobby-cli covers its transport responsibilities (JSON-RPC framing,
SSE-vs-JSON response parsing, `sm_live_*` redaction) plus structured
`code`/`hint` the helper's plain status strings never had.

---

## Step 4 — Confirm companion skill exists

```bash
test -f ~/.openclaw/workspace/skills/bobby-cli/SKILL.md && echo BOBBY_CLI_OK || echo BOBBY_CLI_MISSING
```
(Retargeted from the old three-file check — `login`/`setup`/`logout` no
longer exist as separate skills under this spec's layering; T17's single
consolidated `bobby-cli` skill is the one thing to confirm.) If missing,
tell the user `/bobby_cli` must be installed before production Discord use.

---

## Step 5 — Smoke test

```bash
bobby-cli memory show --json
```
No `--profile` — same default-path team identity as Step 2.

---

## Completion

Before sending success, confirm: Step 1 wrote both URLs; Step 1b's gate
passed; Step 2 returned `ok:true`; Step 3 installed the rewritten
`AGENTS.md` and deleted `session-memory-call.py`; Step 4 found
`BOBBY_CLI_OK`; Step 5 returned a successful `memory show` result.

Success message:
> ✅ ตั้งค่า bobby-cli สำหรับ OpenClaw instance นี้เรียบร้อยแล้วครับ
>
> ตอนนี้ Discord memory จะใช้ bobby-cli:
> - DM users ใช้ `/bobby_cli login`
> - Guild/shared memory ใช้ `/bobby_cli setup`
> - ทุก memory request จะผ่าน bobby-cli โดยตรง (ไม่มี Python helper อีกต่อไป)
>
> แนะนำให้รัน `openclaw doctor --non-interactive` ต่อเพื่อตรวจ version/plugin/gateway warnings ก่อนใช้งาน production

If any step failed, summarize the failed step and the next action. Do not
claim setup is complete.
````

## Part B — `AGENTS.md` content delta (exact, spec 16 § 2a)

Apply against the live `~/.openclaw/workspace/AGENTS.md` (re-read it before
editing — it may have drifted since this ticket was written; the "current
text" blocks below were verified accurate as of 2026-07-24).

**Edit 1 — Discord Identity Gate, items 4–5.** Current text:
```
4. If the required session file is missing, explain the next action:
   - DM: ask the user to run `/login`.
   - Guild: ask an admin to run `/setup`.
5. If a helper reports the session is expired or corrupt, ask for `/login`
   or `/setup` again as appropriate.
```
Replace with:
```
4. If the required session file is missing, explain the next action:
   - DM: ask the user to run `/bobby_cli login`.
   - Guild: ask an admin to run `/bobby_cli setup`.
5. If a memory op returns `code: "not_logged_in"`, delete that profile's
   session file yourself first (spec 14 § 3.6's F8 self-heal rule — a bare
   `bobby-cli` call does not self-delete the way the old Python helper
   did): DM → `~/.openclaw/user-sessions/{SENDER_ID}.json`; guild →
   `~/.openclaw/server-sessions/{GUILD_ID}.json`. Then ask for
   `/bobby_cli login` or `/bobby_cli setup` again as appropriate.
```

**Edit 2 — the entire "Safe Session-Memory Helper" section** is replaced:
```
## bobby-cli Command Table

For Discord memory operations, invoke bobby-cli directly — never raw
curl/urllib. Every call ends with `--json`; branch on the `code` field,
never parse `text`. The subcommands are `show` (list recent — bobby-cli
exposes the `list_recent` operation under `memory show`, verified
`src/commands/memory.ts:95-111`; there is no `memory list_recent`
subcommand), `recall <query>`, `remember [text]`, `append <id> <text>`,
`forget <id>`.

DM (personal memory):
```bash
BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions \
  bobby-cli memory <show|recall|remember|append|forget> "..." \
  --profile "$SENDER_ID" --json
```

Guild (shared/public memory):
```bash
BOBBY_CLI_PROFILES_DIR=~/.openclaw/server-sessions \
  bobby-cli memory <show|recall|remember|append|forget> "..." \
  --profile "$GUILD_ID" --json
```

Status handling:
- `ok:true` → use `text`/structured fields as memory context.
- `code:"not_logged_in"` → apply the self-heal delete above, then tell the
  user/admin to `/bobby_cli login` (DM) or `/bobby_cli setup` (guild).
- Any other `ok:false` → follow the `hint` field exactly; never invent
  recovery text not present in `hint`.
- `bobby-cli` itself missing/misconfigured on this host → tell an admin to
  run `/setup_chawengburi`.

Never print or summarize the raw `apiToken` or session file content to a
Discord user.
```

**Edit 3 — the "Login And Setup Boundaries" section.** Current text:
```
## Login And Setup Boundaries

- `/login` creates DM personal memory for that Discord user.
- `/setup` creates guild/server memory for a Discord server.
- A successful DM login does not automatically authorize guild memory.
- A successful setup does not expose any user's personal memory.
```
Replace with:
```
## Login And Setup Boundaries

- `/bobby_cli login` creates DM personal memory for that Discord user.
- `/bobby_cli setup` creates guild/server memory for a Discord server
  (requires `/setup_chawengburi` to have run at least once first).
- `/bobby_cli logout` deletes the local DM credential copy only — it does
  not revoke the token server-side (spec 14 § 3.5's caveat).
- A successful DM login does not automatically authorize guild memory.
- A successful setup does not expose any user's personal memory.
```

**Edit 4 — Startup Priority item 4.** Current text:
```
4. Do not read project files to answer Discord user memory questions. Discord memory must come from session-memory through the safe helper.
```
Replace with:
```
4. Do not read project files to answer Discord user memory questions. Discord memory must come from session-memory through bobby-cli (the command table below).
```

Everything else in the current `AGENTS.md` (the rest of Startup Priority,
Memory Behavior, Discord Response Rules, General Safety) is unaffected and
must not change.

## Acceptance Criteria

1. Given `~/.openclaw/workspace/skills/setup-chawengburi/SKILL.md`, then it
   exists, `user-invocable: true`, `name: setup-chawengburi`, and Steps
   0/1/1b/2/5 match Part A above exactly (bash blocks byte-for-byte).
2. Given the same file, then Step 3 references installing the `AGENTS.md`
   delta from Part B and deleting `session-memory-call.py`; Step 4's
   companion check tests exactly one path
   (`skills/bobby-cli/SKILL.md`), not the old three-file check.
3. Given `~/.openclaw/workspace/skills/setup-memory/` (the old directory),
   then it is **untouched** by this ticket — `git status` in the openClaw
   workspace repo shows no changes under that path. (Its archival is T19,
   a separate ticket.)
4. Given `~/.openclaw/workspace/AGENTS.md` after this ticket, then a diff
   against the pre-ticket version shows exactly the four edits in Part B
   above and nothing else — `git diff` (or a manual diff against a
   pre-change backup) confirms no other section changed.
5. `grep -c "session-memory-call.py" ~/.openclaw/workspace/AGENTS.md`
   returns `0`.
6. `grep -E "(^|[^_])/login|(^|[^_])/setup([^_]|$)" ~/.openclaw/workspace/AGENTS.md`
   (bare, unqualified references) returns **zero** matches.
7. `~/.openclaw/scripts/session-memory-call.py` no longer exists on disk
   (`test -f` fails).
8. `bobby-cli auth login`/`bobby-cli auth show` calls in Step 2/Step 5
   above use no `--profile` flag (shared team identity is the CLI's own
   default credentials path) — confirmed by reading the file, not assumed.
9. Environment-portability design properties from spec 16 § 2b are true of
   the file as written (not live-tested here — that's T21's job): every
   path referenced is `$HOME`-relative (no hardcoded username/directory);
   Step 2's login is non-interactive (env vars, not prompts blocked on a
   TTY); Steps 0 and 1b are mechanical, falsifiable shell checks, not
   prose the admin has to remember.

## Dependencies

Depends on T17 (`bobby-cli/SKILL.md` must exist for Step 4's companion
check and for the `AGENTS.md` command table's references to
`/bobby_cli login`/`/bobby_cli setup` to be true statements, not forward
references to a skill that doesn't exist yet). May cite T17's
Discord-bot-credential pre-flight confirmation instead of re-running it,
per T17's own dependency note — this ticket has no live-Discord-turn AC
of its own (Step 5's smoke test is a CLI-only check, not a Discord turn).

## Out of Scope

- `bobby-cli/SKILL.md` itself — T17.
- Archiving `login/`, `setup/`, `setup-memory/` into `old_skills/` — T19.
- Deleting pre-existing `~/.openclaw/user-sessions/*.json` /
  `server-sessions/*.json` files — T20.
- Live-testing this ticket's work in a real Discord turn, and the full
  environment-portability fresh-`$HOME` check from spec 16 § 2b — both
  T21's job, not this ticket's.
- The exact Thai wording pass spec 16 itself flags as open, non-blocking
  polish (§ "Open items") — this ticket's `[ASSUMPTION]`-flagged
  completion message and frontmatter description are functional, not a
  final copy-review.
