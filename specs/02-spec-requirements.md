# 02 Spec: Requirements

> Why this shape: [01-spec-motivation-architecture.md](./01-spec-motivation-architecture.md)

## Goal

One binary, one credential store, one memory client — usable identically by
a human at a terminal, a coding agent (Claude Code), an AI agent, openClaw,
Hermes, or any other process that can shell out to a CLI. Published to npm
purely for easy `npm install -g` distribution across every machine/agent in
this org's own setup — not a generic bring-your-own-backend tool for third
parties (see [05](./05-spec-config-environment.md)).

## Users

| User | How they invoke it | What they need |
|---|---|---|
| Human developer | Interactive terminal | Prompted login, colored human-readable output |
| Coding agent (Claude Code, etc.) | Shells out via Bash tool | `--json` output, non-interactive login via env vars/flags |
| openClaw / Hermes / other bots | Shells out from a bot process | Non-interactive login, no raw token ever touching the bot's own context (see [01](./01-spec-motivation-architecture.md)) |
| CI / scripted setups | No TTY | `BOBBY_CLI_EMAIL`/`BOBBY_CLI_PASSWORD` env vars, no prompt |

## Functional requirements

### Auth

- FR-1: Log in with email + password against `auth-center`, mint an
  `sm_live_...` session-memory API token, and persist both to a local
  credential file.
- FR-2: Show the current login's metadata without ever printing the raw
  token.
- FR-3: Delete the local credential file on demand.
- FR-4: Accept credentials non-interactively via flags or env vars so
  scripted/agent callers never block on a prompt they can't answer.

### Memory

- FR-5: List recent memories, optionally filtered by a single tag, with a
  configurable result count.
- FR-6: Semantically search memories by query text, optionally filtered by
  tag, with a configurable result count.
- FR-7: Save a new memory from an argument or from stdin (for piping file
  contents/command output in), with optional comma-separated tags.
- FR-8: Append additional context to an existing memory entry by ID.
- FR-9: Delete a memory entry by ID.

### Cross-cutting

- FR-10: Every command supports a `--json` flag that emits a single
  machine-parseable JSON object/value on stdout — this is the contract
  agents and scripts parse, not the human-formatted text.
- FR-11: Non-zero exit code on any failure, in both output modes, so
  scripts can branch on `$?` without parsing text.
- FR-12: No command, in any mode (human or `--json`, success or error),
  ever prints the raw API token or session token.

## Design principles (borrowed from popular CLIs)

bobby-cli follows conventions established by widely-used CLIs — chiefly
[`gh`, the GitHub CLI](https://cli.github.com/manual/) — and the community
[Command Line Interface Guidelines](https://clig.dev/), rather than
inventing its own:

| Principle | Source | How bobby-cli applies it |
|---|---|---|
| Resource-noun + verb subcommands (`gh repo view`, `gh pr create`) | `gh` | `bobby-cli auth login`, `bobby-cli memory recall` |
| Human-first output by default; `--json` for scripts | clig.dev, `gh --json` | Every command; see [06](./06-spec-output-conventions.md) |
| Non-interactive-first: flags → env vars → prompt, never block a headless caller | clig.dev; `gh`'s `GH_TOKEN`/`GITHUB_TOKEN` | `resolveEmailPassword()` in `src/commands/auth.ts` checks flags, then `BOBBY_CLI_EMAIL`/`BOBBY_CLI_PASSWORD`, only prompting if both are missing |
| Env var override of stored config, for dev/test only | `gh`'s `GH_HOST`/`GH_TOKEN` | `AUTH_CENTER`/`SESSION_MEMORY_URL` — see [05](./05-spec-config-environment.md) |
| Secrets never echoed, stored with restrictive permissions | `gh`'s credential store (keyring, falls back to file) | `~/.bobby-cli/credentials.json` at mode `0600`; see [04](./04-spec-auth-model.md) for the gap vs. keyring storage, tracked in [07](./07-spec-roadmap-open-questions.md) |
| Explain state changes so the user can model what happened | clig.dev | `auth login` prints where credentials were saved; `auth forget` distinguishes "forgot" vs. "already logged out" |
| Quiet, parseable failure — don't dump raw error objects | clig.dev | `printError` only ever prints a message string, never a raw `Error`/response body (see `src/index.ts`'s `unhandledRejection` handler and `output.ts`) |

## Out of scope (v1)

- OAuth / device-code login (see [07](./07-spec-roadmap-open-questions.md))
- Server-side token revocation on `auth forget`
- Any multi-backend / bring-your-own-server configuration for end users
- Shell completion, aliases, or a raw API-passthrough command (all
  `gh`-style features considered but not requested — see [07](./07-spec-roadmap-open-questions.md))
- Acting as an MCP client or server itself (see [01](./01-spec-motivation-architecture.md) § Non-goals)

## Acceptance criteria

- [ ] `bobby-cli auth login` succeeds interactively and non-interactively
      (env vars, flags), and never prints a raw token in either path
- [ ] `bobby-cli auth show` reflects the current login or "not logged in",
      identically in human and `--json` mode, without the raw token in either
- [ ] `bobby-cli auth forget` removes `~/.bobby-cli/credentials.json` and is
      idempotent (safe to run twice)
- [ ] All five `memory` subcommands work against a live session-memory
      deployment and return a non-zero exit code on any `ok: false` result
      in `--json` mode
- [ ] Piping stdin into `memory remember` with no positional argument works
- [ ] Every command's `--help` output is accurate and matches this spec
