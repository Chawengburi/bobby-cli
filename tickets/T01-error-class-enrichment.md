# T01 — Enrich error classes with `status`/`networkCause`, fix mcpClient status handling, detect scope-denial text

**Type:** Task
**Priority:** Critical
**Complexity:** M (1–2 days)

## Summary

`AuthCenterError`, `McpError`, and `CliAuthError` (`bobby-cli/src/core/authClient.ts`,
`bobby-cli/src/core/mcpClient.ts`, `bobby-cli/src/core/config.ts`) today are plain
`Error` subclasses carrying only a message string. Spec 12 §2 requires every
failure envelope to carry a stable `code` + a `hint`, and classification is
**per (transport, status)** — which requires the error classes to actually
carry the HTTP status (or network-error cause) that produced them, and
requires `mcpClient.ts` to inspect the `tools/call` response status (it
doesn't today) and to attach `status` to the (unchanged) 401/403 branch at
`initialize`. This ticket is the plumbing layer; T03 consumes these fields to
build the `code`/`hint` envelope. This ticket does NOT itself add `code` or
`hint` to any command's JSON output — see Out of Scope.

This is a **transport-layer** ticket, scoped honestly per a 2026-07-17 review
finding (N4): it is "enrich error classes + propagate status + text-based
permission detection," not "map every status to a code" (that mapping is
T03's job).

## Background & Context

- Spec: `bobby-cli/specs/12-spec-agent-legible-output.md` § 2 ("Prerequisite
  (amends spec 06)") and the per-(transport, status) classification rules.
- Spec: `bobby-cli/specs/06-spec-output-conventions.md` § "Error taxonomy"
  (already amended to describe the target shape — this ticket implements it).
- Session record: `docs/sessions/SESSION-2026-07-17.md`, finding **N4**:
  "`mcpClient` must be fixed beyond 'map status' — it doesn't inspect the
  status of `tools/call` and has no `status`/`cause` fields today."
- Session record, finding **B1**: a `memory:read`-only token driving
  `tools/call remember` gets **HTTP 200** with JSON-RPC result text
  `Requires scope: memory:write` — verified live 2026-07-17 against the test
  deployment. The session-memory Worker's `/mcp` endpoint **never returns 403
  to the CLI**; scope denial is a 200 whose tool-result text starts with
  `Requires scope: `. 401 is returned for every token problem (missing,
  invalid, inactive, wrong resource) — confirmed against
  `session-memory/src/index.ts:89–138` (the `authenticate()` function).

## Current code (read before editing)

`bobby-cli/src/core/mcpClient.ts` (relevant excerpt, lines 78–104 today):

```ts
if (initRes.status === 401 || initRes.status === 403) {
  throw new McpError(
    "Not authorized — your session may have expired. Run `bobby-cli auth login` again."
  );
}
if (!initRes.ok) {
  throw new McpError(`MCP init failed: HTTP ${initRes.status}`);
}
...
const toolRes = await post(...);
if (!toolRes.ok) {
  throw new McpError(`MCP error calling ${toolName}: HTTP ${toolRes.status}`);
}
const msg = await readJsonRpc(toolRes);
if (!msg) throw new McpError("Empty MCP response");
if (msg.error) throw new McpError(msg.error.message);
return msg.result?.content?.map((c) => c.text).join("") ?? "";
```

Problems this ticket fixes:
1. `initialize`'s 401/403 branch never sets a `status` field anywhere
   (there is no field to set — `McpError` has none); its message strings
   stay byte-identical, per § 1 below.
2. `tools/call`'s response status (`toolRes.status`) is read only for the
   `!toolRes.ok` branch's message string — never stored.
3. Nothing ever inspects the **successful** (`toolRes.ok === true`) tool-call
   result text for the `Requires scope: ` prefix — a scope denial currently
   returns to the caller (`src/commands/memory.ts`'s `callTool`) as an
   ordinary `{ ok: true, text: "Requires scope: memory:write" }`, exactly the
   misread B1 flagged.

`bobby-cli/src/core/authClient.ts` — `AuthCenterError` is thrown from `login`,
`mintApiToken`, `listApiTokens`, `rotateApiToken`, each already having the
`Response` object in scope when it throws on `!res.ok`, but discarding
`res.status`.

`bobby-cli/src/core/config.ts` — `CliAuthError` is thrown only from
`requireCredentials()` when no credentials file exists; per spec 12 §2 this
class deliberately gets **no** `status`/`networkCause` fields (the class
itself is the signal — "no local credentials").

## Exact changes required

### 1. `bobby-cli/src/core/mcpClient.ts`

- Change the `McpError` class to carry optional structured fields:

  ```ts
  export class McpError extends Error {
    status?: number;
    networkCause?: string; // network-error code from describeNetworkError(), e.g. "ECONNREFUSED"
    scope?: string;        // set only when this error represents a scope-denial (see below)
    constructor(message: string, opts?: { status?: number; networkCause?: string; scope?: string }) {
      super(message);
      this.status = opts?.status;
      this.networkCause = opts?.networkCause;
      this.scope = opts?.scope;
    }
  }
  ```

  **Field name is decided: `networkCause`** (not `cause`) —
  `Error.prototype.cause` is a reserved standard property with different
  semantics (the `ErrorOptions.cause` chain); reusing the name risks
  colliding with `Error`'s own behavior or a future `{ cause: err }`
  construction elsewhere in the codebase. Use `networkCause` consistently
  across this file, `authClient.ts`, and T03's consumption of it.
  **Spec sync (required, same change):** spec 06 § "Error taxonomy" and
  spec 12 § 2 currently document this field as `cause?: string` — update
  both spec passages to `networkCause?: string` in the same change, so the
  documents this ticket set treats as byte-exact source of truth describe
  the field that actually exists (see AC10).

- Network-level failures (the existing `catch (err)` in the `post` helper)
  set the cause field:

  ```ts
  } catch (err) {
    throw new McpError(describeNetworkError(err, sessionMemoryUrl), {
      networkCause: networkErrorCode(err), // see note below
    });
  }
  ```

  `describeNetworkError()` (`bobby-cli/src/core/networkError.ts`) today
  returns a formatted message string, not a bare code. Check its
  implementation: if it doesn't already expose the bare code (`ECONNREFUSED`
  etc.) separately, add a small export (e.g. `networkErrorCode(err): string
  | undefined`) that returns just the code, and use both — the message for
  `.message` (unchanged), the code for the new field. Do not change
  `describeNetworkError()`'s existing return shape/signature; callers of it
  elsewhere in the codebase must keep working unmodified.

- `initialize`'s status handling: **keep both existing branches and their
  message strings byte-identical** — this ticket must not change any
  user-visible text (AC9; spec 12 success criterion 1 keeps `text`/`error`
  unchanged until T03 lands). The only change is attaching `status` to each
  throw:

  ```ts
  if (initRes.status === 401 || initRes.status === 403) {
    throw new McpError(
      "Not authorized — your session may have expired. Run `bobby-cli auth login` again.",
      { status: initRes.status }
    );
  }
  if (!initRes.ok) {
    throw new McpError(`MCP init failed: HTTP ${initRes.status}`, { status: initRes.status });
  }
  ```

  (Per the verified behavior above, `/mcp` only ever returns 401 for auth
  problems today; the 401/403 branch stays as-is defensively. T03 — not
  this file — is responsible for turning `status` into the right
  `code`/`hint` and for any message-wording changes.)

- `tools/call`'s status handling — same pattern, set `status`:

  ```ts
  if (!toolRes.ok) {
    throw new McpError(`MCP error calling ${toolName}: HTTP ${toolRes.status}`, { status: toolRes.status });
  }
  ```

- **Scope-denial text detection** (this is the "text-based permission
  detection" N4 calls out as part of this ticket, and implements the ONE
  row of spec 12 §1.1 that flips `ok`): after a successful `tools/call`
  response is parsed into `text` (the existing
  `msg.result?.content?.map((c) => c.text).join("")` line), check whether
  it matches the exact pattern `/^Requires scope: (.+)$/`. If it matches,
  throw a distinguishable error instead of returning the text as a normal
  success:

  ```ts
  const text = msg.result?.content?.map((c) => c.text).join("") ?? "";
  const scopeMatch = /^Requires scope: (.+)$/.exec(text);
  if (scopeMatch) {
    throw new McpError(text, { scope: scopeMatch[1] });
  }
  return text;
  ```

  Match on the **exact prefix string** `Requires scope: ` — this is the
  literal string emitted by `session-memory/src/index.ts` at every scope
  gate (verified live 2026-07-17). Do not loosen the match (e.g. `.includes`
  on a shorter substring) — an unmatched future Worker string must fall
  through as an ordinary successful `text`, not be silently swallowed.

### 2. `bobby-cli/src/core/authClient.ts`

- Add `status?: number` and `networkCause?: string` to `AuthCenterError`,
  same constructor pattern as `McpError`.
- Every `throw new AuthCenterError(...)` call site in this file (in `login`,
  `mintApiToken`, `listApiTokens`, `rotateApiToken`) that follows a
  `!res.ok` check must pass `{ status: res.status }`.
- Every `throw new AuthCenterError(...)` call site inside a `catch (err)`
  block (network failure) must pass `{ networkCause: networkErrorCode(err) }`.

### 3. `bobby-cli/src/core/config.ts`

- No field changes to `CliAuthError` — leave it as a plain `Error` subclass.
  Add a one-line comment above the class stating this is deliberate (per
  spec 12 §2: "no local credentials" needs no status/cause, the class itself
  is the signal) so a future editor doesn't "fix" the asymmetry.

### 4. `bobby-cli/src/core/networkError.ts`

- If `describeNetworkError()` doesn't already let a caller retrieve the bare
  error code, add the minimal export needed by steps 1–2 above without
  changing its existing exported function's signature or behavior.

## Acceptance Criteria

1. Given a `session-memory` request that never leaves the machine (server
   unreachable), when `mcpToolCall()` throws, then the thrown `McpError` has
   its network-cause field set to a non-empty string and `status` is
   `undefined`.
2. Given `initialize` responds with HTTP 401, when `mcpToolCall()` throws,
   then the thrown `McpError.status === 401`.
3. Given `tools/call` responds with a non-2xx HTTP status, when
   `mcpToolCall()` throws, then the thrown `McpError.status` equals that
   status code (this is new — today nothing reads `toolRes.status` beyond
   the message string).
4. Given `tools/call` responds HTTP 200 with JSON-RPC result text exactly
   `Requires scope: memory:write`, when `mcpToolCall()` runs, then it throws
   an `McpError` (not a normal return) whose `.scope === "memory:write"` and
   whose `.message` contains the original text.
5. Given `tools/call` responds HTTP 200 with JSON-RPC result text that does
   NOT start with `Requires scope: ` (e.g. `Stored. ID: mem_123`), when
   `mcpToolCall()` runs, then it returns the text normally (no throw) —
   verify this explicitly since it's the regression risk of step 4.
6. Given `auth-center`'s `/auth/token` responds with a non-2xx status during
   `login()`, when the call throws, then the thrown `AuthCenterError.status`
   equals that status code.
7. Given `requireCredentials()` throws because no credentials file exists,
   then the thrown `CliAuthError` has no `status`/`networkCause` field set
   (still a plain message).
8. `npm run build` in `bobby-cli/` compiles with no TypeScript errors.
9. Manual verification (no test framework exists in this repo today — see
   `bobby-cli/package.json`, no `test` script): run
   `bobby-cli memory recall test -n 1 --json` against a stopped/unreachable
   `SESSION_MEMORY_URL` and confirm the process doesn't crash (the
   `unhandledRejection` handler in `src/index.ts` must still only print
   `.message` — this ticket must not change what reaches stdout/stderr, only
   what's attached to the in-memory error object before T03 consumes it).
10. Spec sync: `bobby-cli/specs/06-spec-output-conventions.md` § "Error
    taxonomy" and `bobby-cli/specs/12-spec-agent-legible-output.md` § 2 both
    say `cause?: string` — both passages are updated to
    `networkCause?: string` in this same change (rationale: avoid the
    reserved `Error.prototype.cause`).

## Dependencies

None — this is the first ticket in implementation order. T02, T03, T04
depend on this landing first (T03 directly consumes the new fields; T02's
success-code classifier is independent of this ticket's error-path changes
but is sequenced after it per the project's decided order).

## Out of Scope

- Adding `code`/`hint` to any command's JSON output — that's T03.
- Mapping every possible HTTP status to a specific failure `code` — that
  mapping table lives in T03.
- Changing `auth show`'s output shape — that's T04.
- Changing what `printError`/`emit()` print to the human-mode console — this
  ticket only changes what the thrown `Error` objects carry internally.
- The session-memory Worker itself — this ticket only changes how the CLI
  reads the Worker's existing responses.
