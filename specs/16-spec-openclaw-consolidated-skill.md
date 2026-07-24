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
  `setup-chawengburi`** (registers as `/setup_chawengburi`) and its Step 4
  companion-skill check retargeted to the new single-skill layout.
- New: § 3 archival plan for `login/`, `setup/`, `setup-memory/`'s
  original files (`old_skills/`).

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

```markdown
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

Unchanged from spec 14 § 3.3 — same DM-only guard, same
`BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions ... bobby-cli auth login
--profile "$SENDER_ID" --label "discord-dm-$SENDER_ID" --json` call, same
verify-via-`auth show` step, same completion messages. See spec 14 § 3.3
for the exact command block — reproduced verbatim, not restated here to
avoid drift between two copies.

---

## Action: SETUP (guild, admin-only by convention — not enforced, see
above)

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
cp ~/.bobby-cli/credentials.json ~/.openclaw/server-sessions/<guildId>.json
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

Unchanged from spec 14 § 3.5's `/logout` design — same confirm-before-delete
step, same `bobby-cli auth forget --profile "$SENDER_ID" --json` call, same
server-side-not-revoked caveat in the completion message. See spec 14 § 3.5
for the exact text — reproduced verbatim, not restated here.
```

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
Content is spec 14 § 3.6 **verbatim**, with exactly two retargets:

1. Step 4's companion-skill check (spec 14 § 3.6, "Step 4 — confirm
   companion skills exist") changes from checking three separate files to
   checking the one consolidated skill:
   ```bash
   test -f ~/.openclaw/workspace/skills/bobby-cli/SKILL.md && echo BOBBY_CLI_OK || echo BOBBY_CLI_MISSING
   ```
2. Every place spec 14 § 3.6 says "`/login`" or "`/setup`" in user-facing
   message text is retargeted to "`/bobby_cli login`" / "`/bobby_cli
   setup`".

Nothing else in spec 14 § 3.6 (Steps 0, 1, 1b, 2, 3, 5; the
`session-memory-call.py` deletion; the `AGENTS.md` rewrite content) changes
— re-read spec 14 § 3.6 directly for that content rather than duplicating
it here, per the same drift-avoidance reasoning as § 1 above.

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

## Success criteria (adapted from spec 14, item 1 only — items 2–9 unchanged, re-read spec 14 directly)

1. `~/.openclaw/workspace/skills/` contains: one user-invocable
   `bobby-cli` skill (registers `/bobby_cli`, § 1, all three actions), one
   user-invocable `setup-chawengburi` skill (registers
   `/setup_chawengburi`, § 2), the unchanged `forget` skill, and an
   `old_skills/` folder holding the three archived originals verified
   inert per § 3. No skill directory claims the `login`, `setup`, or
   `setup-memory` command names anymore.

## Open items before this can be audited

- Exact wording pass on the Thai messages above (owner flagged LOGIN as
  already fine in the conversation that produced this draft; SETUP's
  wording above is new in this revision and hasn't been reviewed yet).
- This spec has not been through `spec-refinement-advisor`. Given spec
  14/15's track record (NO-GO round 1 both times, several blocking
  findings each), expect at least one revision round before this reaches
  ACCEPTED.
- T10–T16 (spec 15) will need re-cutting once this spec is ACCEPTED — that
  ticket plan's file scope assumed spec 14 § 3.1's four-skill layering.
