# T03 — Wire failure `code` + `hint` into every command's error envelope

**Type:** Feature
**Priority:** Critical
**Complexity:** M (1–2 days)

## Summary

Every failure envelope (`{ ok: false, ... }`) across `auth login`,
`auth show`, `auth forget`, and all `memory *` commands must gain a stable
`code` (from the canonical enum defined in
`bobby-cli/tickets/T02-memory-outcome-classifier.md`) and a `hint` — one
sentence telling the caller (human or agent) what to do next. This is the
highest-leverage change in spec 12: it's what lets the skill's auth-recovery
and retry-safety prose (multiple paragraphs today) shrink to "follow the
`hint`" (T07). This ticket consumes the `status`/`networkCause`/`scope`
fields T01 added to the error classes.

## Background & Context

- Spec: `bobby-cli/specs/12-spec-agent-legible-output.md` § 2.
- Depends on T01 (`AuthCenterError.status`/`networkCause`, `McpError.status`/
  `networkCause`/`scope` must exist before this ticket can branch on them)
  and T02 (the canonical `code` enum this ticket's failure rows are part of).

## The exact classification table (copy verbatim into the code as comments)

| Situation | `code` | `hint` |
|---|---|---|
| no local credentials (`CliAuthError`), or session-memory answered **401** (`McpError.status === 401`) | `not_logged_in` | `Stop and ask the human to run 'bobby-cli auth login'. If they logged in recently, the auth server may be having an outage — report the error instead of retrying.` |
| auth-center rejected `auth login` credentials (`AuthCenterError.status === 401`, thrown from the `login()` call specifically, during `auth login`) | `login_failed` | `Login was rejected — check the email and password and try again.` |
| scope denied — `McpError.scope` is set (see T01), or `AuthCenterError.status === 403` | `permission_denied` | `This identity does not have permission for this operation. Tell the user and suggest they contact the owner — do not retry or switch identities.` |
| network-level failure (`.networkCause` set, i.e. `ECONNREFUSED`, DNS, …) on either error class | `network` | `The server is unreachable — check connectivity or report it; do not retry writes.` |
| server rejected the request with any other non-2xx status not covered above | `server` | `Report this error verbatim. Do not retry writes — duplicate detection makes blind retries create duplicates.` |
| **fallback:** `McpError`/`AuthCenterError` with **neither** `status` nor `networkCause` set — a real, reachable state: `Empty MCP response`, a JSON-RPC `error` object, and a tool-level `isError` all arrive over HTTP 2xx | `server` | same `server` hint as above |
| bad local input — commander's own validation (unknown flag, missing required arg) **or** a check commander cannot express (`CliUsageError`: invalid `--profile` name, non-numeric `-n`) | `usage` | commander's message unchanged; for `CliUsageError`, the CLI's own one-line message — do not invent extra wording |

**Amendment (2026-08-04) — two corrections found in review:**

1. **`isError` was an unhandled third outcome.** MCP reports tool-level
   failures as HTTP 200 + JSON-RPC `result` with `isError: true`, not as a
   status code and not as an `error` member. `mcpClient.ts` read neither, so
   every such failure was returned as ordinary result text and the envelope
   said `ok: true` with `code: "unclassified"` and exit 0 — an agent reading
   `ok` saw success. It now throws `McpError` (no status, no networkCause →
   the fallback row above → `server`). The `Requires scope:` check runs
   **first**, but as defence in depth only: no Worker scope guard sets
   `isError` today (`session-memory/src/index.ts:641/719/798/907/984`), so
   denials never reach the new branch. The ordering preserves
   `permission_denied` if that ever changes.
2. **`usage` was not applied consistently.** `resolveCredentialsPath` threw a
   bare `Error` for an invalid `--profile` name, leaving each call site to
   guess: `auth show`/`auth forget` classified it `usage`, `memory *` and
   `auth login` classified it `server` — so the same typo produced two
   different codes, and the `server` hint told agents to report an outage
   and not retry. The throw is now a `CliUsageError`, and **every** command
   classifies through one shared path rather than per-call-site `instanceof`
   chains: `failureEnvelope()`/`emitFailure()` in `src/commands/auth.ts` and
   the `callTool` catch in `src/commands/memory.ts`. Unrecognised errors
   fall through to `server` — they are never rethrown, because an error that
   escapes a command produces no envelope at all under `--json` (found in
   review: EACCES on a locked `~/.bobby-cli` printed a bare stderr line and
   left stdout empty, violating § "every failure carries a hint").
   Non-numeric `-n` is validated locally for the same reason; previously
   `parseInt("abc")` → `NaN` → serialised as `null` → rejected by the
   Worker's zod schema, turning bad local input into a `server` failure.
   The check is `/^\d+$/` before `Number()`, so `1e3` and `0x10` are
   rejected rather than silently accepted as 1000 and 16.

**Critical distinction:** a 401 from session-memory (`McpError.status === 401`)
is `not_logged_in`, but a 401 from auth-center *specifically during
`auth login`* is `login_failed` — same status code, different transport and
different moment, different code and different hint (the `not_logged_in`
hint — "run `auth login`" — would be circular advice in the middle of a
login attempt). Implement this as a per-call-site distinction, not a
status-only lookup table: the classification function must take the error
class *and* which command/call site threw it (or, simpler, `runLogin()` in
`auth.ts` catches `AuthCenterError` and maps 401 to `login_failed` locally,
while every other `AuthCenterError`/`McpError` catch site uses a shared
classifier that maps `AuthCenterError` 401→ nothing special (falls to
`server`) since only login's 401 has the `login_failed` meaning — auth-center
401s outside login are not a defined case in this table; treat as `server`
if encountered outside login, and note this explicitly with a code comment,
since spec 12 only defines the login-time 401).

## Implementation approach

Add a shared classifier, e.g. `bobby-cli/src/core/classifyFailure.ts`:

```ts
export interface Failure { code: string; error: string; hint: string; }

export function classifyMcpFailure(err: McpError): Failure { ... }
export function classifyAuthCenterFailure(err: AuthCenterError, context: "login" | "other"): Failure { ... }
export function classifyCliAuthFailure(err: CliAuthError): Failure { ... }
```

Wire into:

- `bobby-cli/src/commands/memory.ts`: `callTool()`'s catch block currently
  does `if (err instanceof CliAuthError || err instanceof McpError) return { ok: false, error: err.message };` —
  change to route through the classifier and return
  `{ ok: false, code, error: err.message, hint }`. `emit()` must print the
  `hint` after the error line in human (non-`--json`) mode too (spec 12 §2:
  "Human mode prints the same hint after the error line").

  **Two more pre-existing `{ ok: false }` sites in `memory.ts` that are NOT
  in the classifier path — this ticket must cover them explicitly** (they
  would otherwise silently break "every `ok: false` carries a `hint`"):
  1. the generic-`Error` fallback in the same catch block (~line 29 today —
     reached e.g. on an invalid `--profile` name): give it
     `code: "server"` + the `server` hint (it represents an unexpected
     internal failure, not bad argv);
  2. the local pre-flight emit `No content given (pass text or pipe via
     stdin).` (~line 119 today, `memory remember` with no input): give it
     `code: "usage"` and reuse its own message as the `hint`.
- `bobby-cli/src/commands/auth.ts`: `runLogin()`'s catch block (currently
  `printJson({ ok: false, error: message })`) — add `code`/`hint`, using
  `context: "login"` so a 401 there maps to `login_failed`. `runShow()` and
  `runForget()`'s catch blocks (currently catching a generic error from
  `loadCredentials`/`deleteCredentials`, which today can only throw a plain
  `Error`, not `CliAuthError` — check whether these code paths can realistically
  throw `CliAuthError`/`AuthCenterError`; if not, these two catch blocks stay
  generic but should still add `code: "usage"` or a suitable fallback rather
  than leaving `code` absent, to keep "every `ok: false` envelope carries a
  `hint`" true without exceptions per spec 12 §2.1).
- `bobby-cli/src/index.ts`: commander's own usage errors (unknown flag,
  missing required argument) — **verify, don't assume** (spec 12 success
  criterion 6a): run `bobby-cli memory recall --json` (missing required
  `<query>`) and `bobby-cli memory bogus-subcommand --json` and observe
  whether commander's default error handling writes plain text to stderr
  and exits before any of this repo's `--json` handling runs. If so, this
  ticket must configure commander (e.g. `.exitOverride()` and/or a custom
  `outputConfiguration`) so that under `--json`, usage errors also emit
  `{ ok: false, code: "usage", error: "<commander's message>", hint: "<commander's message>" }`
  on stdout with exit code 1, instead of commander's raw stderr text.

## Live-test safety (read BEFORE running any live AC)

`src/core/config.ts:21–22` bakes the **real production** URLs
(`*.phantaporntr.workers.dev`) as fallback defaults. A fresh machine with no
env/.env therefore points live tests at production. Standing project rule:
never touch production (deploys and traffic there are manual-only per
`PRODUCTION-UPDATES.md`).

- Before ANY live AC below: `export AUTH_CENTER` and `SESSION_MEMORY_URL`
  to the **test deployment** (`https://auth-center.tanaphat-jaroonrueang.workers.dev`
  and `https://second-brain.tanaphat-jaroonrueang.workers.dev/mcp`; see
  `.env.example`).
- Never edit `~/.bobby-cli/credentials.json` (the machine's real login).
  For scratch credentials use a named profile: run with `--profile <name>`
  (file lives at `~/.bobby-cli/profiles/<name>.json`, or point
  `BOBBY_CLI_PROFILES_DIR` at a temp dir). Delete scratch profiles when
  done.
- Never print a raw `sm_live_*` token to stdout/stderr or paste one into a
  transcript — write it straight to the scratch profile file.

**How to get the `memory:read`-only token for AC3/AC4** (there is no CLI
path — `auth login` hardcodes all three scopes, `authClient.ts:82`):
1. Obtain a session token: `POST $AUTH_CENTER/auth/token` with
   `{email, password}` (run this yourself in a private terminal — the
   password must not enter any transcript).
2. Mint: `POST $AUTH_CENTER/auth/tokens` with header
   `Authorization: Bearer <session>` and body
   `{"label": "t03-readonly-test", "scopes": ["memory:read"]}` → response
   contains `rawToken` and `token.id`.
3. Write a scratch profile JSON (field names per the `Credentials`
   interface in `src/core/config.ts`) containing that `rawToken` and the
   test-deployment URLs; run the ACs with `--profile t03test`.
4. Afterward: revoke via `DELETE $AUTH_CENTER/auth/tokens/<token.id>`
   (same session Bearer) and delete the profile file.

## Acceptance Criteria

1. Given no `~/.bobby-cli/credentials.json` exists, when
   `bobby-cli memory show --json` is run, then output is
   `{ ok: false, code: "not_logged_in", error: "...", hint: "Stop and ask the human to run 'bobby-cli auth login'..." }`
   and exit code is 1.
2. Given valid credentials but the session-memory Worker returns 401 (e.g.
   test by pointing `SESSION_MEMORY_URL` at a URL that answers 401, or by
   using a deliberately invalid/expired token in a scratch credentials
   file), when any `memory *` command runs with `--json`, then `code` is
   `"not_logged_in"`.
3. Given a scoped token holding `memory:read` but not `memory:write`
   (minted per "Live-test safety" above, against the test deployment), when
   `bobby-cli memory remember 'x' --profile t03test --json` is run, then output is
   `{ ok: false, code: "permission_denied", scope: "memory:write", error: "...", hint: "This identity does not have permission..." }`
   and exit code is 1. **This must be exercised against a real scoped
   token, not simulated** — this is spec 12 success criterion 2's explicit
   requirement, since the 200-with-text shape is exactly what the original
   2026-07-15 review missed.
4. Given the same scoped token, when
   `bobby-cli memory show --json` (a read-only op) is run, then it succeeds
   normally (`ok: true`) — confirms scope denial is scope-specific, not a
   broken-token false positive.
5. Given `SESSION_MEMORY_URL` points at an unreachable host, when any
   `memory *` command runs with `--json`, then `code` is `"network"`.
6. Given a wrong-password `auth login` (non-interactive: prefer
   `BOBBY_CLI_EMAIL`/`BOBBY_CLI_PASSWORD` env vars over the existing
   `--email`/`--password` flags — argv is visible in the process list;
   either path works, `auth.ts:39–41`) against the **test** auth-center
   (per "Live-test safety"; never production), when run with `--json`,
   then output is
   `{ ok: false, code: "login_failed", error: "...", hint: "Login was rejected..." }`,
   NOT `code: "not_logged_in"`.
7. Given `bobby-cli memory recall --json` (missing required `<query>`
   argument), when run, then stdout contains a single JSON object with
   `ok: false`, `code: "usage"`, and exit code is 1 — verify this is
   actually true today by running it before assuming commander's default
   behavior already satisfies this (per spec 12 success criterion 6a).
8. Given any `ok: false` envelope the CLI can produce, then it always has a
   non-empty `hint` field — grep the **entire `src/` tree** (not just the
   diff) for every `{ ok: false` construction site and confirm none omits
   `hint`; pre-existing sites not touched by the diff (see the two
   `memory.ts` sites called out above) count and must be fixed here.
9. Human (non-`--json`) mode: given the same `not_logged_in` case as
   criterion 1 but without `--json`, when run, then the hint text is printed
   to the console after the error line.
10. `npm run build` compiles with no TypeScript errors.

## Dependencies

Depends on T01 (error class fields) and T02 (canonical code enum) landing
first.

## Out of Scope

- `auth show`'s envelope shape — that's T04 (though `auth show`'s
  not-logged-in state does carry a `hint` per spec 12 §2.1, implemented
  there, not here).
- `schema/tools.json` updates — T06.
- Changing `duplicate_rejected`/`not_found` to `ok: false` — explicitly
  deferred (spec 12 open question 1).
