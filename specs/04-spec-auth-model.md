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

## Former risk: one active token per `(principal, resource)` — fixed for user principals (confirmed shipped 2026-07-09)

`auth-center` used to allow only **one active `sm_live_...` token per
`(principal_id, resource)`** — minting a new one revoked the previous one
for that same principal+resource, silently, with no confirmation prompt
anywhere in the chain. That was the failure documented in
[session-memory/specs/09-spec-discord-actor.md § REJECTED (2026-07-09)](../../session-memory/specs/09-spec-discord-actor.md).

**Confirmed shipped, not just planned** — verified directly against
`auth-center`'s code, not just its tickets: migration
`005-multi-active-user-token.sql` replaces the old global unique index with
one scoped to `WHERE status='active' AND principal_type='machine'`, and
`createApiToken()` in `src/auth.ts` takes a `revokeExisting` flag that
`POST /auth/tokens` (the endpoint `bobby-cli auth login` calls) and the web
UI's token-creation paths already call with `revokeExisting: false`. See
[auth-center/tickets/03-personal-api-token.md § Amended (2026-07-09)](../../auth-center/tickets/03-personal-api-token.md)
for the decision record.

**Current behavior:** for **user** principals (which includes every Discord
user minted via [10-spec-credential-profiles.md](./10-spec-credential-profiles.md)'s
`--profile`), multiple simultaneously-active, independently-labeled tokens
per `(principal_id, resource)` are now supported, GitHub/GitLab-PAT style —
running `bobby-cli auth login` no longer revokes a web-UI session, an
openClaw DM token, or another machine's `bobby-cli` login for the same
account. **Machine principals are unchanged** — still hard-capped at one
active token per resource, using the old rotate-on-create semantics — so
this risk still applies exactly as described above for any bobby-cli login
performed as a machine/service account rather than a human/Discord-user
account.

**Token accumulation — resolved by rotate-by-label (2026-07-13):** since
`revokeExisting: false` became the default for user-principal logins,
running `bobby-cli auth login` twice on the same machine used to mint an
additional identically-labeled token alongside the old one. `auth login`
now first lists the account's active session-memory tokens
(`GET /auth/tokens`) and, if one with the exact same label exists, rotates
it (`POST /auth/tokens/:id/rotate`) instead of minting — so re-login
replaces the token, GitHub-PAT style, and never touches tokens with other
labels. The label defaults to `bobby-cli@<hostname>` and can be overridden
with `--label` (openClaw passes `discord-dm-<id>` per Discord user so each
profile rotates only its own token). Implemented entirely client-side with
existing auth-center endpoints; see [03](./03-spec-commands.md).

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
| One-active-token-per-principal silently revoking other sessions | **Fixed in `auth-center`, not bobby-cli** (confirmed shipped 2026-07-09) — for **user** principals only; still applies to **machine** principals; see above |
