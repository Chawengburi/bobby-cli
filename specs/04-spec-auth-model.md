# 04 Spec: Auth Model

> Why a fresh-process-per-invocation CLI instead of an MCP client:
> [01](./01-spec-motivation-architecture.md)
> Token issuance contract: [auth-center/specs/05-spec-token-api.md](../../auth-center/specs/05-spec-token-api.md)

## Two-tier token flow

```
1. POST /auth/token   { email, password }                    -> short-lived Better Auth session token
2. POST /auth/tokens  { label, resource, scopes }             -> sm_live_... API token (shown once)
   (Authorization: Bearer <session token from step 1>)
```

Implemented in `src/authClient.ts` (`login`, `mintApiToken`). Step 2 always
requests a fixed scope set: `["memory:read", "memory:write",
"memory:delete"]`, and `resource: "session-memory"`.

The session token from step 1 is used exactly once, in-memory, to mint the
API token — it is never persisted to disk. Only the resulting
`sm_live_...` API token is written to the credential file.

`memory` commands never touch `/auth/*` again after login — they call
session-memory's `/mcp` endpoint directly (`src/mcpClient.ts`), Bearer-
authenticated with the cached API token. session-memory introspects that
token against `auth-center` itself (see
[session-memory/specs/02-spec-auth-center.md](../../session-memory/specs/02-spec-auth-center.md)),
KV-cached for 300s on that side — bobby-cli has no client-side cache of its
own to invalidate.

## Token labeling

Each login mints a token labeled `bobby-cli@<hostname>` (Node's
`os.hostname()`). This exists specifically so a second machine's login
doesn't silently collide with — in the sense of being confused for — a
first machine's token in `auth show`'s output or in `auth-center`'s token
list. It does **not** prevent the collision described below; it only makes
the resulting symptom attributable to a specific machine after the fact.

## Known risk: one active token per `(principal, resource)`

`auth-center` currently allows only **one active `sm_live_...` token per
`(principal_id, resource)`** — minting a new one revokes the previous one
for that same principal+resource, silently, with no confirmation prompt
anywhere in the chain.

This means: **running `bobby-cli auth login` as a given user can silently
revoke a different active session for that same user** — e.g. a web-UI
"create new key" action, or (per the incident this was first noticed from)
openClaw's DM session token — because they resolve to the same
`(principal_id, resource)` pair under today's rule.

This is not hypothetical — it is exactly the failure documented in
[session-memory/specs/09-spec-discord-actor.md § REJECTED (2026-07-09)](../../session-memory/specs/09-spec-discord-actor.md)
and [auth-center/tickets/03-personal-api-token.md § Amended (2026-07-09)](../../auth-center/tickets/03-personal-api-token.md).
The fix is scoped as an `auth-center` schema/behavior change (allow multiple
simultaneous named active tokens per **user** principal, GitHub/GitLab-PAT
style; the existing single-active-token rule stays as-is for **machine**
principals) — not something bobby-cli can work around unilaterally. Tracked
in [07](./07-spec-roadmap-open-questions.md).

**Until that lands:** treat `bobby-cli auth login` as potentially disruptive
to any other active session for the same account, not as a purely additive,
side-effect-free action. This is worth surfacing to whoever runs it — see
the open question in [07](./07-spec-roadmap-open-questions.md) about whether
`auth login` should warn about this explicitly before proceeding.

## Credential storage

```
~/.bobby-cli/
└── credentials.json   (mode 0600, directory mode 0700)
```

Contents (`src/config.ts`'s `Credentials` interface):

```ts
{
  authCenterUrl: string;
  sessionMemoryUrl: string;
  email: string;
  tenantId: string | null;
  apiToken: string;        // the raw sm_live_... token
  apiTokenId: string;
  apiTokenLabel: string;   // "bobby-cli@<hostname>"
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
}
```

This file is plain JSON on disk, not OS-keychain-backed — a deliberate v1
scope cut, not an oversight; see [07](./07-spec-roadmap-open-questions.md)
for the tradeoff against `gh`'s keyring-with-file-fallback model.

### Cross-platform note (Windows): `mode 0600`/`0700` is a no-op there

`os.homedir()` and `path.join()` (used to build `~/.bobby-cli/...`) are
fully cross-platform — verified no Windows/Linux path-separator or
home-directory-resolution issue exists. **The `mode: 0o600`/`0o700` passed
to `writeFileSync`/`mkdirSync` is a different story:** per Node.js's own
`fs` documentation, file mode bits are a POSIX/Unix concept — Windows uses
NTFS ACLs instead, and Node does not translate owner/group/other permission
bits there. In practice, on Windows the credential file ends up protected
only by whatever NTFS ACL already applies to the user's profile folder by
default (normally sufficient to keep other non-admin accounts out) — **not**
by anything bobby-cli itself enforces on that platform, unlike on
macOS/Linux where `0600` is an explicit, verifiable guarantee. This doesn't
break anything (no crash, no wrong path), but the security property
documented here and in [06](./06-spec-output-conventions.md) ("mode 0600 —
only owner can read") is **POSIX-only in practice**. This is the concrete
reason the keychain-storage option in
[07-spec-roadmap-open-questions.md § 1](./07-spec-roadmap-open-questions.md)
is worth taking seriously rather than deferring indefinitely: OS keychains
(Keychain/Credential Manager/Secret Service) give the same real access
control on every platform, where file `mode` bits don't.

`auth forget` deletes this file but does **not** call
`DELETE /auth/tokens/:id` — the token remains valid server-side until it is
separately revoked (via the web UI, or a future `auth logout --revoke`; see
[07](./07-spec-roadmap-open-questions.md)).

## What bobby-cli's shape does and doesn't solve

Re-stating the split from [01](./01-spec-motivation-architecture.md) in
auth-specific terms:

| Problem | Status |
|---|---|
| MCP static config can't carry a per-call/per-user token | **Solved** by not being an MCP client — each invocation reads the credential file fresh |
| Raw token reaching an agent's context window / stdout | **Solved** — never printed, see [06](./06-spec-output-conventions.md) |
| Sidecar-style cross-request race conditions | **Solved** — no shared mutable state between invocations |
| One-active-token-per-principal silently revoking other sessions | **Not solved by bobby-cli** — depends on the `auth-center` multi-token migration; see above |
