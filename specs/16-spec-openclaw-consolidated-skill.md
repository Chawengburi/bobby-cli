# 16 Spec: openClaw Migration — Consolidated Single Skill (supersedes spec 14 § 3.1)

> **Status: DRAFT (2026-07-24) — not yet audited.** Written after an
> in-conversation design discussion that deliberately chose a different
> layering than spec 14 § 3.1 (which shipped ACCEPTED, 3 audit rounds,
> 2026-07-20). This spec does **not** redo spec 14's research — it inherits
> every section of spec 14 except § 3.1 (layering) and the parts of § 3.4/
> § 3.6 that § 3.1's change forces to move. Per this project's own workflow
> (`tickets/README.md`), this document must go through the same
> `spec-refinement-advisor` audit ritual spec 12–15 used before it is
> ticket-writeable — that has **not** happened yet. Do not implement against
> this spec until it reaches ACCEPTED.

Builds on: [14-spec-openclaw-migration.md](./14-spec-openclaw-migration.md)
(all content except § 3.1, superseded below), [15-spec-openclaw-migration-tickets-plan.md](./15-spec-openclaw-migration-tickets-plan.md)
(T10–T16 ticket breakdown — will need re-cutting once this spec is
ACCEPTED, since T10–T13 assumed spec 14's four-skill layering).

## Why this exists — decision record from the design conversation

The owner asked, in a Claude Code session on `chawengburi`, whether
`login`/`setup`/`logout` could collapse into a single `bobby-cli` skill
instead of spec 14 § 3.1's two-layer (1 non-invocable + 4 invocable)
design, specifically to simplify setup. The assistant researched the
actual openClaw mechanism (not assumed) before agreeing to draft this:

- **Command-name sanitization (verified, `chat-commands-*.js`,
  `sanitizeSkillCommandName`):** a skill's frontmatter `name` is stripped
  to `[a-z0-9_]` when building its Discord command — hyphens become
  underscores. A skill named `bobby-cli` therefore registers as
  **`/bobby_cli`**, not `/bobby-cli`. Everywhere below uses the correct
  sanitized form.
- **Model-invocation (plain text, no `/`) is a real, separate mechanism**
  from slash-command routing (`resolveSkillInvocationPolicy`,
  `disableModelInvocation` defaults `false`): every skill is listed in an
  `<available_skills>` prompt block unless explicitly opted out, and the
  agent can load a skill from plain conversation text alone. This is
  weaker for a consolidated multi-action skill than for single-purpose
  skills (a one-word message like "login" matches a skill literally named
  `login` far more reliably than a skill named `bobby-cli` whose
  description must now cover three actions), and fails outright in the
  loader's "compact" prompt fallback mode, which drops descriptions and
  keeps only `<name>`/`<location>`. Mitigated below (§ 1, disambiguation
  step) rather than ignored.
- **Skill discovery is exactly one directory level deep** (verified,
  `loadSkillsFromDirSafe`/`listCandidateSkillDirs`: `fs.readdirSync` on
  `skills/`, non-recursive, then one `loadSingleSkillDirectory` check per
  immediate child). This is what makes the `old_skills/` archival plan
  below actually work: `skills/old_skills/login/SKILL.md` is two levels
  down and structurally never discovered, vs. deleting the files outright.

Decided (this conversation, 2026-07-24): proceed with the single-skill
design, with two mitigations the assistant flagged as required rather than
optional (disambiguation-before-guessing, and preserving the live
`/setup` idempotency gate spec 14 § 3.4 had silently dropped) — both
folded into § 1 below.

## Scope of this revision (relative to spec 14)

**Changes:**
- § 3.1 (layering) — replaced by § 1 below.
- § 3.4 (`/setup` body) — folded into § 1's SETUP action, restoring a
  behavior gap found by re-reading the *live* `~/.openclaw/workspace/skills/setup/SKILL.md`
  that spec 14's rewrite had dropped (see § 1, SETUP, Step 2).
- § 3.6 (`/setup-memory`) — kept structurally as-is (still a separate,
  non-consolidated skill — see § 2's rationale) but **renamed to
  `setup-chawengburi`** (registers as `/setup_chawengburi`), its Step 4
  companion-skill check retargeted to the new single-skill layout, and —
  not just a rename — its `AGENTS.md`-writing Step 3 now carries the exact
  corrected content in § 2a, since spec 14 never fully specified that
  text and the live file's five `/login`/`/setup`/`/setup-memory`
  references would otherwise ship stale.
- New: § 2b, environment-portability review of `setup-chawengburi` (the
  owner asked this be checked explicitly, not assumed, given openClaw's
  deployment complexity).
- New: § 3 archival plan for `login/`, `setup/`, `setup-memory/`'s
  original files (`old_skills/`).
- Success criteria rewritten self-contained rather than "unchanged" —
  several of spec 14's original items name commands this spec's layering
  removes.

**Unchanged, inherited verbatim from spec 14:** § 3.2 (`--profile`/
`BOBBY_CLI_PROFILES_DIR` scheme), § 3.5's `/forget` decision (**out of
scope for this spec — `/forget` is an openClaw-only password-reset flow
with no bobby-cli involvement at all; there is nothing to consolidate**),
§ 3.7 (one-time re-login, required legacy-file deletion), § 3.8 (env-var/
first-login safety), § 3.9 (duplicate-write debounce), § 3.10 (latency
budget). Read those sections in spec 14 directly rather than duplicating
them here.

**Explicitly decided against, this conversation:** adding real admin-role
enforcement to the SETUP action. The live `/setup` skill's frontmatter
says "Admin-only" but its Step 0 only checks `is_group_chat = true` — no
role or permission check exists anywhere today (grepped `openclaw.json`,
`AGENTS.md`, `.env` — nothing). openClaw does expose `ctx.MemberRoleIds`
in context, but mapping role IDs to "admin" needs new config this project
doesn't have. Owner's call: keep current behavior (no enforcement) rather
than add scope. Revisit if this ever needs to be a real ticket.

---

## § 1. `bobby-cli/SKILL.md` — single invocable skill, three actions

`~/.openclaw/workspace/skills/bobby-cli/SKILL.md`, `user-invocable: true`,
registers as **`/bobby_cli`** (sanitization above). Replaces spec 14 § 3.1's
non-invocable reference skill plus the three separate `login`/`setup`/
`logout` skills with one file covering all three actions.

````markdown
---
name: bobby-cli
description: "จัดการบัญชี bobby-cli ของคุณผ่าน Discord — login (เข้าสู่ระบบส่วนตัว), setup (เชื่อมต่อ server กับ shared team token), logout (ลบ token ที่บอทเก็บไว้). พิมพ์ /bobby_cli login|setup|logout หรือพิมพ์คำว่า login/setup/logout ตรง ๆ ก็ได้"
user-invocable: true
metadata:
  {
    "openclaw": {
      "emoji": "🔑"
    }
  }
---

# bobby-cli Skill

> **STRICT WIZARD — follow this script exactly.**

## Step 0 — Determine the requested action

Match the user's message (the text after `/bobby_cli`, or the plain-text
message if invoked without a slash) against exactly these three literal
actions:

| User said (any of) | Action |
|---|---|
| `login`, "เข้าสู่ระบบ", "ล็อกอิน" | LOGIN |
| `setup`, "ตั้งค่า", "เชื่อมต่อ" | SETUP |
| `logout`, "ออกจากระบบ", "ล็อกเอาท์" | LOGOUT |

**If none of these match clearly, or the message is ambiguous — STOP and
ask, do not guess:**
> ต้องการ **login** (เข้าสู่ระบบส่วนตัว), **setup** (เชื่อมต่อ server), หรือ **logout** (ออกจากระบบ) ครับ? พิมพ์คำใดคำหนึ่ง

This is the single highest-risk step in this skill — misrouting `login`
text into the SETUP branch (or vice versa) points a Discord user's
password-derived token at the wrong shared identity. No fallback default;
ambiguity always asks.

---

## Action: LOGIN (DM only)

Same DM-only guard, same
`BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions ... bobby-cli auth login
--profile "$SENDER_ID" --label "discord-dm-$SENDER_ID" --json` call, same
verify-via-`auth show` step as spec 14 § 3.3 — see spec 14 § 3.3 for that
command block, not restated here to avoid drift between two copies.

**One correction, checked not assumed:** spec 14 § 3.3 said the completion
message is "kept verbatim" from the live `login/SKILL.md`. That live
message (read in full during this review) includes: *"ถ้าต้องการใช้ memory
ใน guild channel ให้ admin ของ server รัน `/setup` แยกต่างหาก"* — a bare
`/setup` reference that goes stale under this spec's layering, same class
of bug § 2a fixed in `AGENTS.md`. Corrected here: that line becomes *"ให้
admin ของ server รัน `/bobby_cli setup` แยกต่างหาก"*. Everything else in
the completion message is genuinely unchanged.

---

## Action: SETUP (guild, admin-only by convention — not enforced, see above)

**Step 1 — Guard.** If not in a guild, reply:
> ❌ คำสั่งนี้ใช้ได้เฉพาะใน server ครับ

**Step 2 — Idempotency check (restored from the live `/setup` skill —
spec 14 § 3.4's rewrite dropped this; do not drop it again):**
```bash
BOBBY_CLI_PROFILES_DIR=~/.openclaw/server-sessions \
  bobby-cli auth show --profile "$GUILD_ID" --json
```
- `loggedIn:false` (or the profile file doesn't exist) → continue to Step 3.
- `loggedIn:true` → this guild already has a copied token. Ask:
  > ℹ️ Server นี้ถูก setup ไว้แล้วครับ ต้องการเปลี่ยนเป็น token ล่าสุดไหม? (ใช่ / ไม่)
  - "ไม่" → stop:
    > ✅ ยังคงใช้ token เดิมอยู่ครับ ไม่มีการเปลี่ยนแปลง
  - "ใช่" → continue to Step 3 (overwrite).

**Step 3 — Check the shared team token exists:**
```bash
bobby-cli auth show --json
```
- `loggedIn:false` → stop:
  > ❌ ยังไม่มี shared team token ครับ — กรุณาให้ผู้ดูแลระบบรัน `/setup_chawengburi` ก่อน
- `loggedIn:true` → continue to Step 4.

**Step 4 — Copy team credentials:**
```bash
cp ~/.bobby-cli/credentials.json ~/.openclaw/server-sessions/$GUILD_ID.json
```

**Step 5 — Verify:**
```bash
BOBBY_CLI_PROFILES_DIR=~/.openclaw/server-sessions \
  bobby-cli memory show --profile "$GUILD_ID" --json
```

**Completion — include the rotate-invalidation warning (new; the shared
team token uses bobby-cli's rotate-by-label default, `bobby-cli@<hostname>`
— verified `auth.ts:85,92-97` — so re-running `/setup_chawengburi` silently
invalidates every guild's copied token at once):**
> ✅ เชื่อมต่อ server กับ shared memory แล้วครับ
>
> _(หมายเหตุ: ถ้า admin รัน `/setup_chawengburi` ใหม่ในอนาคต ทุก server ที่เคย `/bobby_cli setup` ไว้ต้องรัน `/bobby_cli setup` ซ้ำอีกครั้ง เพราะ token ที่ใช้ร่วมกันจะถูก rotate)_

---

## Action: LOGOUT (DM only)

Same confirm-before-delete step, same `bobby-cli auth forget --profile
"$SENDER_ID" --json` call, same server-side-not-revoked caveat as spec 14
§ 3.5's `/logout` design — see spec 14 § 3.5 for that text, not restated
here to avoid drift between two copies.

**One correction, same class as LOGIN's above:** spec 14 § 3.5's
completion message reads *"ครั้งต่อไปต้องพิมพ์ `/login` ใหม่"* — corrected
here to *"ครั้งต่อไปต้องพิมพ์ `/bobby_cli login` ใหม่"*. The security-caveat
paragraph beneath it (server-side token not revoked) is unaffected and
stays as spec 14 wrote it.
````

---

## § 2. `setup-chawengburi` — renamed from `setup-memory`, stays separate

**Not folded into `bobby-cli`.** Rationale (owner's framing, this
conversation): this skill configures system-prompt/harness bootstrap state
(`~/.bobby-cli/.env`, `AGENTS.md`'s Identity Gate, the admin's own shared
team login) rather than a per-user or per-guild identity action — it is a
one-time host-bootstrap wizard, structurally different in both audience
(host admin, run once) and blast radius (writes env files, rewrites
`AGENTS.md`, deletes the old helper script) from the three repeatable
user-facing actions in § 1. Consolidating it into `bobby-cli` was
considered and rejected for exactly the isolation reasons spec 14 § 3.1
already used to justify keeping `setup-memory` separate from `login`/
`setup` in the first place — this spec doesn't reopen that call, just
renames the file.

`~/.openclaw/workspace/skills/setup-chawengburi/SKILL.md` — registers as
**`/setup_chawengburi`** (sanitization, § "Why this exists" above).
Content is spec 14 § 3.6, with three retargets — **not** "verbatim except
two," corrected below (the original two plus § 2a's content fix, since
Step 3 was never fully specified in spec 14 to begin with):

1. Step 4's companion-skill check (spec 14 § 3.6, "Step 4 — confirm
   companion skills exist") changes from checking three separate files to
   checking the one consolidated skill:
   ```bash
   test -f ~/.openclaw/workspace/skills/bobby-cli/SKILL.md && echo BOBBY_CLI_OK || echo BOBBY_CLI_MISSING
   ```
2. Every place spec 14 § 3.6 says "`/login`" or "`/setup`" in user-facing
   message text outside the `AGENTS.md`-writing step is retargeted to
   "`/bobby_cli login`" / "`/bobby_cli setup`".
3. Step 3's `AGENTS.md`-writing content is § 2a below, not spec 14's
   under-specified "replaced by the command table" description.

Steps 0, 1, 1b, 2, 5 and the `session-memory-call.py` deletion are
unchanged from spec 14 § 3.6 — re-read that section directly. **Step 3
(the `AGENTS.md` rewrite) is not "verbatim" — spec 14 only described it as
"replaced by the bobby-cli command table plus the self-heal rule" without
giving exact text, and the *rest* of the file (outside that one section)
was said to be "carried over unchanged."** Under this spec's layering,
"unchanged" is wrong: the live `AGENTS.md` (read in full from
`~/.openclaw/workspace/AGENTS.md` during this review, not assumed)
contains five separate user-facing references to `/login`/`/setup`/
`/setup-memory` outside the "Safe Session-Memory Helper" section spec 14
already knew it was replacing. Left as-is, the deployed bot would tell
Discord users to run commands that no longer register. § 2a below is the
exact corrected text, closing that gap.

### § 2a. Exact `AGENTS.md` content delta

Three edits to the wizard's `AGENTS.md`-writing step, against the text
currently live on this machine (`~/.openclaw/workspace/AGENTS.md`, read in
full during this review):

**1. Discord Identity Gate, items 4–5.** Current text:
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

**2. The entire "Safe Session-Memory Helper" section** (the
`session-memory-call.py` invocation block plus its `MEMORY_OK`/
`SESSION_FILE_MISSING`/etc. status table) is replaced — this is the part
spec 14 § 3.6 already flagged as changing, made concrete here:
```
## bobby-cli Command Table

For Discord memory operations, invoke bobby-cli directly — never raw
curl/urllib. Every call ends with `--json`; branch on the `code` field,
never parse `text`.

DM (personal memory):
```bash
BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions \
  bobby-cli memory <recall|list_recent|remember|append|forget> "..." \
  --profile "$SENDER_ID" --json
```

Guild (shared/public memory):
```bash
BOBBY_CLI_PROFILES_DIR=~/.openclaw/server-sessions \
  bobby-cli memory <recall|list_recent|remember|append|forget> "..." \
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

**3. The "Login And Setup Boundaries" section.** Current text:
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

Everything else in the current `AGENTS.md` (Startup Priority, Memory
Behavior, Discord Response Rules, General Safety) is unaffected by this
migration and is not reproduced here.

### § 2b. Environment portability — why `setup-chawengburi` is host-agnostic, checked not assumed

This machine's `~/.openclaw` install is a local test sandbox, not
production (production runs on Linux/Docker, a separate host and repo —
established in spec 15's audit, restated here because it's this section's
direct concern). Every path and check `setup-chawengburi` uses was
re-checked against that constraint:

- All paths are `$HOME`-relative (`~/.bobby-cli/.env`,
  `~/.bobby-cli/credentials.json`, `~/.openclaw/workspace/...`) — nothing
  hardcodes this machine's username or directory layout.
- Login is non-interactive by design (`BOBBY_CLI_EMAIL`/
  `BOBBY_CLI_PASSWORD` env vars, spec 13 § 4) specifically so it works
  headless in a container, not just in an interactive dev shell.
- Step 0 (`bobby-cli --version`) and Step 1b (the `grep -c` gate) are
  mechanical, falsifiable checks, not documentation the admin has to
  remember — this was spec 14 § 3.6's own round-2/G6 fix, inherited
  unchanged here.
- **Concretely verifiable without touching real credentials:** an
  implementer can simulate a fresh host by running the wizard's Step 0/1/1b
  checks with `HOME` pointed at an empty temp directory
  (`HOME=$(mktemp -d) bobby-cli --version`, etc.) before ever running it
  against this machine's real `~/.bobby-cli` state — this is now listed as
  its own success criterion (§ Success criteria, item 6 below) rather than
  left as an assumption.

What this spec does **not** claim to have verified: actual behavior inside
a real Docker container, or against production's real `AUTH_CENTER`/
`SESSION_MEMORY_URL`. Those require an environment this session doesn't
have access to (spec 15's own "local sandbox, not production" boundary)
and stay out of scope here, same as they were for spec 14/15.

---

## § 3. Archival: `old_skills/`

**Decided (this conversation):** archive rather than delete. Move (not
copy — `~/.openclaw/workspace/skills/` is its own git repo, confirmed
clean on `main` per spec 15's audit; use `git mv` to preserve history) the
three superseded skill directories, unmodified, into a new `old_skills/`
subfolder:

```
~/.openclaw/workspace/skills/old_skills/login/SKILL.md          (was skills/login/)
~/.openclaw/workspace/skills/old_skills/setup/SKILL.md           (was skills/setup/)
~/.openclaw/workspace/skills/old_skills/setup-memory/SKILL.md    (was skills/setup-memory/)
```

**Verified safe, not assumed:** openClaw's skill loader
(`loadSkillsFromDirSafe`/`listCandidateSkillDirs`) scans exactly one
directory level under `skills/` — root check, then one
`loadSingleSkillDirectory` pass per immediate child. `old_skills/` itself
has no `SKILL.md`, and its children (`old_skills/login/`, etc.) are a
second level down that the loader never reaches. These three directories
are therefore fully inert once moved — not discovered, not registered as
commands, not listed in `<available_skills>` for model-invocation — while
remaining on disk verbatim for reference/rollback. `forget/` is not moved
(unchanged, still active).

---

## Success criteria

Self-contained (not "re-read spec 14") because several of spec 14's
original items name commands (`/login`, `/setup`, `/setup-memory`) that do
not exist under this spec's layering — restating with corrected names
rather than risk the same drift § 2a fixed in `AGENTS.md`.

1. `~/.openclaw/workspace/skills/` contains: one user-invocable
   `bobby-cli` skill (registers `/bobby_cli`, § 1, all three actions), one
   user-invocable `setup-chawengburi` skill (registers
   `/setup_chawengburi`, § 2), the unchanged `forget` skill, and an
   `old_skills/` folder holding the three archived originals verified
   inert per § 3. No skill directory claims the `login`, `setup`, or
   `setup-memory` command names anymore.
2. `~/.openclaw/scripts/session-memory-call.py` no longer exists; no
   skill invokes raw `curl`/`urllib` against auth-center or session-memory
   (spec 14 § 3.6, unchanged).
3. **Personal memory, exercised live end to end:** a DM user runs
   `/bobby_cli login`, immediately has working personal memory through the
   `bobby-cli`-backed LOGIN action (§ 1) — not assumed from code review,
   actually executed in a real Discord DM turn.
4. **Public/shared memory, exercised live end to end, both orderings:** a
   guild admin runs `/setup_chawengburi` once, then `/bobby_cli setup` in a
   guild, and all members get shared memory — exercised live. Running
   `/bobby_cli setup` *before* `/setup_chawengburi` has ever run produces
   the explicit "รัน `/setup_chawengburi` ก่อน" message (§ 1, SETUP Step 3),
   not a raw `cp` failure. Running `/bobby_cli setup` a second time on an
   already-set-up guild triggers the confirm-before-overwrite prompt (§ 1,
   SETUP Step 2), not a silent overwrite.
5. `AGENTS.md`'s Discord Identity Gate routes every memory op through
   bobby-cli with the correct `--profile`/`BOBBY_CLI_PROFILES_DIR` for
   *both* the DM and guild paths (§ 2a's command table); grep confirms no
   remaining reference to `session-memory-call.py`, and no remaining bare
   `/login`/`/setup`/`/setup-memory` reference anywhere in the deployed
   `AGENTS.md`; a live test confirms a `code:"not_logged_in"` response
   from a memory op causes the gate to delete that profile's file (§ 2a
   item 1's self-heal fix), not just report the error.
6. **Environment portability (§ 2b), mechanically checked:**
   `setup-chawengburi`'s Step 0/1/1b are run once against a fresh, empty
   `HOME` (e.g. `HOME=$(mktemp -d)`) before ever touching this machine's
   real `~/.bobby-cli` state, confirming: `bobby-cli --version` fails
   cleanly with the documented admin message when not on `PATH`; attempting
   Step 2 (`auth login`) before both `AUTH_CENTER` and
   `SESSION_MEMORY_URL` are written to `~/.bobby-cli/.env` produces the
   `grep -c` gate's stop, not a silent proceed.
7. No `sm_live_*` token appears in any Discord-visible message or a bot
   log grep (spec 14, unchanged).
8. Migration step: before first use, every pre-existing
   `~/.openclaw/user-sessions/*.json` and `~/.openclaw/server-sessions/*.json`
   file has been deleted (spec 14 § 3.7); grep/`ls` confirms none predate
   the migration's own `/bobby_cli login`/`/bobby_cli setup` re-runs.
9. The `remember` duplicate-write debounce guidance (spec 14 § 3.9) is
   present in the deployed `AGENTS.md` text — grep for the no-retry rule;
   the `remember`-specific typing/thinking-indicator behavior (spec 14
   § 3.10) is exercised live in an actual Discord turn.
10. **New for this spec — disambiguation, exercised live:** sending
    `/bobby_cli` (or plain "bobby-cli"/"bobby cli") with no recognizable
    action, or an ambiguous message, produces the clarifying question (§ 1,
    Step 0) rather than a guess; sending a clearly-worded `login`/`setup`/
    `logout` message with no leading slash (plain-text, model-invocation
    path) is exercised live at least once per action to confirm the
    consolidated skill's weaker match signal (flagged in "Why this exists"
    above) doesn't silently fail to trigger.

## Open items before this can be audited

- Exact wording pass on the Thai messages in § 1 (owner flagged LOGIN as
  already fine in the conversation that produced this draft; SETUP's
  wording is new in this revision and hasn't been reviewed word-for-word;
  § 2a's `AGENTS.md` delta is new in this revision too).
- This spec has not been through `spec-refinement-advisor`. Given spec
  14/15's track record (NO-GO round 1 both times, several blocking
  findings each), expect at least one revision round before this reaches
  ACCEPTED.
- T10–T16 (spec 15) will need re-cutting once this spec is ACCEPTED — that
  ticket plan's file scope assumed spec 14 § 3.1's four-skill layering.
