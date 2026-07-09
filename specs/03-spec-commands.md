# 03 Spec: Command Reference

> Implementation: `src/index.ts`, `src/commands/auth.ts`, `src/commands/memory.ts`

## Top-level

```
bobby-cli --version
bobby-cli --help
```

`--version` prints the version from `package.json` (currently `0.1.0`,
hardcoded in `src/index.ts` — see [07](./07-spec-roadmap-open-questions.md)
for keeping this in sync automatically).

## `auth` — manage your auth-center login

### `bobby-cli auth login`

Logs in to `auth-center` and mints a session-memory API token.

| Flag | Description |
|---|---|
| `--email <email>` | Skip the email prompt |
| `--password <password>` | Skip the password prompt |
| `--json` | Machine-readable output |

Credential resolution order: `--email`/`--password` flags → `BOBBY_CLI_EMAIL`/
`BOBBY_CLI_PASSWORD` env vars → interactive prompt (password masked). If
either email or password resolves from a flag/env var but not the other, only
the missing one is prompted for.

On success: performs `POST /auth/token` (email+password → short-lived session
token), then `POST /auth/tokens` (session token → `sm_live_...` API token,
labeled `bobby-cli@<hostname>`), then writes `~/.bobby-cli/credentials.json`.

```bash
bobby-cli auth login
bobby-cli auth login --email me@example.com --password '...'
BOBBY_CLI_EMAIL=me@example.com BOBBY_CLI_PASSWORD=... bobby-cli auth login
```

Human output: `Logged in as <email>. Credentials saved to ~/.bobby-cli/credentials.json`
JSON output: `{ "ok": true, "email": "...", "tenantId": "..." }` on success,
`{ "ok": false, "error": "<message>" }` on failure.

### `bobby-cli auth show`

Shows the current login's metadata. Never prints the raw token.

| Flag | Description |
|---|---|
| `--json` | Machine-readable output |

```bash
bobby-cli auth show
```

Human output (example):
```
Email:        me@example.com
Tenant:       tenant-abc
Token label:  bobby-cli@my-macbook (tok_123)
Scopes:       memory:read, memory:write, memory:delete
Created:      2026-07-01T12:00:00.000Z
Expires:      (never)
```

JSON output: `{ loggedIn, email, tenantId, apiTokenLabel, apiTokenId, scopes,
createdAt, expiresAt, authCenterUrl, sessionMemoryUrl }`, or `{ "loggedIn":
false }` if not logged in.

### `bobby-cli auth forget`

Deletes the local credential file. **Local-only** — does not call
`DELETE /auth/tokens/:id` to revoke the token server-side (see
[04](./04-spec-auth-model.md) and [07](./07-spec-roadmap-open-questions.md)).

| Flag | Description |
|---|---|
| `--json` | Machine-readable output |

```bash
bobby-cli auth forget
```

Human output: `Forgot local credentials.` or (if already logged out)
`Already logged out.` JSON output: `{ "ok": true, "deleted": <boolean> }`.

## `memory` — read and write session-memory

All `memory` subcommands require a prior `auth login` — they fail with
`Not logged in. Run \`bobby-cli auth login\` first.` otherwise (exit code 1).

### `bobby-cli memory show`

List recent memories, chronological, with optional tag filtering.

| Flag | Default | Description |
|---|---|---|
| `-n, --limit <n>` | `10` | Number of entries |
| `--tags <tags>` | — | Single tag to filter by (comma-separated input accepted, only the first tag is used — see note below) |
| `--json` | — | Machine-readable output |

```bash
bobby-cli memory show -n 20 --tags work
```

Calls the `list_recent` MCP tool with `{ n, tag? }`.

### `bobby-cli memory recall <query>`

Semantically search memories.

| Flag | Default | Description |
|---|---|---|
| `-n, --limit <n>` | `5` | Number of results |
| `--tags <tags>` | — | Single tag to filter by |
| `--json` | — | Machine-readable output |

```bash
bobby-cli memory recall "last week's decision" -n 10
bobby-cli memory recall "architecture" --tags engineering
```

Calls the `recall` MCP tool with `{ query, topK, tag? }`.

### `bobby-cli memory remember [text]`

Save a memory. Reads stdin if no `text` argument is given (only when stdin
is not a TTY — piping is required, there is no interactive fallback).

| Flag | Description |
|---|---|
| `--tags <tags>` | Comma-separated tags |
| `--json` | Machine-readable output |

```bash
bobby-cli memory remember "decided to use TypeScript for the CLI"
cat notes.md | bobby-cli memory remember
bobby-cli memory remember "note" --tags work,idea
```

Calls the `remember` MCP tool with `{ content, tags: string[], source:
"bobby-cli" }`. Errors with `No content given (pass text or pipe via
stdin).` if both the argument and stdin are empty.

### `bobby-cli memory append <id> <text>`

Append additional context to an existing entry.

| Flag | Description |
|---|---|
| `--json` | Machine-readable output |

```bash
bobby-cli memory append mem_123 "update: this shipped in v0.2.0"
```

Calls the `append` MCP tool with `{ id, addition: text }`.

### `bobby-cli memory forget <id>`

Delete a memory entry by ID.

| Flag | Description |
|---|---|
| `--json` | Machine-readable output |

```bash
bobby-cli memory forget mem_123
```

Calls the `forget` MCP tool with `{ id }`.

## Note: `--tags` is single-tag today

Despite the flag description saying "comma-separated tags," `memory show`
and `memory recall` only ever forward the *first* parsed tag to the
underlying `list_recent`/`recall` MCP tools (`tags?.[0]`) — session-memory's
tool interface takes one `tag`, not an array, for filtering. `memory
remember`'s `--tags` is the one place multiple tags are actually used
(forwarded as `tags: string[]`). This is a real inconsistency in the current
implementation, not a documentation choice — see
[07](./07-spec-roadmap-open-questions.md).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Any failure — auth error, network error, MCP error, missing credentials, empty `memory remember` input |

Set via `process.exitCode` (not `process.exit()`), by `printError` (human
mode) and by `emit()` in `src/commands/memory.ts` when `--json` output has
`ok: false`. `auth login`'s JSON-mode failure path does not currently set a
non-zero exit code — see [07](./07-spec-roadmap-open-questions.md).
