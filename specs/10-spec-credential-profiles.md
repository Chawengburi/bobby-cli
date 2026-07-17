# 10 Spec: Credential Profiles (`--profile`)

> Decision context: [01-spec-motivation-architecture.md § Non-goals](./01-spec-motivation-architecture.md#non-goals) —
> "per-Discord-user identity inside a shared bot process ... is out of scope."
> This spec is what changes to bring it *in* scope, without touching that
> decision's reasoning (still no shared MCP server, still one principal per
> invocation — just letting the caller say *which* principal by name).
>
> Builds on: [04-spec-auth-model.md](./04-spec-auth-model.md) (credential
> storage shape), [05-spec-config-environment.md](./05-spec-config-environment.md)
> (resolution-precedence pattern), [09-spec-agent-tool-schema.md](./09-spec-agent-tool-schema.md)
> (manifest that will need new entries for this flag).
>
> **Revision (2026-07-09):** superseded an earlier draft of this spec that
> proposed `--credentials-file <path>` (caller supplies a full file path).
> Revised to `--profile <name>` (caller supplies only a short identifier;
> bobby-cli owns path construction) after researching how established
> multi-identity CLIs solve the same problem — see § Prior art below. The
> problem, goal, and openClaw integration point are unchanged; only the shape
> of the override changed.

## Problem

bobby-cli's credential path is a hardcoded constant —
`CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json")` in
`src/core/config.ts:6`, resolving to `~/.bobby-cli/credentials.json`. There is
no flag or env var to point it anywhere else. Confirmed by grep: zero matches
for `credentials-file`, `credentialsFile`, `--profile`, or `CREDENTIALS_PATH`
overrides anywhere in `src/`.

This is correct for bobby-cli's original user (one human or one
service/agent, one machine, one identity — see
[02-spec-requirements.md § Users](./02-spec-requirements.md#users), which
already classifies "Coding agent (Claude Code, etc.)" in this same
single-principal-per-machine category) but breaks down for openClaw's actual
deployment shape, confirmed by reading the live code on this machine, not
assumed:

- `~/.openclaw/scripts/session-memory-call.py` takes `--context {dm,guild}
  --id <discord_or_guild_id>` on **every call** and resolves a *different*
  credential file per invocation:
  ```python
  def session_path(context, subject_id):
      base = HOME / ".openclaw"
      if context == "dm":
          return base / "user-sessions" / f"{subject_id}.json"
      return base / "server-sessions" / f"{subject_id}.json"
  ```
- The `/login` Skill mints a token via raw `curl` subprocess calls
  (`POST /auth/token`, `POST /auth/tokens`, hand-assembled by an LLM editing
  Python source inline) and writes it to that same per-Discord-user path.
- One openClaw process serves many Discord users concurrently. There is no
  single "whoever is logged in on this machine" — that concept doesn't exist
  at this layer. Each Discord user is a distinct `auth-center` principal with
  their own token, and the **end user never runs a CLI command themselves** —
  every invocation is skill-mediated (an LLM shells out on the user's
  behalf, reading Discord metadata for the turn to decide which identity to
  act as).

Dropping bobby-cli in as a replacement for the Python helper today would
silently collapse every Discord user onto whichever single principal is
stored in `~/.bobby-cli/credentials.json` — a correctness regression, not a
missing nice-to-have.

Local dev-machine usage (a human, or a coding agent like Claude Code/Codex
shelling out on that human's behalf, running `bobby-cli auth login`
themselves) already works today and must keep working **unchanged** — this
spec only adds an opt-in override that nothing touches unless it explicitly
opts in. Neither a bare env var alone, nor omitting the new flag, changes
resolution: the default path only changes when `--profile` is *explicitly*
passed on that invocation.

## Goal

Let a caller select a named identity, per invocation, so bobby-cli can be
the execution primitive for *both*:

- a human's (or a coding agent's) single machine-wide login (today's
  behavior, default, unchanged)
- a skill dispatching to one-identity-per-Discord-user on a shared machine
  (new)

## Prior art

Researched how CLIs that already solve "one shared install, many identities"
do it, before committing to a design:

| Tool | Mechanism | Shape |
|---|---|---|
| AWS CLI | `--profile <name>` / `AWS_PROFILE`; named sections inside `~/.aws/credentials` (or a relocatable file via `AWS_SHARED_CREDENTIALS_FILE`) | caller supplies a **name**, not a path |
| kubectl | `--context <name>`; named cluster+user+namespace triples inside one or more merged `KUBECONFIG` files | caller supplies a **name**, not a path |
| `gh` (GitHub CLI) | `GH_CONFIG_DIR` relocates the whole config directory; `GH_TOKEN` is a separate raw-token escape hatch | directory-level override, plus a distinct raw-token path for when the caller already has one in hand |
| Slack Bolt `installationStore` | `find_installation(team_id, user_id)` — an abstract lookup called by the framework at request time, backed by any store | full lookup-by-ID abstraction, not file-based at all |

Takeaways applied below:

- **AWS/kubectl's "supply a name, not a path" is safer by construction** —
  the caller never controls a filesystem path directly, which closes a path-
  traversal question by design rather than by validation logic bolted on
  after the fact. This is the main reason this spec no longer proposes
  `--credentials-file <path>`.
- **AWS's specific file layout is a cautionary example, not a model to
  copy** — its config file prefixes profile names with `profile ` while its
  credentials file doesn't, a well-known source of user confusion. This spec
  avoids that: one profile = one file, no section-name prefix rules to get
  wrong.
- **Slack's full lookup-store abstraction solves a real problem (many
  thousands of tenants, pluggable backends) that bobby-cli does not have
  today.** Building an abstract store interface now, for a v1 with 8
  commands and a stated "stay simple, no daemon" philosophy across
  [01](./01-spec-motivation-architecture.md), [08](./08-spec-shared-auth-core.md),
  and [09](./09-spec-agent-tool-schema.md), would be scope creep against
  this project's own established pattern of not building for a scale that
  isn't a concrete need yet. Flagged in § Open questions below as something
  to revisit if the Discord user count grows large enough that flat files
  per profile become a real operational problem — not solved preemptively
  here.
- **`gh`'s separate raw-token env var is real precedent for a valid pattern
  this spec still doesn't adopt for v1** — see § Considered and rejected.

## Design

### New flag + env var, following the same precedence shape as existing overrides

```
--profile <name>                    (flag; selects a named identity)
BOBBY_CLI_PROFILES_DIR <dir>        (env var; where profiles live — optional)
```

Resolution:

1. No `--profile` given → **unchanged default**: `~/.bobby-cli/credentials.json`.
2. `--profile <name>` given → resolves to `<profiles-dir>/<name>.json`, where
   `<profiles-dir>` is `BOBBY_CLI_PROFILES_DIR` if set, else the built-in
   default `~/.bobby-cli/profiles/` (mirrors AWS/kubectl/`gh` always having a
   sensible built-in directory rather than requiring the env var).

`<name>` is validated against `^[a-zA-Z0-9_-]+$` and rejected otherwise
(`Invalid profile name: <name>. Use only letters, numbers, "-", "_".`) —
this is what actually closes the path-traversal question, not just the
"caller supplies a name" framing: without it, a name like `../../etc/passwd`
would still escape `<profiles-dir>` via string concatenation. Discord
snowflake IDs (the openClaw use case) always match this pattern already, so
this validation never rejects a legitimate call in that integration.

### Commands affected

| Command | Effect of `--profile <name>` |
|---|---|
| `auth login` | Writes the minted credentials to `<profiles-dir>/<name>.json` instead of the default. Creates `<profiles-dir>` (mode `0700`) if missing, same as today's `~/.bobby-cli` creation logic. |
| `auth show` | Reads `<profiles-dir>/<name>.json` instead of the default. |
| `auth forget` | Deletes `<profiles-dir>/<name>.json` instead of the default. |
| `memory show` / `recall` / `remember` / `append` / `forget` | Reads `<profiles-dir>/<name>.json` for the API token + `sessionMemoryUrl` used to make the call. |

No change to `authCenterUrl`/`sessionMemoryUrl` resolution logic itself
([05](./05-spec-config-environment.md)) — those already read from "stored
value from a prior `auth login`," and that stored value now simply comes
from whichever profile file was resolved. One override mechanism, not two.

### Implementation shape

`src/core/config.ts`'s four credential functions
(`hasCredentials`/`loadCredentials`/`saveCredentials`/`deleteCredentials`)
currently close over the module-level `CREDENTIALS_PATH` constant. This spec
changes them to accept an optional `profile` parameter:

```ts
const PROFILE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function resolveCredentialsPath(profile?: string, profilesDirOverride?: string): string {
  if (!profile) return CREDENTIALS_PATH; // unchanged default
  if (!PROFILE_NAME_RE.test(profile)) {
    throw new Error(`Invalid profile name: ${profile}. Use only letters, numbers, "-", "_".`);
  }
  const profilesDir = profilesDirOverride ?? DEFAULT_PROFILES_DIR; // ~/.bobby-cli/profiles/
  return join(profilesDir, `${profile}.json`);
}
```

Each command in `src/commands/auth.ts` / `src/commands/memory.ts` reads
`--profile` (via commander) and `BOBBY_CLI_PROFILES_DIR`, and passes them
down. This is an additive signature change — every existing call site that
doesn't pass a profile keeps today's behavior exactly, satisfying the
backward-compatibility requirement below without a second version of any
function needing to exist.

## Concrete usage: replacing the openClaw helper scripts

```bash
# /login skill, replacing the inline curl/Python block.
# Credentials go via env vars, never --email/--password flags: argv is
# visible in the process list (`ps`) on a shared host (see spec 13 §6).
BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions \
BOBBY_CLI_EMAIL="$EMAIL" BOBBY_CLI_PASSWORD="$PASSWORD" \
  bobby-cli auth login --profile "$SENDER_ID" --json

# session-memory-call.py, replaced entirely by:
BOBBY_CLI_PROFILES_DIR=~/.openclaw/user-sessions \
  bobby-cli memory recall "$QUERY" --profile "$SENDER_ID" --json
```

Same shape for guild/shared memory, with `BOBBY_CLI_PROFILES_DIR=~/.openclaw/server-sessions`
and `--profile "$GUILD_ID"`. This removes the hand-rolled `curl`/JSON-RPC/
SSE-parsing logic from `session-memory-call.py` and the inline-edited Python
in the `/login` Skill entirely — both become thin wrappers that fill in
`$SENDER_ID`/`$GUILD_ID` and shell out, exactly the shape
[09](./09-spec-agent-tool-schema.md) already designed for agent callers in
general.

The raw token still never reaches the skill's LLM context: the skill only
ever handles a **Discord ID**, never a filesystem path and never the token
itself, preserving the hard rule in
[06-spec-output-conventions.md](./06-spec-output-conventions.md).

A human on their own machine, or Claude Code/Codex shelling out on that
human's behalf, never needs `--profile` at all — the default path is
untouched, and nothing in this design requires those callers to learn a new
flag. `--profile` on a personal machine remains available as an optional
convenience (e.g. `bobby-cli auth login --profile work` for a second
account), matching `gh auth switch`-style workflows, but is never required.

## What this does *not* change

- Still no shared MCP server, still no daemon, still a fresh process per
  invocation — this spec adds a parameter to the existing per-invocation
  model, it does not revisit the [01](./01-spec-motivation-architecture.md)
  decision.
- Still exactly one principal per invocation. A single `bobby-cli` call
  never juggles multiple identities — the caller (the skill) picks the
  profile before invoking, same division of responsibility as
  `session-memory-call.py`'s `--id` today.
- Doesn't need to work around the one-active-token-per-`(principal,
  resource)` collision risk described in the original draft of
  [04](./04-spec-auth-model.md) — confirmed during this implementation that
  `auth-center` shipped the multi-active-token fix for **user** principals
  on 2026-07-09 (migration `005-multi-active-user-token.sql`,
  `revokeExisting: false` on `POST /auth/tokens`). Each Discord user minted
  via `--profile` gets their own independently-labeled token; logging in
  from Discord no longer risks revoking a web-UI session or another
  machine's token for the same account, and vice versa. This *does* still
  apply to **machine** principals (unchanged, still one active token per
  resource) — relevant if bobby-cli is ever used to log in as a
  machine/service account rather than a human/Discord-user account.

## Considered and rejected

### Caller-supplied arbitrary path (`--credentials-file <path>`)

The original draft of this spec. Superseded — see § Prior art. A full path
puts path-traversal prevention entirely on caller discipline; a name puts it
on a one-line regex bobby-cli itself enforces. Named profiles also match
what every surveyed prior-art CLI actually does; a raw path override does
not appear to be the primary mechanism in any of them (`gh`'s
`GH_CONFIG_DIR` is the closest, and even that relocates a whole directory
bobby-cli still controls the layout of, not an arbitrary target file).

### Raw token via env var instead of a profile

An alternative (real precedent: `gh`'s `GH_TOKEN`): skip the file entirely,
pass the token straight through, e.g. `BOBBY_CLI_API_TOKEN=sm_live_...
bobby-cli memory recall ...`, built by the skill from the session file's
contents on each call.

**Rejected for v1** — this would require the skill (LLM-driven) to read the
raw token out of the profile file into a variable it constructs the command
with, which is strictly more exposure than passing a profile name: env vars
carrying secrets are visible to anything that can read
`/proc/<pid>/environ` or a process list on the same host, and it
reintroduces the "token has to pass through something that assembles a
command" step that `--profile` avoids by letting bobby-cli read the file
itself. A raw-token env var also only helps the read side (`memory *`) — a
profile-based mechanism is still needed for `auth login`'s *write* side
regardless, so one mechanism covering both sides stays simpler than two.
Worth revisiting only if a concrete caller shows up that already holds a
token in memory and genuinely cannot use a file (none identified today).

## Open questions — flagging, not deciding here

### 1. Existing openClaw session file shape doesn't match bobby-cli's `Credentials` interface

Today's `~/.openclaw/user-sessions/{id}.json` (written by the `/login`
Skill's inline Python) has an ad hoc shape: `{ apiToken, tokenLabel,
setupBy, createdAt, ... }`. bobby-cli's `Credentials` interface
([04-spec-auth-model.md](./04-spec-auth-model.md)) is a superset:
`{ authCenterUrl, sessionMemoryUrl, email, tenantId, apiToken, apiTokenId,
apiTokenLabel, scopes, createdAt, expiresAt }`. If `auth login --profile`
becomes the sole writer going forward, existing session files written by
the old flow are missing fields bobby-cli's own read path may expect.
**Question:** is a one-time "every Discord user must `/login` again after
this ships" migration acceptable, or does `loadCredentials()` need to
tolerate a partial/legacy shape? Leaning toward "just require re-login"
since `/login` is already a self-serve, low-friction action for each user —
but not decided here.

### 2. Flat-file-per-profile at scale

Each profile is its own JSON file under `<profiles-dir>`. Fine at the scale
of a single Discord server/community; if the Discord user count grows into
the thousands, thousands of small files in one directory is a real (if
distant) operational question — directory listing performance, backup
granularity, etc. **Not solved here** — matches the "leaning toward the
simplest thing that solves today's concrete need" pattern already used
elsewhere in these specs (see [08](./08-spec-shared-auth-core.md)'s "internal
module, not a published package, yet"). Revisit only if this becomes a real
number, not a hypothetical one — a KV or SQLite-backed profile store (closer
to Slack Bolt's `installationStore`) would be the natural next step if so.

### 3. `schema/tools.json` needs updating — resolved (2026-07-09)

Done in the same change per `DEVELOPMENT.md`'s "update the manifest in the
same change" rule (this spec's original text deferred it as follow-up work;
that turned out to be inconsistent with the repo's own stated rule, so it
was done now instead). Every `auth_*` and `memory_*` entry's `input_schema`
now has an optional `profile` property, and every `invocation` template
includes `--profile {profile}`.

## Acceptance criteria

- [x] `--profile <name>` accepted by `auth login`, `auth show`,
      `auth forget`, and all five `memory` subcommands — implemented in
      `src/commands/auth.ts`, `src/commands/memory.ts`
- [x] Profile names are validated against `^[a-zA-Z0-9_-]+$`; anything else
      fails fast with a clear error, before any filesystem access —
      `resolveCredentialsPath()` in `src/core/config.ts`; verified live that
      `--profile '../../etc/passwd'` and `--profile 'bad name!'` are
      rejected before `~/.bobby-cli` is ever created
- [x] `BOBBY_CLI_PROFILES_DIR` env var respected when `--profile` is given;
      ignored (no effect at all) when `--profile` is absent — verified live
      both ways
- [x] `--profile` given with no `BOBBY_CLI_PROFILES_DIR` set resolves under
      the built-in default `~/.bobby-cli/profiles/`, not an error — verified
      live
- [x] Omitting `--profile` entirely reproduces today's exact behavior
      (`~/.bobby-cli/credentials.json`), regardless of whether
      `BOBBY_CLI_PROFILES_DIR` happens to be set in the environment —
      verified live in an isolated `$HOME`
- [x] `auth login --profile <name>` creates a missing `<profiles-dir>` at
      mode `0700` and writes the profile file at mode `0600`, matching the
      existing default-path guarantees — verified live via `stat` (exercised
      through `saveCredentials()` directly, since a real `auth login` needs a
      live account; the write path is identical either way)
- [x] No raw token is ever printed regardless of which profile resolves —
      unchanged code path for redaction (`output.ts`), only the file
      resolution changed
- [x] `bobby-cli --help` / each subcommand's `--help` documents `--profile`
      and `BOBBY_CLI_PROFILES_DIR` — verified live via `--help`

## Implementation note: `auth login --json` exit-code gap fixed as a side effect

While threading `--profile` through `runLogin`'s error path in
`src/commands/auth.ts`, the pre-existing gap tracked in
[07-spec-roadmap-open-questions.md § 5](./07-spec-roadmap-open-questions.md)
(`auth login --json`'s failure branch didn't set `process.exitCode = 1`) was
fixed in the same edit — the touched code now sets it, matching every other
command's failure path. Flagging this explicitly per spec 07's own
instruction not to silently patch it: this is now fixed, not just
documented as a known gap.
