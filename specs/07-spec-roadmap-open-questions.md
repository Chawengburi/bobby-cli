# 07 Spec: Roadmap & Open Questions

> **Decision (2026-07-09):** a shared MCP server wrapping bobby-cli was
> considered and **rejected** as the path to agent-callable tools — see
> [01-spec-motivation-architecture.md § Decision](./01-spec-motivation-architecture.md#decision-2026-07-09-agent-integration-stays-cli-first-no-shared-mcp-server).
> The chosen path (shared auth core + a static tool-schema manifest, CLI
> stays the execution primitive) is specced in
> [08-spec-shared-auth-core.md](./08-spec-shared-auth-core.md) and
> [09-spec-agent-tool-schema.md](./09-spec-agent-tool-schema.md).

> Following this repo's convention (see
> [session-memory/specs/09-spec-discord-actor.md § ปัญหาที่ยังเปิดอยู่](../../session-memory/specs/09-spec-discord-actor.md#ปัญหาที่ยังเปิดอยู่))
> of recording open questions inside the spec rather than blocking on them —
> these are flagged, not decided. **Ask before implementing any of these.**

## Fixed (2026-07-09): `npm run build` broke on native Windows

Found during a Windows/Linux compatibility review: `package.json`'s
`build` script was `tsc && chmod +x dist/index.js` — `chmod` is a POSIX
shell command with no native equivalent in `cmd.exe`/PowerShell. This would
fail `npm run build` for a contributor building bobby-cli from source on
Windows without Git Bash/WSL in `PATH` (it does **not** affect end users
running `npm install -g @chawengburi/bobby-cli`, since the published tarball ships a
pre-built `dist/` and npm generates its own `.cmd`/`.ps1` wrapper on
Windows regardless of the Unix executable bit). Fixed by replacing it with
`tsc && node -e "require('fs').chmodSync('dist/index.js', 0o755)"` —
`chmodSync` runs identically on every platform Node supports, no shell
command dependency.

## Deferred by design (not forgotten)

### OAuth device-code flow

README already states this: *"There is no OAuth device-code flow yet — it's
a deliberate v1 scope cut, not an oversight."* Relevant for headless/remote
agents that can't do an interactive password prompt at all. Research note:
`gh auth login`'s default is a browser-based device flow, with password/PAT
as the fallback — bobby-cli currently ships only the fallback. Worth
revisiting once there's a concrete headless use case beyond what
`BOBBY_CLI_EMAIL`/`BOBBY_CLI_PASSWORD` already covers.

### Server-side revoke on `auth forget`

`auth forget` only deletes the local file today. Adding
`DELETE /auth/tokens/:id` (see
[auth-center/tickets/03-personal-api-token.md](../../auth-center/tickets/03-personal-api-token.md))
would make `forget` actually invalidate the token, not just stop bobby-cli
from using it locally.

## Open questions — need a decision, not guessed here

### 1. Credential storage: plain file vs. OS keychain

Today: `~/.bobby-cli/credentials.json`, mode `0600`. `gh` (GitHub CLI)
stores tokens in the system credential store (macOS Keychain / Windows
Credential Manager / Linux Secret Service) by default, falling back to a
plain file only when no keychain is available, and only added this as of
`gh 2.24.0` — it wasn't there from day one either.

**Question:** is a `0600` file acceptable for this project's threat model
(single-user dev machines, internal org tooling), or is keychain-backed
storage worth the added dependency (`keytar` or similar) and cross-platform
complexity? This is a real security/effort tradeoff, not a default I should
pick silently.

**Update (2026-07-09), cross-platform review:** this isn't just an effort
tradeoff — confirmed via Node.js's own `fs` docs that `mode: 0o600`/`0o700`
is POSIX-only. On Windows, Node does not translate owner/group/other
permission bits (Windows uses NTFS ACLs instead), so bobby-cli's explicit
"owner-only" guarantee **silently does not apply on Windows** — the file
ends up protected only by whatever ACL the user's profile folder already
has by default, not by anything bobby-cli itself sets. See
[04-spec-auth-model.md § Cross-platform note](./04-spec-auth-model.md#cross-platform-note-windows-mode-06000700-is-a-no-op-there)
for the full explanation. This tips the tradeoff meaningfully toward
keychain storage, since OS keychains are the one option that actually
enforces the same guarantee on every platform — flagging this as new
evidence for whoever makes this call, not deciding it here.

### 2. Should `auth login` warn before potentially revoking another session?

Per [04-spec-auth-model.md](./04-spec-auth-model.md), logging in today can
silently revoke a different active token for the same principal (the
1-active-token-per-`(principal, resource)` rule). Options:

- Do nothing client-side; treat this purely as an `auth-center` fix (the
  multi-token migration already tracked there).
- Add a client-side warning/confirmation in `bobby-cli auth login` ("this
  may sign out another active session for this account — continue?"),
  as a stopgap until the server-side fix lands.

**Question:** is a stopgap warning worth adding to bobby-cli, or is this
purely `auth-center`'s problem to fix and bobby-cli should stay unaware of
it? (Leaning toward "purely auth-center's problem," since a client-side
warning can't actually detect whether a collision will happen without an
extra API call — but this is a judgment call, not decided here.)

### 3. npm package name/scope — decided (2026-08-04)

Was: `bobby-cli` unscoped vs. a scope, still open in README's "Before
publishing" checklist.

**Decided: `@chawengburi/bobby-cli`.** Scoped, on the org account — the scope
signals "internal tool, not a public offering" per `DEVELOPMENT.md` Part 3
step 4, and an unscoped `bobby-cli` on the public registry is a global name
this project has no reason to claim. Scoped packages publish private by
default, so `--access public` is required; `package.json` sets
`publishConfig.access: "public"` and the release workflow passes the flag
explicitly, so neither depends on the other being remembered.

This supersedes the interim `@babyferret/bobby-cli@0.3.0` publish (2026-07-21),
which went out under a personal/trial npm account. The org, the automation
token, and the approval gate are all in place as of 2026-08-10; the release
procedure itself is documented outside this repository.

### 4. `--tags` inconsistency in `memory show`/`memory recall` — fixed (2026-07-13)

Was: the flag read as multi-tag but only the first parsed tag was ever sent
to `list_recent`/`recall`, because those tools only accepted a single `tag`
string. Fixed on both sides — resolution (a) from the original question:

- session-memory's `recall`/`list_recent` now also accept `tags: string[]`,
  OR semantics (matches entries having any of the tags — same any-of
  behavior as the REST `GET /api/entries?tags=` filter). The single `tag`
  param remains supported; when both are sent they merge into one OR set.
- bobby-cli's `show`/`recall` now always send **both** `tag` (first tag)
  and `tags` (full list). Verified empirically that pre-fix servers
  silently strip unknown params (zod strip mode) — sending only `tags`
  would have degraded to *unfiltered* results with no error, so the
  dual-param contract makes old servers degrade to the previous first-tag
  behavior instead. See [03-spec-commands.md](./03-spec-commands.md).

### 5. Exit code gap in `auth login --json` — fixed (2026-07-09)

Was: `runLogin`'s JSON failure branch (`printJson({ ok: false, error })`)
didn't set `process.exitCode = 1`, unlike every other command's failure
path. Fixed while implementing
[10-spec-credential-profiles.md](./10-spec-credential-profiles.md) (the edit
touched this exact branch to thread `--profile` through) — see that spec's
"Implementation note" for why this wasn't kept as a silent side effect.
`bobby-cli auth login --json` on failure now sets a non-zero exit code like
every other command.

## Considered and not currently planned

`gh`-style features that were considered against this project's actual
needs and don't have a concrete driver yet — listed so they aren't
re-proposed without new information:

- Shell completion generation (`bobby-cli completion bash/zsh`)
- Aliases (`gh alias set`-style)
- A raw API-passthrough command (`bobby-cli api <tool> --field x=y`, mirroring
  `gh api`) for calling new session-memory MCP tools without a CLI release —
  plausible if session-memory's tool set grows faster than bobby-cli's
  release cadence, but no such tool exists yet
- A `bobby-cli config` command for viewing/setting the `AUTH_CENTER`/
  `SESSION_MEMORY_URL` overrides without editing `.env` by hand — low value
  while overrides are dev-only, per [05](./05-spec-config-environment.md)
