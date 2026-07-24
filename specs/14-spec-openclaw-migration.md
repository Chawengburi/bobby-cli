# 14 Spec: openClaw Migration — bobby-cli replaces three of four ad-hoc skills' transport (`forget` unchanged)

> **Title corrected round 2/G5:** the original title ("one bobby-cli skill
> replaces four ad-hoc skills") described the pre-§3.1-fix design. The
> shipped design is two-layered — a non-invocable `bobby-cli` reference
> skill plus four Discord-facing invocable skills (`login`, `setup`,
> `logout` new, `forget` unchanged) — so it is not "one skill" and it does
> not "replace" `forget`. What's actually replaced is the hand-rolled
> curl/Python *transport* underneath `login`/`setup`, plus `setup-memory`'s
> helper script.

> **Status: ACCEPTED (2026-07-20) — 3 audit rounds complete, round 3
> GO.** Written 2026-07-20, after T01–T09 (specs 12+13) landed and closed
> clean; all 5 open questions resolved the same day at the owner's
> request (see § Decisions). Three independent fresh-eyes
> `spec-refinement-advisor` audit rounds, matching this project's
> established ritual for specs 12/13:
>
> - **Round 1** (cold-read): NO-GO — 6 blocking (F1–F6) + 5 minor
>   (F7–F11), all fixed (see "(fixes Fn)" markers throughout §§ 3.1–3.8, §
>   Decisions item 5, § Success criteria).
> - **Round 2** (verifying round 1's fixes actually held): NO-GO — 3
>   blocking (G1–G3) + 4 minor (G4–G7). Mostly fixes from round 1 that
>   didn't fully propagate to a cross-referencing section (§ 3.4's
>   ordering gate branched on a field `auth show` never returns; Decision
>   1 kept a stale profile name that would have made `/logout` a no-op;
>   this spec's own F-numbered findings collided with the unrelated
>   2026-07-14 trial findings sharing the same F1/F2/F3/F7/F8 labels —
>   renamed those to a `T`-prefix). All fixed (see "(round 2/Gn)" markers).
> - **Round 3** (final holistic re-check): **GO** — 0 blocking, 3 minor
>   polish items (H1–H3: a findings-traceability gap, a `T`-numbering
>   adjacency with unrelated ticket IDs, imprecise title wording), all
>   fixed.
>
> Ticket-writeable.

> Decision context: spec 13 § 4 "openClaw consolidation (decided
> 2026-07-18)" already commits to collapsing openClaw's separate
> `login`/`forget`-adjacent skills into the one bobby-cli skill, every
> command carrying `--profile discord-<userId>`, and non-interactive
> `/login` via `BOBBY_CLI_EMAIL`/`BOBBY_CLI_PASSWORD` env vars (never flags).
> This spec is the "migration itself" that 13 §4 explicitly deferred, plus
> the friction findings T1/T2/T3/T7/T8 from the 2026-07-14 trial (renamed
> with a `T`- prefix in this revision, round 2/G3, to stop colliding with
> this spec's own round-1 audit findings F1–F11, which are a separate
> numbering space — same letter, unrelated lists)
> (`docs/sessions/SESSION-2026-07-14.md`) that the same session's handoff
> said to fold in here.

Builds on:
[10-spec-credential-profiles.md](./10-spec-credential-profiles.md) (`--profile`,
built expressly for this migration),
[11-spec-claude-code-skill.md](./11-spec-claude-code-skill.md) (the dress
rehearsal this migration follows),
[12-spec-agent-legible-output.md](./12-spec-agent-legible-output.md) (`code`/
`hint` — what lets the Discord Identity Gate branch on structured fields
instead of parsing helper-script status strings),
[13-spec-skill-architecture.md](./13-spec-skill-architecture.md) § 4 (the
consolidation decision), [session-memory/specs/09-spec-discord-actor.md](../../session-memory/specs/09-spec-discord-actor.md)
(the static-MCP-token/race-condition history bobby-cli exists to avoid).

## Current state (read from the live openClaw install, not assumed)

`~/.openclaw/workspace/skills/` today has four separate skills, none of
which shell out to bobby-cli:

| Skill | Does | Session file |
|---|---|---|
| `login` (DM, user-invocable) | Prompts for email+password in DM, hand-rolled `curl` via inline Python: `POST /auth/token` then `POST /auth/tokens` (scopes hardcoded `memory:read/write/delete`), writes result | `~/.openclaw/user-sessions/{senderId}.json` — `{discordUserId, userId, email, apiToken, tokenLabel, createdAt}` |
| `forget` (DM, user-invocable) | **Not** a credential-forget — it's a *forgot-password* flow: confirms, then `POST /auth/users/forgot-password` to email a reset link | none (no file touched) |
| `setup` (guild, admin-only) | Copies the already-configured machine `AI_TOKEN` from `~/.openclaw/.env` into a per-guild session file (shared-team-token model — every guild that runs `/setup` gets the *same* underlying token) | `~/.openclaw/server-sessions/{guildId}.json` |
| `setup-memory` (admin bootstrap) | Writes `AI_TOKEN`/`SESSION_MEMORY_URL`/`AUTH_CENTER` to `~/.openclaw/.env`, installs a hand-written Python helper (`~/.openclaw/scripts/session-memory-call.py`, raw `urllib` JSON-RPC POST) and a compact `AGENTS.md` "Discord Identity Gate" policy that routes every Discord memory op through that helper | `~/.openclaw/.env`, `~/.openclaw/scripts/session-memory-call.py` |

This predates bobby-cli's `--profile` (spec 10) and `code`/`hint` envelope
(spec 12) — it independently solved the same two problems (per-Discord-user
identity, legible outcomes) with hand-written Python that neither ships
`code` values nor gets the benefit of spec 12's classifier fixes.

CLAUDE.md's existing note — *"openClaw memory: ใช้ bash + curl แทน MCP เพราะ
openClaw redacts `sm_live_*` tokens ออกจาก MCP context"* — is why the helper
shells out at all instead of using an MCP client; that constraint is
unchanged by this migration, only *what* gets shelled out to changes (from
a hand-rolled Python/curl helper to bobby-cli).

## Friction findings from the 2026-07-14 trial this spec must address

(`docs/sessions/SESSION-2026-07-14.md` — bobby-cli used against the
Claude-Code skill, but every finding below applies at least as much to
openClaw's shared-process, many-concurrent-Discord-users deployment shape.)

- **T1 — duplicate-detection consistency window.** Vectorize lags inserts by
  seconds; two `remember`s fired back-to-back both land, unblocked. A
  Discord user double-tapping Send (or an LLM retrying a slow tool call)
  reproduces this. bobby-cli has no idempotency key — this must be a
  skill-level rule (§ 3.9 below), not something this migration can fix in
  the CLI.
- **T2 — domain failures inside `ok:true`.** Superseded for new callers:
  spec 12's classifier now puts `not_found`/`duplicate_candidate`/etc. in
  `code`, so this migration's skill can branch on `code` and never needs
  the old "always parse `text`" workaround the Python helper's status
  strings existed for.
- **T3 — ~3s cold start, once per session.** Discord has its own response
  latency expectations; § 3.10 below.
- **T7 — bare `AUTH_CENTER` env var silently wins over stored config.**
  `~/.openclaw/.env` and a shell-exported `AUTH_CENTER` both use the same
  unnamespaced variable bobby-cli also reads — whichever the openClaw host
  process has exported at boot wins over per-profile stored URLs. § 3.8.
- **T8 — first login of a new profile falls back to *production*.**
  `config.ts`'s `DEFAULT_AUTH_CENTER_URL`/`DEFAULT_SESSION_MEMORY_URL` are
  the real production deployment; a profile with no prior credentials and
  no env override silently authenticates against production. On a
  multi-Discord-user host this is worse than the single-dev-machine case
  the finding was originally filed against — a mis-bootstrapped host would
  send real user passwords to production on every first `/login`. § 3.8.

## Scope

**In scope:** replacing `login` and `setup`'s transport (bobby-cli instead
of hand-rolled curl/Python, § 3.3/3.4), adding a new `logout` skill for
the credential-cleanup case `/forget` doesn't cover (§ 3.5), and replacing
`setup-memory`'s helper-script + Discord-Identity-Gate routing with
bobby-cli (§ 3.6); the profile-naming/directory convention (§ 3.2); the
one-time re-authentication of existing Discord users including deleting
their stale legacy session files up front (no format converter, § 3.7);
the mechanical `AUTH_CENTER`/first-login safety gate the findings above
call for (§ 3.6 Step 1b, § 3.8).

**Out of scope (per spec 13 §4 and this project's standing rules):**
device-code login (D4, still deferred — non-interactive
`BOBBY_CLI_EMAIL`/`BOBBY_CLI_PASSWORD` is what ships here, exactly as spec
13 already decided); any production deploy (manual-only,
`PRODUCTION-UPDATES.md`); building a session-file-format converter (§ 3.7
explains why); adding scope-selection to `bobby-cli auth login` (it already
hardcodes the exact three memory scopes openClaw's old login skill
requested by hand — nothing to change).

## Design

### 3.1 Two layers: one non-invocable command-reference skill, plus thin invocable command skills (fixes F1)

**F1 correction:** the earlier draft said the four old skills are "folded
into" one `bobby-cli` skill and separately claimed `login`/`setup` are
"removed," without saying what a Discord user types afterward. In
openClaw, `user-invocable: true` + an emoji is what makes a skill a slash
command — collapsing `/login` and `/setup` into a single non-invocable
skill would delete those slash commands with nothing replacing them. That
is not the intent; corrected design:

```
~/.openclaw/workspace/skills/bobby-cli/SKILL.md   # NOT user-invocable — command reference only
~/.openclaw/workspace/skills/login/SKILL.md       # user-invocable, /login  — thin, calls into bobby-cli
~/.openclaw/workspace/skills/setup/SKILL.md        # user-invocable, /setup  — thin, calls into bobby-cli
~/.openclaw/workspace/skills/logout/SKILL.md       # user-invocable, /logout — new (§ 3.5), thin
~/.openclaw/workspace/skills/forget/SKILL.md       # user-invocable, /forget — UNCHANGED (§ 3.5, Decision 1)
```

- `bobby-cli/SKILL.md` is the shared base + Discord appendix from the
  earlier draft (still correct per Decision 4): the command tables,
  `--profile`/`BOBBY_CLI_PROFILES_DIR` shape, and Discord Identity Gate
  rules live here, but it carries no `user-invocable` frontmatter — nothing
  triggers it directly by name. It exists so `login`/`setup`/`logout`'s
  own bodies can stay a few lines each ("extract the Discord ID per Step 1
  below, then run the command from the bobby-cli skill's table") instead
  of duplicating the command shape three times.
- `login`, `setup`, `logout` keep the **same structural shape** the old
  skills already have and that this migration must not regress: a Step 0
  DM-only/guild-only guard, Step 1 metadata extraction, a body step that
  now shells to bobby-cli instead of hand-rolled Python, and the same
  Thai completion/error messages as today (only the mechanism underneath
  changes — see §§ 3.3–3.5 for each skill's exact new body).
- `setup-memory` is retired as a user-invocable skill in the sense that its
  wizard steps move under an admin-only path (§ 3.6) — still needed, not
  deleted, just reduced in scope now that bobby-cli owns the transport.

Only the *old transport* (`session-memory-call.py`, inline `curl`/Python)
is retired — never left running alongside the bobby-cli-backed versions
(stale hand-rolled token minting next to bobby-cli-backed minting would
reintroduce exactly the two-tokens-per-user confusion spec 10 exists to
prevent).

### 3.2 Per-Discord-user identity via `--profile` + `BOBBY_CLI_PROFILES_DIR` (fixes F4)

**F4 correction:** the earlier draft invented a `discord-dm-`/`discord-guild-`
prefix scheme under bobby-cli's *default* profiles directory
(`~/.bobby-cli/profiles/`), which conflicts with spec 10's own "Concrete
usage: replacing the openClaw helper scripts" section — that section
already specifies `BOBBY_CLI_PROFILES_DIR` pointed at openClaw's
**existing** directories with **bare** Discord IDs as the profile name,
since the directory itself already disambiguates DM from guild. This spec
adopts spec 10's scheme as-is rather than inventing a second, incompatible
one:

| Context | `BOBBY_CLI_PROFILES_DIR` | `--profile` | Example |
|---|---|---|---|
| DM (personal) | `~/.openclaw/user-sessions` | `<senderId>` (bare) | `BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions bobby-cli memory <op> --profile "$SENDER_ID" --json` |
| Guild (shared team) | `~/.openclaw/server-sessions` | `<guildId>` (bare) | `BOBBY_CLI_PROFILES_DIR=~/.openclaw/server-sessions bobby-cli memory <op> --profile "$GUILD_ID" --json` |

Concretely, resolved file paths are `~/.openclaw/user-sessions/<senderId>.json`
and `~/.openclaw/server-sessions/<guildId>.json` — **the exact paths the old
skills already write today.** This is not a coincidence, it's the point:
existing directories are reused unchanged, so § 3.7's "no converter, just
re-login" plan needs no file move or directory rename either — a fresh
`bobby-cli auth login` just overwrites the legacy ad hoc JSON at the same
path with a proper `Credentials`-shaped file.

`<senderId>`/`<guildId>` are Discord snowflakes (`^[0-9]+$`), which already
satisfy spec 10's `^[a-zA-Z0-9_-]+$` profile-name validation — no
transformation needed before passing them as `--profile`.

**Inherited caveat, not introduced here (round 2/G7):** `BOBBY_CLI_PROFILES_DIR`
is read as a plain string (`config.ts:50`, `join(process.env.BOBBY_CLI_PROFILES_DIR,
...)`) — Node never expands `~`. Every example above relies on the
*shell* expanding the unquoted `~` at the point the env var is assigned.
Any implementation that builds this value programmatically (rather than
literally writing `BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions` in a
shell command) must expand `$HOME` itself first — a literal `~` directory
would silently diverge from the path the Identity Gate's `rm` (§ 3.6)
targets, since that uses ordinary shell tilde expansion too.

The Discord Identity Gate (currently in openClaw's `AGENTS.md`, written
2026-06-12 for the Python helper) is rewritten to extract `SENDER_ID`/
`GUILD_ID` from turn metadata exactly as today, but the "call the helper"
step becomes "call bobby-cli with the matching `BOBBY_CLI_PROFILES_DIR`
and `--profile`" — the gate's *rules* (never guess IDs from message text,
DM personal memory requires an existing profile, guild memory requires
admin setup, never substitute a DM token for guild memory) are unchanged,
only the transport underneath. § 3.6 adds one new rule: on a
`not_logged_in` code from any memory op (spec 12's classifier — covers
both "no local credentials" and "session-memory rejected the token," e.g.
after revocation), the gate deletes that profile file itself before
telling the user to `/login`/`/setup` again, replicating the old Python
helper's self-heal behavior (see F8 fix in § 3.6).

### 3.3 `/login` (DM), thin user-invocable skill, rewritten body

Stays `user-invocable: true` with its existing Step 0 (DM-only guard,
unchanged text) and Step 1 (extract `SENDER_ID`, unchanged). Steps 2–4
(get credentials → mint token → verify) collapse into one CLI call plus
one verify call:

```bash
BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions \
BOBBY_CLI_EMAIL="<email>" BOBBY_CLI_PASSWORD="<password>" \
  bobby-cli auth login --profile "$SENDER_ID" --label "discord-dm-$SENDER_ID" --json
```

- Env vars, never flags — argv is visible in the process list (spec 13
  §4, restated here since it's the exact mechanism this skill uses).
- `--profile` is the bare snowflake (§ 3.2's F4 fix); `--label` keeps a
  human-legible `discord-dm-<id>` string for `auth-center`'s own token
  listing (`GET /auth/tokens`), where a bare numeric label would be
  confusing to a human admin reading that list — the two serve different
  audiences (`--profile` is a filename bobby-cli resolves, `--label` is
  what shows up when a person looks at issued tokens).
- `bobby-cli auth login` already requests `["memory:read", "memory:write",
  "memory:delete"]` (hardcoded in `authClient.ts`) — identical to what the
  old skill asked for by hand. No CLI change needed.
- `--label discord-dm-<senderId>` makes re-running `/login` **rotate**
  that Discord user's token instead of minting a second one (spec 04's
  rotate-by-label behavior, already shipped) — the old skill always minted
  fresh, leaking one abandoned token per re-login.
- On success, branch on `code` (`ok:true`) — no more `OK`/`LOGIN_FAILED`/
  `TOKEN_FAILED` string matching. On failure, follow `hint` (spec 12) — no
  new per-error prose needed in the skill. The existing Thai
  success/failure messages (Completion section, "❌ Login ไม่สำเร็จครับ",
  etc.) are kept verbatim; only what decides which message fires changes
  (`code` instead of a status string).
- The "verify session file exists" step (old Step 4) becomes
  `BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions bobby-cli auth show
  --profile "$SENDER_ID" --json` — reuses an existing command instead of a
  bespoke Python existence check.

### 3.4 `/setup` (guild), thin user-invocable skill, rewritten body

The old skill's semantics — every guild that runs `/setup` shares the
**same underlying team token**, just materialized into its own session
file — has no bobby-cli command that does "clone an existing profile," and
adding one would be new CLI scope for a one-line file copy. Keep this step
as a plain file copy (confirmed safe: `Credentials` — `src/core/config.ts`
— binds nothing to a profile name, machine, or path at write time; memory
ops only ever read `apiToken`+`sessionMemoryUrl` off whatever file
resolves, so a raw copy is behaviorally identical to a fresh login with
the same token), now copying a bobby-cli-shaped credentials file instead
of hand-assembling one:

```bash
cp ~/.bobby-cli/credentials.json \
   ~/.openclaw/server-sessions/<guildId>.json
```

**F3 correction — explicit ordering, not assumed:** this `cp` source only
exists once the admin has completed `/setup-memory`'s bootstrap (§ 3.6),
which runs a plain `bobby-cli auth login` with **no** `--profile` (the
shared team identity lives at bobby-cli's own default path,
`~/.bobby-cli/credentials.json` — same default every human/coding-agent
caller already uses, deliberately not a Discord-shaped profile since the
team token isn't tied to any one Discord entity). Step 3 of the rewritten
`/setup` (replacing today's "read machine token from `.env`" step) becomes:

```bash
bobby-cli auth show --json
```

**Round-2 correction (G1):** the first fix branched on `ok:false`/
`code:"not_logged_in"`, but `runShow` (`src/commands/auth.ts:137-165`,
checked directly, not assumed) **always** returns `ok:true` — the
not-logged-in case is `{ ok:true, code:"status", loggedIn:false, hint:
"Run 'bobby-cli auth login'..." }`, not an `ok:false` envelope (`ok:false`
from `auth show` only happens for an invalid `--profile` name, which
cannot occur here since no `--profile` is passed). The correct branch:

- `loggedIn:true` → continue to the `cp` above.
- `loggedIn:false` → **stop** and tell the admin:
  > ❌ ยังไม่มี shared team token ครับ — กรุณาให้ผู้ดูแลระบบรัน `/setup-memory` ก่อน

  This is the exact ordering gap the first draft left unstated: a guild
  admin running `/setup` on a freshly migrated host, before anyone has run
  `/setup-memory`, now gets a clear stop instead of a `cp: No such file`
  failure with no recovery instruction.
- The verify step becomes `bobby-cli memory show --profile "$GUILD_ID"
  --json` (§ 3.2's `BOBBY_CLI_PROFILES_DIR=~/.openclaw/server-sessions`) in
  place of the raw `curl -o /dev/null` check.

**Accepted operational note (was F7, non-blocking):** because every guild's
copy holds the *same raw token value*, re-running the shared team's
default-path `bobby-cli auth login` (§ 3.6, Decision 3) **rotates that
token by label** (spec 04 — the default label `bobby-cli@<hostname>`
matches across runs on the same host) and invalidates every
previously-copied guild file at once — identical coupling to today's
shared-`AI_TOKEN` model, not a new regression. `/setup-memory`'s
completion message (§ 3.6) explicitly tells the admin that rotating the
team login means every guild must re-run `/setup` to re-copy the new
token.

### 3.5 `/forget` — naming collision, resolved (Decision 1); `/logout` fully specified (fixes F2)

openClaw's `/forget` and bobby-cli's `auth forget` do **unrelated** things:
the former emails a password-reset link (`POST
/auth/users/forgot-password`, no bobby-cli equivalent exists or is proposed
here); the latter deletes a local credentials file. Spec 13 §4 said
"forget/credential-reset... collapsed into the one bobby-cli skill," which
reads as if it were one concept — it is not, once the actual openClaw code
is read. **Decided** (§ Decisions, item 1):

- Keep `/forget` exactly as-is (openClaw-only HTTP call, not migrated —
  there is nothing for bobby-cli to do here since it never touches
  passwords), and
- Add a **new**, thin user-invocable `/logout` DM skill (`login/logout`
  sibling — same file layout as `login/SKILL.md`) for credential cleanup.

**`/logout` full spec (F2 correction — the first draft only named this
command, it did not specify it):**

- Frontmatter: `user-invocable: true`, DM-only (same Step 0 guard/message
  shape as `/login`, substituting `/logout`).
- Step 1: extract `SENDER_ID` (same as `/login`).
- Step 2 — confirm (same pattern as `/forget`'s Step 2):
  > 🔓 ต้องการออกจากระบบ (ลบ token ที่บอทเก็บไว้) ใช่ไหมครับ? พิมพ์ **yes** เพื่อยืนยัน
- Step 3, on "yes":
  ```bash
  BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions \
    bobby-cli auth forget --profile "$SENDER_ID" --json
  ```
- **Security-relevant caveat that must be in the completion message, not
  omitted:** `bobby-cli auth forget` only deletes the local profile file —
  confirmed by reading `runForget` (`src/commands/auth.ts`), which does
  not call any server-side revoke endpoint (spec 07's roadmap item
  "Server-side revoke on `auth forget`" is explicitly deferred, tracked
  against `auth-center/tickets/03-personal-api-token.md`). A command named
  "logout" that leaves the underlying `sm_live_*` token live server-side
  would surprise a security-conscious user if left unstated. Completion
  message must say so plainly:
  > ✅ ลบข้อมูล login ที่บอทเก็บไว้แล้วครับ ครั้งต่อไปต้องพิมพ์ `/login` ใหม่
  >
  > _(หมายเหตุ: นี่คือการลบสำเนาที่บอทเก็บไว้เท่านั้น ไม่ใช่การยกเลิก token ที่ auth-center — หากสงสัยว่า token รั่วไหลจริง ให้ติดต่อ admin เพื่อ revoke จากฝั่ง server)_

### 3.6 `/setup-memory` rewritten — drop the Python helper, restore what it did (fixes F5, F6, F8, F9, F10)

**F9 correction:** the first draft's three bullets undersold how much of
the old 6-step wizard was being silently dropped (guided env save-flows,
who writes `AGENTS.md`, the companion-skill check). Rewritten step by
step, keeping the old wizard's shape and folding in the F5/F6/F10 fixes:

- **Step 0 (new, fixes F10) — bobby-cli present on this host:**
  ```bash
  bobby-cli --version
  ```
  Missing/not on `PATH` → tell the admin to `npm install -g @babyferret/bobby-cli`
  first and stop. Every later step assumes this succeeded.

- **Step 1 (kept, retargeted — fixes F5) — guided save-flow for
  `AUTH_CENTER`/`SESSION_MEMORY_URL`.** The old flow wrote these into
  `~/.openclaw/.env`, a file bobby-cli **never reads** — confirmed in
  `src/index.ts`, which only loads the cwd `.env` and
  `~/.bobby-cli/.env`. Writing to `~/.openclaw/.env` would silently do
  nothing for bobby-cli. The save-flow steps are kept (same guided
  prompt/parse shape as today), retargeted to write
  **`~/.bobby-cli/.env`** instead:
  ```
  AUTH_CENTER=<url>
  SESSION_MEMORY_URL=<url>
  ```
  (`AI_TOKEN` is dropped from this file entirely — bobby-cli mints and
  stores its own token via `auth login` in Step 2, it never reads a
  pre-existing machine token the way the old helper did.)

- **Step 1b (new, fixes F6 — corrects Decision 5's original wording) —
  mechanical refusal, not a "default."** `config.ts`'s built-in fallback
  (`DEFAULT_AUTH_CENTER_URL`/`DEFAULT_SESSION_MEMORY_URL`) is the real
  **production** deployment — there is no built-in test default to fall
  back to (Decision 5 below is corrected accordingly). Before Step 2 runs,
  re-read `~/.bobby-cli/.env` back and confirm both URLs are actually
  present:
  ```bash
  grep -c '^AUTH_CENTER=' ~/.bobby-cli/.env
  grep -c '^SESSION_MEMORY_URL=' ~/.bobby-cli/.env
  ```
  Either count is `0` → **stop**, do not run Step 2, and re-prompt Step 1
  (round 2/G6: this is a check the wizard script must read and act on, not
  a guarantee the shell enforces on its own — "mechanical" here means
  "falsifiable by running a command," not "impossible to skip"; an
  implementer must wire the stop into the wizard's control flow). If
  `~/.bobby-cli/.env` doesn't exist yet (Step 1 skipped entirely), `grep`
  exits non-zero with no count printed — treat that identically to a `0`
  count, not as a different case. This makes "never silently touch
  production" a checkable gate in the wizard, not a documentation-only
  instruction the admin has to remember.

- **Step 2 — admin bootstrap login:**
  ```bash
  BOBBY_CLI_EMAIL="<email>" BOBBY_CLI_PASSWORD="<password>" \
    bobby-cli auth login --json
  ```
  No `--profile` — the shared team identity is bobby-cli's own default
  path (`~/.bobby-cli/credentials.json`), the same one `/setup` (§ 3.4)
  reads via `cp`. Only reachable after Step 1b's gate passes.

- **`~/.openclaw/scripts/session-memory-call.py`** (the ~180-line
  hand-written JSON-RPC/SSE-parsing helper) is deleted. bobby-cli covers
  its transport responsibilities (JSON-RPC framing, SSE-vs-JSON response
  parsing, `sm_live_*` redaction) and additionally gives structured
  `code`/`hint` the helper's plain status strings never had. **F8
  correction — one behavior it does *not* cover, and this must be made up
  at the skill level:** the helper self-healed on an expired/revoked token
  by deleting the session file on HTTP 401 (`SESSION_EXPIRED` →
  `unlink()`); a bare `bobby-cli memory <op>` does not delete anything on
  failure. The rewritten `AGENTS.md` Identity Gate (next bullet) adds this
  rule explicitly: on `code: "not_logged_in"` from any memory op, delete
  that profile's file (`~/.openclaw/user-sessions/<senderId>.json` or the
  guild equivalent) before telling the user/admin to `/login`/`/setup`
  again.

- **Step 3 (kept — fixes F9's "who writes AGENTS.md" gap) — install the
  rewritten `AGENTS.md`.** `/setup-memory` still programmatically writes
  `~/.openclaw/workspace/AGENTS.md` (same backup-before-overwrite
  behavior as today), with the "Safe Session-Memory Helper" section
  replaced by the bobby-cli command table (§ 3.1/3.2) plus the
  self-heal-on-`not_logged_in` rule above; the rest of the Identity Gate
  prose (never guess IDs, DM/guild boundaries, never substitute tokens)
  is carried over unchanged.

- **Step 4 (kept, retargeted — fixes F9's dropped companion check) —
  confirm companion skills exist:**
  ```bash
  test -f ~/.openclaw/workspace/skills/login/SKILL.md && echo LOGIN_OK || echo LOGIN_MISSING
  test -f ~/.openclaw/workspace/skills/setup/SKILL.md && echo SETUP_OK || echo SETUP_MISSING
  test -f ~/.openclaw/workspace/skills/logout/SKILL.md && echo LOGOUT_OK || echo LOGOUT_MISSING
  ```
  (Updated from the old check, which only looked for `login`/`setup`, to
  also confirm the new `/logout` skill from § 3.5 is installed.)

- **Step 5 — smoke test:**
  ```bash
  bobby-cli memory show --json
  ```
  (No `--profile` — same default-path team identity as Step 2.) Drops the
  old temporary `__setup_memory_smoke__` session-file dance, which existed
  only because the old helper had no concept of a default/unscoped call.

### 3.7 Existing session files are not converted — one-time re-login (Decision 2)

`~/.openclaw/user-sessions/*.json` (`{discordUserId, userId, email,
apiToken, tokenLabel, createdAt}`) and `~/.openclaw/server-sessions/*.json`
do not match bobby-cli's `Credentials` shape
(`authCenterUrl`/`sessionMemoryUrl`/`email`/`tenantId`/`apiToken`/
`apiTokenId`/`apiTokenLabel`/`scopes`/`createdAt`/`expiresAt` —
`src/core/config.ts:24`). Writing a one-time converter is possible but adds
a migration script to maintain for what is, at this project's current
scale (dev/trial stage, not yet a production Discord deployment per
`PRODUCTION-UPDATES.md`), a small number of existing sessions. **Decided**
(§ Decisions, item 2): require each existing DM/guild user to run
`/login`/`/setup` once after the migration ships — no converter script.

Because § 3.2 (F4 fix) points `BOBBY_CLI_PROFILES_DIR` at these exact same
existing directories, "re-login" needs **no directory move**: a fresh
`bobby-cli auth login --profile "$SENDER_ID"` (or the guild `cp`) simply
overwrites the legacy ad hoc JSON in place with a proper
`Credentials`-shaped file.

**One real gap, checked against the actual code, not assumed:**
`loadCredentials()` (`src/core/config.ts:58-65`) is `JSON.parse(...) as
Credentials` — a type-cast, not runtime shape validation — and returns
`null` only on a missing file or invalid JSON *syntax*. A legacy session
file (`{discordUserId, userId, email, apiToken, tokenLabel, createdAt}`)
is syntactically valid JSON, so it parses "successfully" into an object
missing `sessionMemoryUrl`/`authCenterUrl`/etc. as `undefined` — this does
**not** cleanly produce a `not_logged_in` code the way a missing file
would; it more likely surfaces as a raw fetch/network error against
`undefined` as a URL, which is a worse failure mode than the one this
migration is trying to fix. **Required migration step, not optional
cleanup:** before this migration ships, delete every existing
`~/.openclaw/user-sessions/*.json` and `~/.openclaw/server-sessions/*.json`
file up front (a one-line `rm`, run once during the migration itself, not
left to "eventually get overwritten") so every Discord user's first
post-migration call sees a genuinely missing file and the correct
`not_logged_in` → "`/login` again" path, instead of a legacy file limping
through a partial read. Revisit the "no converter" call in Decision 2 if a
real production Discord user base exists by the time this actually ships
(it doesn't today).

### 3.8 Env-var and first-login safety (originally T7/T8 from the 2026-07-14 trial; mechanically enforced in § 3.6 above)

- **T7** (bare `AUTH_CENTER`/`SESSION_MEMORY_URL` shell export silently
  overriding stored config): `process.env` wins over any stored value in
  bobby-cli's resolution order (`config.ts:89-97`) — correct CLI behavior,
  the risk is host misconfiguration. § 3.6 Step 0 area doesn't add a
  process-env check because there is nothing in this migration's design
  that exports those bare names on the openClaw host (the old helper's
  `~/.openclaw/.env`-reading is retired per § 3.6 Step 1's F5 fix) — if a
  future change to the openClaw host process ever exports `AUTH_CENTER`
  directly into the shell, that host-level change is what must add a
  pre-flight check, not this spec. Flagged here so it isn't forgotten if
  that changes.
- **T8** (first login of a new profile silently falling back to
  production): fully closed by § 3.6 Steps 1/1b — `/setup-memory` writes
  `AUTH_CENTER`/`SESSION_MEMORY_URL` to `~/.bobby-cli/.env` and then
  **mechanically re-reads the file back** to confirm both keys are present
  before Step 2 (`auth login`) is allowed to run at all. This is a real
  gate in the wizard, not documentation the admin has to remember to
  follow.

### 3.9 Duplicate-write debounce (T1)

Skill-level rule, not a CLI change: the rewritten skill's `remember`
guidance tells the agent not to retry a `remember` call that appears to
hang — a retry inside Vectorize's few-second consistency window lands both
copies unblocked. Mirrors this project's existing per-tool "at most two
recall/list calls per turn" convention in the current `AGENTS.md`.

### 3.10 Latency budget (T3 + the ticket-T09 `remember` finding)

(Two unrelated `T`-numberings meet here, disambiguated by context per
round 3/H2: `T3` is this spec's own 2026-07-14 trial finding §55–84;
`T09`/`T01`–`T09` elsewhere in this doc always means an implementation
*ticket*, `bobby-cli/tickets/T09-*.md`.) Ticket T09 (2026-07-20)
additionally measured `memory remember` at
2.3–3.6s (server-side embedding + dedup, not a bobby-cli regression).
Combined with T3's ~3s per-session cold start, a Discord turn that calls
`remember` can
plausibly take 3–7s end to end. This migration's skill should surface a
"thinking"/typing indicator for `remember` calls specifically (an openClaw
UX behavior, not a bobby-cli change) so Discord users don't perceive the
bot as stuck.

## Success criteria

1. `~/.openclaw/workspace/skills/` contains a non-invocable `bobby-cli`
   command-reference skill plus four user-invocable skills — `login`,
   `setup`, `logout` (new, § 3.5), `forget` (unchanged) — per § 3.1's
   corrected two-layer design; `setup-memory` still exists but only its
   admin-bootstrap responsibilities (§ 3.6), not a Discord-facing memory
   helper.
2. `~/.openclaw/scripts/session-memory-call.py` no longer exists; no
   skill invokes raw `curl`/`urllib` against auth-center or session-memory.
3. A DM user can run `/login`, then immediately have working personal
   memory through the `bobby-cli`-backed skill (§ 3.3), exercised live end
   to end — same trial-protocol standard T09 held itself to (execute,
   don't assume from code review).
4. A guild admin can run `/setup` (after `/setup-memory` has already run
   once — § 3.4's ordering fix) and all members get shared memory,
   exercised live; running `/setup` *before* `/setup-memory` produces the
   explicit "run `/setup-memory` first" message (§ 3.4), not a raw `cp`
   failure.
5. `AGENTS.md`'s Discord Identity Gate routes every memory op through
   bobby-cli with the correct `--profile`/`BOBBY_CLI_PROFILES_DIR`; grep
   confirms no remaining reference to `session-memory-call.py`; a live
   test confirms a `code: "not_logged_in"` response from a memory op
   causes the gate to delete that profile's file (§ 3.6's F8 self-heal
   fix), not just report the error.
6. `/setup-memory`'s Step 1b gate is exercised live on a fresh `$HOME`
   with no prior `~/.bobby-cli` state: attempting Step 2 (`auth login`)
   without first writing both `AUTH_CENTER` and `SESSION_MEMORY_URL` into
   `~/.bobby-cli/.env` produces a `grep` count of `0` (or a missing-file
   exit) that the wizard's own control flow checks and stops on (§ 3.6
   Step 1b, corrected round 2/G6 — this is a checkable condition the
   wizard must act on, not a guarantee the shell itself enforces) rather
   than silently proceeding — this replaces the original unfalsifiable "does not silently touch
   production" wording with something a fresh implementer can actually
   run and check.
7. No `sm_live_*` token appears in any Discord-visible message or a bot
   log grep, same standard as T09 item 3/8.
8. Migration step: before first use, every pre-existing
   `~/.openclaw/user-sessions/*.json` and `~/.openclaw/server-sessions/*.json`
   file has been deleted (§ 3.7) — grep/`ls` confirms none predate the
   migration's own `/login`/`/setup` re-runs.
9. **(Fixes F11 — the missing marker round 3/H1 flagged: F11 was "criterion
   6 wasn't mechanically checkable and §§ 3.9/3.10 had no criteria at
   all"; this item plus the rewrite of item 6 above are that fix.)** The
   `remember` duplicate-write debounce guidance (§ 3.9) is present in
   the deployed skill/`AGENTS.md` text — grep for the no-retry rule; and
   the `remember`-specific typing/thinking-indicator behavior (§ 3.10) is
   exercised live in an actual Discord turn, not just described.

## Decisions (recorded 2026-07-20, at the owner's request — all 5 resolved)

1. **`/forget` split** (§ 3.5). **Decided: split.** `/forget` stays exactly
   as it is today (password-reset, untouched by this migration — bobby-cli
   has no password concept and shouldn't grow one just to unify a name). A
   **new** `/logout` DM command wraps `BOBBY_CLI_PROFILES_DIR=
   ~/.openclaw/user-sessions bobby-cli auth forget --profile "$SENDER_ID"
   --json` (bare snowflake, per § 3.2's F4 fix — **not** the
   `discord-dm-<senderId>` prefixed name this Decision originally said,
   corrected in round 2/G2 since that prefixed path never exists on disk
   and would make `/logout` a no-op) for actual credential cleanup.
   Rationale: the two openClaw code paths already do unrelated things
   (`/auth/users/forgot-password` vs. deleting a local file) — forcing them
   under one name would be the confusing outcome, not the fix. Spec 13 §4's
   phrasing is read as imprecise shorthand, not a literal one-skill
   requirement.

2. **Existing session migration** (§ 3.7). **Decided: no converter,
   one-time re-login.** This project has no production Discord deployment
   yet (`PRODUCTION-UPDATES.md` — deploys are manual-only and none has
   shipped this bot), so "real user base too large to re-login" doesn't
   apply today. Building a converter for a hypothetical future user count
   would be exactly the kind of building-ahead-of-need this project's own
   specs (10, 13) explicitly avoid elsewhere. If a production rollout
   happens before this migration ships and accumulates real users in the
   meantime, revisit this decision then — don't let it block drafting
   tickets now.

3. **Shared-team identity** (§ 3.4/3.6). **Decided — corrected in round
   2/G4: no named profile at all, by design.** The original wording
   ("`discord-team`, as drafted") described a profile name that doesn't
   actually exist anywhere in the design once § 3.2's F4 fix landed:
   §§ 3.4/3.6 bootstrap the shared team identity with a plain `bobby-cli
   auth login`/`auth show`, **no `--profile` and no `--label`** — it lives
   at bobby-cli's own default path (`~/.bobby-cli/credentials.json`, the
   same default every human/coding-agent caller already uses) precisely
   *because* the team token isn't tied to any one Discord entity that a
   profile name would identify. Any spec prose still saying
   "`discord-team` profile" refers to this default-path identity, not a
   file named `discord-team.json` — there is no such file.

4. **Byte-identical vs. appendix** (spec 13's own open question 2, resolved
   here). **Decided: shared base + Discord-only appendix**, as drafted in
   § 3.1. A byte-identical copy would force Discord-specific Identity-Gate
   prose into the chawengburi-repo skill that Claude Code sessions never
   use, bloating the file spec 12/13's whole point was to keep thin. The
   same-change rule already covers "both deployed copies," so drift risk
   is handled without requiring the files to be literally identical.

5. **Deployment target for `/setup-memory`'s admin bootstrap.** **Decided
   — corrected after round-1 audit (F6):** the original wording ("defaults
   to the test deployment") was factually wrong — `config.ts:21-22`'s
   built-in fallback is the real **production** deployment; there is no
   built-in test default anywhere in the code to fall back to. The actual
   decision is: **never rely on any built-in default at all.**
   `/setup-memory` must have `AUTH_CENTER`/`SESSION_MEMORY_URL` written to
   `~/.bobby-cli/.env` and mechanically confirmed present (§ 3.6 Step 1b)
   before it ever calls `bobby-cli auth login` — for a test deployment
   *or* production. Which URL the admin types in Step 1 is a deployment
   choice made at that moment, not a CLI default; this project's
   standing "production is manual-only" rule (`PRODUCTION-UPDATES.md`)
   still means a production rollout of this bot is a separate, explicit,
   human-supervised step — this spec's contribution is just making sure
   the wizard can never silently proceed with neither URL set.
