# T04 — Normalize `auth show` into the `{ ok, code, ... }` envelope

**Type:** Task
**Priority:** High
**Complexity:** S (half day)

## Summary

`auth show`'s JSON output today is the one command that uses a bare
`{ loggedIn }` shape instead of `{ ok, ... }`, an inconsistency spec 06 has
noted and deferred across four prior specs. Spec 12 § 2.1 resolves it:
`auth show` joins the envelope with `loggedIn` kept as a domain field, exit 0
in both the logged-in and not-logged-in states.

## Background & Context

- Spec: `bobby-cli/specs/12-spec-agent-legible-output.md` § 2.1.
- Current implementation: `bobby-cli/src/commands/auth.ts`, function
  `runShow()` (lines ~129–177 as of this writing).

## The exact target shape (copy verbatim)

| State | New shape | Exit |
|---|---|---|
| logged in | `{ ok: true, code: "status", loggedIn: true, email, tenantId, apiTokenLabel, apiTokenId, scopes, createdAt, expiresAt, authCenterUrl, sessionMemoryUrl }` | 0 |
| not logged in | `{ ok: true, code: "status", loggedIn: false, hint: "Run 'bobby-cli auth login' to log in." }` | 0 |

Both states are `ok: true` / exit 0 — "am I logged in?" answered with "no" is
a successfully answered question, not a failure. `code: "status"` is part of
the canonical enum (see T02).

## Exact change

In `bobby-cli/src/commands/auth.ts`, `runShow()`:

- Current not-logged-in branch:
  ```ts
  if (!creds) {
    if (opts.json) {
      printJson({ loggedIn: false });
    } else {
      printInfo("Not logged in. Run `bobby-cli auth login`.");
    }
    return;
  }
  ```
  becomes (JSON branch only — human-mode `printInfo` line stays as-is):
  ```ts
  if (!creds) {
    if (opts.json) {
      printJson({ ok: true, code: "status", loggedIn: false, hint: "Run 'bobby-cli auth login' to log in." });
    } else {
      printInfo("Not logged in. Run `bobby-cli auth login`.");
    }
    return;
  }
  ```

- Current logged-in branch builds a `summary` object and does
  `printJson(summary)` where `summary = { loggedIn: true, email, tenantId, apiTokenLabel, apiTokenId, scopes, createdAt, expiresAt, authCenterUrl, sessionMemoryUrl }`.
  Change the JSON branch to spread `ok: true, code: "status"` alongside the
  existing `summary` fields:
  ```ts
  if (opts.json) {
    printJson({ ok: true, code: "status", ...summary });
  } else {
    // unchanged human-mode printing
  }
  ```
  The human-mode console output (`Email:`, `Tenant:`, etc.) is unchanged —
  this ticket only touches the `--json` branch.

- The error-path catch block in `runShow()` (when `loadCredentials()` throws,
  e.g. a malformed profile name) currently does
  `printJson({ ok: false, error: message })` — this already fits the
  `{ ok: false }` shape and does not need to change for this ticket
  specifically, but per T03's acceptance criterion 8 ("every `ok: false`
  envelope carries a `hint`"), coordinate with whoever lands T03 so this
  catch block also gets a `hint` (a reasonable one here:
  `"Fix the --profile value and try again."`) — if T03 lands first, this is
  already handled; if T04 lands first, add the `hint` here directly rather
  than leaving a gap.

## Acceptance Criteria

1. Given no credentials file exists, when
   `bobby-cli auth show --json` is run, then stdout is exactly
   `{ "ok": true, "code": "status", "loggedIn": false, "hint": "Run 'bobby-cli auth login' to log in." }`
   (formatted with `JSON.stringify(data, null, 2)` per existing convention)
   and exit code is **0**.
2. Given valid credentials exist, when `bobby-cli auth show --json` is run,
   then stdout contains `"ok": true`, `"code": "status"`, `"loggedIn": true`,
   and all of `email`, `tenantId`, `apiTokenLabel`, `apiTokenId`, `scopes`,
   `createdAt`, `expiresAt`, `authCenterUrl`, `sessionMemoryUrl` — and does
   **not** contain the raw API token (`apiToken` field or any string
   starting `sm_live_`) anywhere in the output. Verify with
   `bobby-cli auth show --json | grep sm_live_` returning no match.
3. Given valid credentials exist, when `bobby-cli auth show` (no `--json`)
   is run, then the human-readable output is byte-identical to today's
   output (`Email:`, `Tenant:`, `Token label:`, `Scopes:`, `Created:`,
   `Expires:` lines) — this ticket does not touch human-mode formatting.
4. `npm run build` compiles with no TypeScript errors.

## Dependencies

None strictly required, but sequenced after T01–T03 per the project's
decided implementation order (spec 12 envelope work lands as one connected
unit before spec 13 renderer work begins). Can be implemented in parallel
with T02/T03 if convenient, since it touches only `runShow()`.

## Out of Scope

- `auth login` or `auth forget`'s envelope shapes — those already use
  `{ ok, ... }` and are covered by T03 for the failure-hint addition only.
- Any change to what fields `auth show` exposes beyond adding `ok`/`code`/
  `hint` — the domain fields (`email`, `scopes`, etc.) are unchanged.
- `schema/tools.json`'s `auth_show.output_schema` — that's T06 (which
  depends on this ticket landing first, since the manifest must describe
  the real shape).
