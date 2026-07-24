# T17 — Create `bobby-cli/SKILL.md`, the single consolidated skill (login + setup + logout)

**Type:** Feature
**Priority:** Critical
**Complexity:** L (3–5 days — one file, but three full action scripts plus a
blocking pre-flight gate plus a live Discord smoke test)

**Repo:** `~/.openclaw/workspace/` (openClaw's skill workspace) — **a
separate git repo from `bobby-cli`**, confirmed clean on `main`
(`90debb4 feat: add /forget skill for magic link password reset`) at the
time this ticket was written. Not the `bobby-cli` CLI repo, not the
`chawengburi` project repo. See the tickets README's "Note on repo
boundaries" for the full list of repos this ticket set touches.

## Summary

Creates `~/.openclaw/workspace/skills/bobby-cli/SKILL.md`, a new
`user-invocable: true` skill that replaces the *separate* `login`/
`setup`/`logout` skills spec 15's retired T10–T13 plan would have produced,
with one file covering all three actions via a Step 0 intent router. This
is `bobby-cli/specs/16-spec-openclaw-consolidated-skill.md` § 1, copied
inline below so this ticket needs no other file open to implement. This
ticket also carries forward the Discord-bot-credential pre-flight gate
originally scoped to retired ticket T10 — relocated here because this is
the first ticket in the T17–T21 set whose acceptance criteria require an
actual live Discord turn (AC8 below).

## Background & Context

- Source: `bobby-cli/specs/16-spec-openclaw-consolidated-skill.md` § 1
  (ACCEPTED 2026-07-24, 3 audit rounds + 2 post-acceptance amendments).
- **Why one skill, not three** (spec 16 "Why this exists," verified against
  openClaw's actual source, not assumed):
  - **Command-name sanitization** — a skill's frontmatter `name` is
    stripped to `[a-z0-9_]` when registered as a Discord command; hyphens
    become underscores. Verified again while writing this ticket:
    `sanitizeSkillCommandName` exists at
    `/opt/homebrew/lib/node_modules/openclaw/dist/chat-commands-C_Lu521o.js:211`.
    A skill named `bobby-cli` therefore registers as **`/bobby_cli`**, not
    `/bobby-cli`. Every command reference below uses the sanitized form.
  - **Model-invocation (plain text, no `/`) is a separate, real mechanism**
    from slash-command routing — every skill is listed in an
    `<available_skills>` prompt block unless opted out, and the agent can
    load a skill from plain conversation text alone. This is *weaker* for
    a three-action skill than for three single-purpose skills, and fails
    outright in the loader's "compact" prompt fallback (drops
    descriptions, keeps only `<name>`/`<location>`). Step 0 below is the
    mitigation.
  - **Skill discovery is exactly one directory level deep** — this is why
    the archival plan (T19, separate ticket) works: an archived skill two
    levels down (`skills/old_skills/login/SKILL.md`) is structurally never
    discovered by `loadSkillsFromDirSafe`/`listCandidateSkillDirs`.
- Retired: old plan `T10` (spec 15, never implemented) covered a
  *non-invocable reference* `bobby-cli/SKILL.md` plus this same
  Discord-bot-credential pre-flight check. `T10` is formally retired (see
  `tickets/README.md`) because spec 16's `bobby-cli` skill is
  **user-invocable**, not a reference skill — a different file with a
  different purpose. The pre-flight check's *intent* (never let live
  Discord-turn testing on this sandbox host risk touching production
  Discord bot credentials) carries forward into this ticket, since this is
  where live testing first happens in the T17–T21 set.
- Retired: old plan `T11`/`T12`/`T13` (spec 15, never implemented) covered
  separate `/login` rewrite, `/setup` rewrite, and new `/logout` skills.
  Formally retired — their functional intent (the three actions
  themselves) is what this ticket implements, folded into one file, not
  three.
- The live `~/.openclaw/workspace/skills/login/SKILL.md` and `setup/
  SKILL.md` (read in full while writing this ticket, current on this
  machine) are the Python-helper-based originals this ticket's LOGIN and
  SETUP actions replace in behavior (not in file — the old files are
  archived untouched by the separate T19 ticket, not deleted or edited by
  this one).

## Discord-bot-credential pre-flight gate (blocking — do before any AC below that says "live")

This machine's `~/.openclaw` install is a local test sandbox, not
production (production runs on Linux/Docker, a separate host and repo —
spec 16 § 2b, inherited from spec 15's audit). The Discord bot token this
sandbox uses is configured at `~/.openclaw/openclaw.json` →
`channels.discord.token`, and the guilds this sandbox is bound to are
listed at the same path under `channels.discord.guilds`.

**Before running AC8 (or any other live Discord-turn check in this ticket
set), confirm — and record the confirmation, never the raw values — that:**

1. `~/.openclaw/openclaw.json`'s `channels.discord.token` is **not** the
   production bot's token. Compare against the production token/
   application ID out-of-band (the project owner holds this, not this
   repo) — do not paste either raw token into a commit, ticket, log, or
   session record. A hash comparison (e.g. `shasum` the value locally,
   compare hash strings only) or a direct side-by-side check with the
   owner is acceptable; printing the literal token to any persisted
   artifact is not.
2. The guild IDs under `channels.discord.guilds` are this machine's
   personal test server(s), not the production guild.
3. Record a one-line confirmation of both checks (e.g. "confirmed distinct
   from production, checked against owner-held production values,
   2026-0X-XX") in the session notes for whichever session executes this
   ticket's live AC — this is what makes the gate mechanically checkable
   later rather than an assumed step.

This gate is **not** re-litigated by every later ticket in this set — once
recorded here, T18/T21's own live checks may cite this ticket's
confirmation instead of repeating it, unless the sandbox's Discord bot
configuration changes in the meantime.

## Exact file content required

Create `~/.openclaw/workspace/skills/bobby-cli/SKILL.md` with exactly this
content (spec 16 § 1, verbatim):

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

**Who actually types this matters (2026-07-24 amendment 2 — corrects
amendment 1's "first word only" rule, which was itself a fix for a real
bug but wrong for the real audience).** The intended end users of this
bot are non-technical staff — e.g. housekeeping, front-desk/counter
service — not developers. They will not reliably type bare commands.
They will type full, polite, natural sentences, usually in Thai: *"อยากจะ
login ค่ะ"*, *"ขอเข้าสู่ระบบหน่อยครับ"*, *"ช่วย setup ให้หน่อยได้ไหมคะ"*.
A first-word-only rule fails every one of these (the first word is
"อยากจะ"/"ขอ"/"ช่วย", not the action word) and would make the
disambiguation question fire on the single most common real phrasing of
a perfectly clear request — worse UX than what it was fixing.

**Matching rule:** determine intent from the **whole message**, in
whatever position and grammatical wrapping the action word appears —
Thai or English, formal or casual. The table below is a set of
**illustrative anchor words**, not an exhaustive literal whitelist or a
positional rule; if the message clearly expresses one of these three
intents using different wording than the examples, that still counts as
a match. This deliberately leans on the model's own language
understanding rather than fighting it with rigid string matching —
appropriate here specifically because the executor is an LLM reading a
script, not a regex parser.

| Anchor words (illustrative, not exhaustive) | Action |
|---|---|
| "login", "เข้าสู่ระบบ", "ล็อกอิน", "เข้าระบบ" | LOGIN |
| "setup", "ตั้งค่า", "เชื่อมต่อ", "ผูก server" | SETUP |
| "logout", "ออกจากระบบ", "ล็อกเอาท์", "ลบ token" | LOGOUT |

**Credential safety is unchanged from amendment 1 and still absolute:**
whatever surrounds the action word in the message is never interpreted as
a credential, even if it looks like one (e.g. an email address typed in
the same message as "login"). LOGIN's Step 2 always asks for email/
password as its own separate follow-up turn (spec 14 § 3.3) — nothing
about broadening Step 0's matching changes that; there is still no path
by which text elsewhere in the message gets treated as, echoed as, or
logged as a password.

**Ambiguity — the case that must still ask, not guess:** a message that
gives a clear signal for exactly one of the three actions (regardless of
where in the sentence, or how it's phrased) is not ambiguous, and must
not trigger a re-ask. A message is ambiguous, and must trigger the
clarifying question below, when it (a) gives no recognizable signal for
any of the three, or (b) gives signals for **more than one** (e.g.
mentions both login and setup) with no clear indication which is the
current request — never silently pick one when the message points at two:
> ต้องการ **login** (เข้าสู่ระบบส่วนตัว), **setup** (เชื่อมต่อ server), หรือ **logout** (ออกจากระบบ) ครับ? พิมพ์คำใดคำหนึ่ง

This is the single highest-risk step in this skill — misrouting `login`
intent into the SETUP branch (or vice versa) points a Discord user's
password-derived token at the wrong shared identity. Genuine ambiguity
(no signal, or competing signals) always asks; a clearly-expressed single
intent, however phrased, must not be second-guessed back to the user.

**Structural risk this amplifies, worth stating plainly rather than
leaving implicit:** for an audience unlikely to ever type `/bobby_cli`
explicitly, the plain-text model-invocation path (see "Why this exists"
above — every skill is listed in `<available_skills>` unless opted out,
and the agent decides on its own whether to load a skill from plain
conversation) stops being a fallback and becomes the **primary** way this
skill gets triggered at all. That path was already flagged as weaker for
a consolidated multi-action skill than for single-purpose skills, and
fails outright in the loader's compact-prompt fallback mode. This spec
does not change that structural fact — it only makes Step 0 behave well
*once the skill has been loaded*. Whether the skill reliably gets loaded
in the first place from a natural Thai sentence with no slash is a
separate concern or, more precisely, one that success criterion 10 below
must be tested against realistically, not with bare keywords.

---

## Action: LOGIN (DM only)

**Step 0 — Validate: DM only.** From the conversation metadata, check
`is_group_chat`:
- `is_group_chat = false` (DM) → continue.
- `is_group_chat = true` (Guild) → stop, send:
  > ❌ `/bobby_cli login` ใช้ได้เฉพาะใน DM นะครับ — เพื่อความปลอดภัยของรหัสผ่าน
  >
  > กรุณาเปิด DM กับ bot แล้วพิมพ์ `/bobby_cli login` ที่นั่นแทนครับ

**Step 1 — Extract `SENDER_ID`** (value of `sender_id`) from conversation
metadata. Do not call any tool for this — the value is already in context.

**Step 2 — Get credentials.** Ask:
> กรุณาพิมพ์ email และ password ของคุณในรูปแบบ: `email@example.com yourpassword`
>
> _(ข้อมูลนี้จะใช้เพื่อสร้าง API token ให้คุณเท่านั้น — จะไม่ถูกบันทึกไว้)_

Wait for the reply; parse `email` and `password` from it. Never echo the
password back, never log it, never treat any other part of the
conversation (including Step 0's original message) as a credential.

**Step 3 — Authenticate:**
```bash
BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions \
BOBBY_CLI_EMAIL="<email>" BOBBY_CLI_PASSWORD="<password>" \
  bobby-cli auth login --profile "$SENDER_ID" --label "discord-dm-$SENDER_ID" --json
```
Env vars, never flags — argv is visible in the process list. On `ok:true`,
continue to Step 4. On `ok:false`, follow the returned `hint` field; if
that's not actionable, tell the user:
> ❌ Login ไม่สำเร็จครับ — กรุณาตรวจสอบ email และ password แล้วลองใหม่

**Step 4 — Verify:**
```bash
BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions \
  bobby-cli auth show --profile "$SENDER_ID" --json
```
`loggedIn:true` → proceed to Completion. `loggedIn:false` → tell the user:
> ⚠️ บันทึก session ไม่สำเร็จ — กรุณาลองใหม่

**Completion:**
> ✅ **Login สำเร็จแล้ว!**
>
> ตอนนี้ personal memory ของคุณพร้อมใช้งานใน DM นี้แล้วครับ — ครั้งต่อไปที่ DM มาฉันจะจำคุณได้ทันที
>
> ถ้าต้องการใช้ memory ใน guild channel ให้ admin ของ server รัน `/bobby_cli setup` แยกต่างหาก

Then start a new session (`{ "action": "new" }`). Do NOT use
session-memory tools after this point.

---

## Action: SETUP (guild, admin-only by convention — not enforced)

**Step 1 — Guard.** If not in a guild, reply:
> ❌ คำสั่งนี้ใช้ได้เฉพาะใน server ครับ

**Step 2 — Idempotency check:**
```bash
BOBBY_CLI_PROFILES_DIR=~/.openclaw/server-sessions \
  bobby-cli auth show --profile "$GUILD_ID" --json
```
- `loggedIn:false` (or the profile file doesn't exist) → continue to Step 3.
- `loggedIn:true` → ask:
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

**Completion:**
> ✅ เชื่อมต่อ server กับ shared memory แล้วครับ
>
> _(หมายเหตุ: ถ้า admin รัน `/setup_chawengburi` ใหม่ในอนาคต ทุก server ที่เคย `/bobby_cli setup` ไว้ต้องรัน `/bobby_cli setup` ซ้ำอีกครั้ง เพราะ token ที่ใช้ร่วมกันจะถูก rotate)_

---

## Action: LOGOUT (DM only)

**Step 0 — Validate: DM only** (same guard as LOGIN Step 0, substituting
`/bobby_cli logout` for `/bobby_cli login` in the message text).

**Step 1 — Extract `SENDER_ID`** (same as LOGIN Step 1).

**Step 2 — Confirm:**
> 🔓 ต้องการออกจากระบบ (ลบ token ที่บอทเก็บไว้) ใช่ไหมครับ? พิมพ์ **yes** เพื่อยืนยัน

**Step 3 — On "yes":**
```bash
BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions \
  bobby-cli auth forget --profile "$SENDER_ID" --json
```

**Completion (security caveat is mandatory, not optional — `bobby-cli auth
forget` only deletes the local profile file; it does not call any
server-side revoke endpoint):**
> ✅ ลบข้อมูล login ที่บอทเก็บไว้แล้วครับ ครั้งต่อไปต้องพิมพ์ `/bobby_cli login` ใหม่
>
> _(หมายเหตุ: นี่คือการลบสำเนาที่บอทเก็บไว้เท่านั้น ไม่ใช่การยกเลิก token ที่ auth-center — หากสงสัยว่า token รั่วไหลจริง ให้ติดต่อ admin เพื่อ revoke จากฝั่ง server)_
````

**One deviation from a strict copy-paste of spec 16 § 1, flagged
explicitly:** spec 16 § 1 itself says the LOGIN and LOGOUT action bodies
are "not restated" in the spec text — it points at spec 14 § 3.3 and
§ 3.5 respectively "to avoid drift between two copies," listing only the
one corrected completion-message line for each. The content above resolves
that pointer by inlining the full spec 14 § 3.3/§ 3.5 step-by-step bodies
(steps, exact bash blocks, exact Thai messages) with spec 16's corrections
already applied, so this ticket needs no other file open — this is
required by this ticket set's own self-containment rule (tickets README
§ "Implementation workflow," step 1). Verify against spec 14 § 3.3 and
§ 3.5 directly if anything here looks inconsistent; spec 16 is the
authority on the two corrected lines, spec 14 is the authority on
everything else in those two actions.

## Acceptance Criteria

1. Given `~/.openclaw/workspace/skills/bobby-cli/SKILL.md`, then it exists
   with `user-invocable: true` in frontmatter and `name: bobby-cli`.
2. Given openClaw's `sanitizeSkillCommandName`
   (`/opt/homebrew/lib/node_modules/openclaw/dist/chat-commands-C_Lu521o.js`,
   re-locate by `grep -n "function sanitizeSkillCommandName" <that dir>/*.js`
   if the exact filename has shifted), then tracing it against the literal
   string `"bobby-cli"` confirms it sanitizes to `bobby_cli` — re-verify
   mechanically, don't just trust spec 16's citation.
3. Given the file body, then Step 0 contains the exact anchor-word table
   (3 rows: LOGIN/SETUP/LOGOUT) and the ambiguity clarifying question
   verbatim as printed above.
4. Given the file body, then the LOGIN action's DM-only guard message, the
   `bobby-cli auth login` command block (with `--profile "$SENDER_ID"
   --label "discord-dm-$SENDER_ID"`), and the completion message
   (including the corrected `/bobby_cli setup` line, not a bare `/setup`)
   match the content above exactly.
5. Given the file body, then the SETUP action's Step 2 idempotency check
   (`bobby-cli auth show --profile "$GUILD_ID"`), Step 3's "shared team
   token missing" message (naming `/setup_chawengburi`, not `/setup-memory`
   or `/setup memory`), and the completion message's rotate-invalidation
   warning (naming `/setup_chawengburi` and `/bobby_cli setup`) all match
   the content above exactly.
6. Given the file body, then the LOGOUT action's confirm-before-delete
   step, the `bobby-cli auth forget --profile "$SENDER_ID"` call, and the
   completion message (including the corrected `/bobby_cli login` line and
   the unmodified server-side-not-revoked caveat paragraph) match the
   content above exactly.
7. `grep -E "(^|[^_])/login|(^|[^_])/setup([^_]|$)|(^|[^_])/logout" <file>`
   (bare, unqualified command references) returns **zero** matches — every
   command reference in the file is `/bobby_cli login`, `/bobby_cli
   setup`, `/bobby_cli logout`, or `/setup_chawengburi`.
8. **Discord-bot-credential pre-flight gate (see section above) is
   confirmed and recorded before this item runs.** Live end-to-end: in an
   actual Discord DM turn on this sandbox, send a message that triggers
   LOGIN (either `/bobby_cli login` or a plain-text phrase matching Step
   0's LOGIN anchor words), complete Steps 2–4 with real (test-account)
   credentials, and confirm: the completion message is sent, and
   `BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions bobby-cli auth show
   --profile "<that SENDER_ID>" --json` reports `loggedIn:true`
   immediately after.
9. Given the skill directory, then it contains exactly one file,
   `SKILL.md` — no other files under `~/.openclaw/workspace/skills/bobby-cli/`.

## Dependencies

None — this is the first ticket in the T17–T21 set. Its pre-flight gate
confirmation (see section above) may be cited, not re-run, by T18 and T21
as long as the sandbox's Discord bot configuration hasn't changed since.

## Out of Scope

- `setup-chawengburi/SKILL.md` and the `AGENTS.md` rewrite — T18.
- Archiving `login/`, `setup/`, `setup-memory/` into `old_skills/` — T19
  (must land *after* this ticket, since archiving the old skills before
  their replacement exists would leave a gap where no login/setup/logout
  path works at all).
- Deleting pre-existing `~/.openclaw/user-sessions/*.json` /
  `server-sessions/*.json` files — T20.
- Full live exercise of all 10 of spec 16's success criteria (disambiguation
  edge cases, both setup orderings, realistic full-Thai-sentence
  model-invocation tests, environment portability) — T21. This ticket's
  AC8 is a minimal LOGIN smoke test only, not the full protocol.
- Real admin-role enforcement on SETUP — spec 16 explicitly decided
  against adding this (§ "Explicitly decided against, this conversation").
- Any change to `/forget` (openClaw's password-reset flow) — spec 16 § 3.5
  inheritance: out of scope, unrelated to bobby-cli.
- Any change to `bobby-cli`'s own source code (the CLI repo) — this ticket
  only creates a skill file in the openClaw workspace repo.
