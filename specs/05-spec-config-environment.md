# 05 Spec: Configuration & Environment

> Implementation: `src/core/config.ts` and `src/index.ts`

## Fixed backend, by design

bobby-cli talks to **one** organization backend, baked into
`src/core/config.ts` — not a per-installer setting:

```
DEFAULT_AUTH_CENTER_URL     = https://auth-center.phantaporntr.workers.dev
DEFAULT_SESSION_MEMORY_URL  = https://second-brain.phantaporntr.workers.dev/mcp
```

`auth login` never asks for a server URL, only email + password. This is
deliberate — see [02](./02-spec-requirements.md): bobby-cli is published to
npm purely for easy installation across this org's own machines/agents, not
as a generic bring-your-own-backend tool for third parties.

## Resolution precedence

Applies independently to each of `authCenterUrl` and `sessionMemoryUrl`,
via `resolveAuthCenterUrl()` / `resolveSessionMemoryUrl()`:

```
1. Explicit shell env var (AUTH_CENTER / SESSION_MEMORY_URL)   — highest precedence
2. Repo-local `.env` from the current working directory
3. Device-level `.env` from `~/.bobby-cli/.env`
4. Stored value from a prior `auth login` (credentials.json)
5. Fixed org default baked into src/core/config.ts             — lowest precedence
```

Dotenv files (loaded via `dotenv`, see `src/index.ts`) only ever set process
env vars that aren't already set — so they are silently overridden by a real
`export` if one exists. Repo-local `.env` is gitignored and excluded from the
published npm package (verified via `npm pack --dry-run`); it only takes
effect when the current working directory has that `.env`. The device-level
`~/.bobby-cli/.env` file works from any directory, including a global install.

The override applies **per-command** and needs no re-login — `auth login`
itself also respects it, so a test/dev deployment can be logged into
without touching the fixed default or the real production credentials.

## Environment variables

| Variable | Purpose | Where read |
|---|---|---|
| `AUTH_CENTER` | Override the auth-center URL (dev/test only) | `resolveAuthCenterUrl()` |
| `SESSION_MEMORY_URL` | Override the session-memory `/mcp` URL (dev/test only) | `resolveSessionMemoryUrl()` |
| `BOBBY_CLI_EMAIL` | Non-interactive login email | `resolveEmailPassword()` in `src/commands/auth.ts` |
| `BOBBY_CLI_PASSWORD` | Non-interactive login password | `resolveEmailPassword()` in `src/commands/auth.ts` |

None of these are read at module-evaluation time — only inside command
actions, after `dotenv` has already had a chance to populate `process.env`
(see the ordering comment in `src/index.ts`).

## Local development

```bash
cp .env.example .env
```

Pre-filled with the separate testing-account deployment
(`auth-center.tanaphat-jaroonrueang.workers.dev` /
`second-brain.tanaphat-jaroonrueang.workers.dev`). Also supports commented-out
`BOBBY_CLI_EMAIL`/`BOBBY_CLI_PASSWORD` for a fully non-interactive dev login
loop.

For installed/global CLIs on your own devices:

```bash
mkdir -p ~/.bobby-cli
cp .env.example ~/.bobby-cli/.env
```

That device-level file points your machine at testing or local URLs without
changing the production fallback baked into the package.

## What is and isn't secret here

The baked-in URLs are plain HTTPS addresses — not secret, no different from
any public website's address. The only things that must never be hardcoded
or committed are the `sm_live_...` API token and any account's email/
password; those only ever exist in `~/.bobby-cli/credentials.json` (mode
`0600`) or a gitignored `.env`. See `DEVELOPMENT.md` Part 0 for the same
rule stated for contributors.
