# 06 Spec: Output & Error Conventions

> Implementation: `src/output.ts`, `src/networkError.ts`

## The one hard rule

**Raw tokens (session token or `sm_live_...` API token) must never reach
stdout or stderr, in either human or `--json` mode, including in error
output.** This is inherited directly from the incident that shaped
bobby-cli's whole architecture — see
[01-spec-motivation-architecture.md](./01-spec-motivation-architecture.md):
openClaw redacts `sm_live_*` tokens out of MCP context specifically because
a token reaching an LLM's context window is a leak vector. bobby-cli's
answer is stronger than redaction: never emit the token in the first place.

If a raw token is ever observed in any command's output, that is a bug —
per the project README, it should be reported immediately, not patched
around with output filtering.

Enforced today by construction: `runShow()` in `src/commands/auth.ts`
builds its `summary` object by hand, deliberately omitting `creds.apiToken`
— there is no automatic redaction layer, so any new field added to that
summary must be added consciously, not by spreading the whole credentials
object.

## Two output modes, one contract

| Mode | Trigger | Shape |
|---|---|---|
| Human | default | Colored text via `chalk` — green for success, red for errors, dim for info. Free-form, meant for a person reading a terminal. |
| Machine | `--json` flag | A single `JSON.stringify(data, null, 2)` object on stdout, and nothing else. This is the contract agents/scripts parse — see [02](./02-spec-requirements.md) FR-10. |

`printJson`, `printSuccess`, `printError`, `printInfo` in `src/output.ts` are
the only places that write to stdout/stderr for command results — commands
should not `console.log` raw data outside these helpers (memory command's
plain-text success path via `console.log(result.text)` is the one
exception, matching `--json`'s "just the payload" contract in human mode
too).

## JSON shapes by command

| Command | Success shape | Failure shape |
|---|---|---|
| `auth login` | `{ ok: true, email, tenantId }` | `{ ok: false, error }` |
| `auth show` | `{ loggedIn: true, email, tenantId, apiTokenLabel, apiTokenId, scopes, createdAt, expiresAt, authCenterUrl, sessionMemoryUrl }` | `{ loggedIn: false }` |
| `auth forget` | `{ ok: true, deleted: boolean }` | — (doesn't fail) |
| `memory *` | `{ ok: true, text: string }` | `{ ok: false, error: string }` |

The long-noted inconsistency between `auth login`'s `{ ok, error }` shape
and `auth show`'s `{ loggedIn }` shape is **resolved by
[12-spec-agent-legible-output.md](./12-spec-agent-legible-output.md) § 2.1**
(decided 2026-07-17): `auth show` joins the `{ ok, code, ... }` envelope
with `loggedIn` as a domain field, exit 0 in both states. The table above
shows the pre-spec-12 shapes; spec 12 § 1–2 defines the extended envelope
(`code`, `hint`, structured fields) for every command. The remaining
exit-code asymmetry (only the `memory` family reliably sets non-zero exit
in JSON mode) is unchanged — see [03](./03-spec-commands.md) § Exit codes
and [07](./07-spec-roadmap-open-questions.md).

## Error taxonomy

| Error class | Where | When |
|---|---|---|
| `AuthCenterError` | `src/core/authClient.ts` | `/auth/token` or `/auth/tokens` returned non-2xx, or the request never reached the server |
| `McpError` | `src/core/mcpClient.ts` | session-memory's `/mcp` endpoint returned non-2xx, 401/403, an empty response, or a JSON-RPC `error` field |
| `CliAuthError` | `src/core/config.ts` | No local credentials found (`requireCredentials()`) |

All three are `Error` subclasses. As of
[12-spec-agent-legible-output.md](./12-spec-agent-legible-output.md)
(decided 2026-07-17) they carry two optional structured fields — this
supersedes the earlier "plain Error, no extra fields" rule:

- `status?: number` — the HTTP status, set when the server answered non-2xx
- `cause?: string` — the network error code from `describeNetworkError()`
  (`ECONNREFUSED`, `ENOTFOUND`, …), set when the request never reached the
  server

Exactly one of the two is set per error (`CliAuthError` sets neither — the
class itself means "no local credentials"). Spec 12 § 2 maps these onto
failure `code`s **per (transport, status)** — e.g. a 401 from session-memory
is `not_logged_in` but a 401 from auth-center during login is
`login_failed`; scope denial on the memory path arrives as a 200 text, not
a status (spec 12 § 1.1). Call sites that only read `.message` keep
working; the fields are additive.

## Network error messages

Node's `fetch()` collapses every connection-level failure (DNS failure,
connection refused, TLS error, ...) into a bare `TypeError: fetch failed`,
with the actionable code (`ECONNREFUSED`, `ENOTFOUND`, ...) buried in
`.cause`. `describeNetworkError()` (`src/core/networkError.ts`) surfaces that
code so a human or an agent parsing `--json` can tell "the server is down"
apart from "wrong password" — both otherwise look like generic failures.

```
Could not reach https://auth-center.example.com/auth/token (ECONNREFUSED)
```

## `unhandledRejection` safety net

`src/index.ts` installs a process-level `unhandledRejection` handler that
never dumps the raw error object — only `err.message` if it's an `Error`,
else a generic `"Unexpected error"`. This exists because an unhandled
rejection could otherwise surface a raw response body that included a
header this project doesn't fully control end-to-end; treat this handler as
a last line of defense, not the primary error-handling path (every command
already wraps its own logic in try/catch).
