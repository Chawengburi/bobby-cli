# 08 Spec: Shared Auth/Session-Memory Core

> Decision context: [01-spec-motivation-architecture.md § Decision (2026-07-09)](./01-spec-motivation-architecture.md#decision-2026-07-09-agent-integration-stays-cli-first-no-shared-mcp-server)

## Goal

Today, `auth-center` login and `session-memory` access logic lives entirely
inside bobby-cli. The next tool that needs either (an uploader CLI, a
tool-schema-driven executor, anything else behind `auth-center`) would
otherwise reimplement credential storage, the two-tier token flow, and the
MCP JSON-RPC client from scratch. This spec extracts that logic into its own
module so it's written once and reused, matching the "other tools in the
future that require authorization from the auth center" requirement.

## What moves

These four files are already CLI-agnostic — none of them import `commander`,
`inquirer`, or `chalk`, and none of them touch `process.exitCode` or print
anything:

| File | Contents | Reusable as-is? |
|---|---|---|
| `src/config.ts` | Credential file read/write, URL resolution precedence | Yes — no changes needed |
| `src/authClient.ts` | `login()`, `mintApiToken()` — the two-tier token flow | Yes |
| `src/mcpClient.ts` | `mcpToolCall()` — JSON-RPC client against session-memory's `/mcp` | Yes |
| `src/networkError.ts` | `describeNetworkError()` | Yes |

**What does *not* move:** `src/output.ts` (`printJson`/`printSuccess`/
`printError`/`printInfo`) stays in bobby-cli. It's presentation-layer —
chalk colors, human-vs-JSON formatting, exit-code side effects — and a
non-CLI consumer (a tool-schema executor, a future service) wants structured
return values or thrown errors, not colored strings.

## Proposed structure (v1 — internal module, not a separate package yet)

```
bobby-cli/src/
  core/
    config.ts        (moved, unchanged)
    authClient.ts     (moved, unchanged)
    mcpClient.ts      (moved, unchanged)
    networkError.ts   (moved, unchanged)
    index.ts          (barrel: re-export the above)
  commands/
    auth.ts           (import from "../core/index.js" instead of "../config.js" etc.)
    memory.ts         (same)
  output.ts           (unchanged, stays CLI-specific)
  index.ts            (unchanged)
```

Only import paths change in `commands/auth.ts` and `commands/memory.ts` —
no logic changes. This is a pure move-and-rewire refactor.

### Why an internal module, not a published package, yet

A separate published package (`@chawengburi/auth-client` or similar) is the
obvious end state once a second real consumer exists — but publishing one
today, with zero other consumers, means carrying version/release overhead
(the same publish ceremony `DEVELOPMENT.md` documents for bobby-cli itself)
for a package nothing else depends on. `src/core/` gets the boundary right
now — no `commands/*` file reaches into credential/token/MCP logic directly
— so promoting it later is a mechanical extraction (move the folder, add a
`package.json`, point bobby-cli's `package.json` at it), not a redesign.

**Flag if this default is wrong:** if a second consumer is already planned
concretely (not hypothetical), it may be worth publishing the package now
instead of doing this move twice. Not assumed here — ask before skipping
straight to a published package.

## Migration steps

1. Create `bobby-cli/src/core/`, move the four files in, add `index.ts`
   barrel export.
2. Update imports in `src/commands/auth.ts` and `src/commands/memory.ts`
   from `../config.js` / `../authClient.js` / `../mcpClient.js` to
   `../core/index.js` (or direct file paths under `../core/`).
3. `npm run build` — should produce an identical `dist/` behaviorally
   (different file layout under `dist/core/`, same runtime behavior).
4. Run the existing manual smoke test from `DEVELOPMENT.md` Part 1 step 4
   (`node dist/index.js --help`, `auth show`) to confirm nothing broke.
5. No version bump / no publish — this is an internal reorganization, not a
   behavior or interface change for bobby-cli's own consumers.

## Acceptance criteria

- [x] `src/core/` contains `config.ts`, `authClient.ts`, `mcpClient.ts`,
      `networkError.ts`, `index.ts` — content identical to the pre-move
      versions except import paths — verified byte-identical via `git diff`
      by independent sub-agent review (2026-07-09)
- [x] `src/commands/auth.ts` and `src/commands/memory.ts` no longer import
      directly from `../config.js`, `../authClient.js`, or `../mcpClient.js`
      — confirmed via repo-wide grep, zero matches outside `src/core/`
- [x] `npm run build` succeeds with no type errors — confirmed twice
      independently (once during implementation, once during review, both
      from a clean `rm -rf dist`)
- [x] `auth show` (both human and `--json` mode) verified live against the
      real credentials file on this machine, behaves identically to
      pre-move and prints no raw token. `auth login`, `auth forget`, and the
      `memory` subcommands were deliberately **not** exercised live (they'd
      mutate real state / hit the live backend) — their behavior-preservation
      rests on the byte-identical source confirmation above, not a live run
- [x] No new files under `src/commands/` or `src/output.ts` import from
      `../core/` in a way that reintroduces CLI-specific concerns (chalk,
      inquirer, commander) into `src/core/` — confirmed by inspection
