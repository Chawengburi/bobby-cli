# bobby-cli

A CLI for our own auth-center + session-memory — one login and one memory client that works the same way whether it's you at a terminal, a coding agent, an AI agent, openClaw, Hermes, or anything else that can shell out to a binary.

**This is an internal tool published to npm for easy installation, not a generic bring-your-own-backend CLI.** Every install talks to the same fixed auth-center/session-memory deployment unless you set a per-device `.env` or exported env vars — `auth login` only ever asks for your email and password, never for a server URL. See "Configuration" below if that surprises you.

```
npm install -g bobby-cli
```

---

## Quick start

```bash
bobby-cli auth login
```

Prompts for email + password and mints you a session-memory API token. After that:

```bash
bobby-cli memory remember "decided to use TypeScript for the CLI"
cat notes.md | bobby-cli memory remember
bobby-cli memory recall "TypeScript decision"
bobby-cli memory show
```

---

## Commands

| Command | Description |
|---|---|
| `bobby-cli auth login` | Log in to auth-center and mint a session-memory API token |
| `bobby-cli auth show` | Show the current login (never prints the raw token) |
| `bobby-cli auth forget` | Delete the local credentials file |
| `bobby-cli memory show` | List recent memories (chronological, with tag filtering) |
| `bobby-cli memory recall <query>` | Search memories semantically |
| `bobby-cli memory remember [text]` | Save a memory (reads stdin if no text given) |
| `bobby-cli memory append <id> <text>` | Add more context to an existing memory |
| `bobby-cli memory forget <id>` | Delete a memory |

### Options

```bash
bobby-cli memory show -n 20 --tags work
bobby-cli memory recall "last week's decision" -n 10
bobby-cli memory recall "architecture" --tags engineering
bobby-cli memory recall "architecture" --tags engineering,auth-center   # multiple tags: matches any (OR)
```

Every command accepts `--json` for machine-readable output — this is what agents/scripts should parse, not the human-formatted text.

---

## Configuration

**bobby-cli has one fixed backend, baked into the code** (`src/core/config.ts`) — not a per-installer setting. `auth login` never asks for a server URL, only email + password. This is deliberate: bobby-cli is published to npm purely so it's easy to `npm install -g` across every machine/agent in our own setup, not so arbitrary third parties can point it at their own infrastructure.

```
DEFAULT_AUTH_CENTER_URL     = https://auth-center.phantaporntr.workers.dev
DEFAULT_SESSION_MEMORY_URL  = https://second-brain.phantaporntr.workers.dev/mcp
```

These are the real production URLs — every install of the published package falls back to this deployment if no env override is configured.

### Overriding the fixed backend (dev/testing only)

`AUTH_CENTER` / `SESSION_MEMORY_URL` env vars override the built-in default, for pointing *your own* dev environment at the separate testing-account deployment or a local `wrangler dev` — this is not something end users of the published package are expected to touch:

```bash
AUTH_CENTER=https://auth-center.tanaphat-jaroonrueang.workers.dev SESSION_MEMORY_URL=https://second-brain.tanaphat-jaroonrueang.workers.dev/mcp bobby-cli memory show
```

The override applies per-command and needs no re-login — `auth login` itself also respects it (see `resolveAuthCenterUrl`/`resolveSessionMemoryUrl` in `src/core/config.ts`), so you can log in against a test deployment without touching the fixed default.

### Device-level `.env`

For your own machines, put the testing or local server URLs in `~/.bobby-cli/.env`:

```bash
mkdir -p ~/.bobby-cli
cp .env.example ~/.bobby-cli/.env
```

That file is loaded automatically no matter which directory you run `bobby-cli` from, including a global npm install. This is the recommended way to make your devices use the testing-account deployment instead of the production URLs baked into the package.

### Local development with `.env`

Same override, without exporting env vars every time. Copy `.env.example` to `.env` in this directory and fill in the URLs:

```bash
cp .env.example .env
```

Repo-local `.env` is loaded automatically, is gitignored, and **is never included when this package is published to npm** — it only affects commands run with this repo as the working directory. Precedence: a real exported shell env var > repo-local `.env` > `~/.bobby-cli/.env` > the fixed default baked into the code. You can also set `BOBBY_CLI_EMAIL`/`BOBBY_CLI_PASSWORD` there to make `auth login` fully non-interactive during dev.

### Non-interactive login

For scripted or agent-driven setups (CI, containers, no TTY) against the fixed default backend:

```bash
BOBBY_CLI_EMAIL=you@example.com BOBBY_CLI_PASSWORD=... bobby-cli auth login
```

(`--email`/`--password` flags work the same way, but env vars avoid the password showing up in shell history or a process list.)

---

## Where credentials are stored

```
~/.bobby-cli/
└── credentials.json   (mode 600)
```

Contains your email, tenant ID, the auth-center/session-memory URLs, and the `sm_live_...` API token minted for you. The token is written to this file and read from it on every command — it is never printed to stdout/stderr, in either human or `--json` mode, including in error output. If you see a raw token in any command's output, that's a bug — please report it.

`bobby-cli auth forget` deletes this file. It does not currently revoke the token server-side (see the project's `auth-center` docs if you also want to revoke it there).

---

## Auth model

Login is a plain email + password exchange against the org's auth-center deployment:

```
POST /auth/token   { email, password }             -> short-lived session token
POST /auth/tokens  { label, resource, scopes }      -> sm_live_... API token (shown once, then cached)
```

Logging in again with the same token label (default `bobby-cli@<hostname>`, override with `--label`)
rotates the existing token instead of minting another one, so repeated logins don't accumulate
tokens. Tokens with other labels — other machines, the web UI, other users' profiles — are never touched.

There is no OAuth device-code flow yet — it's a deliberate v1 scope cut, not an oversight, and is expected to land in a later version for headless/remote-agent use cases that can't do an interactive password prompt at all.

Memory operations (`show`, `recall`, `remember`, `append`, `forget`) all call session-memory's `/mcp` endpoint directly as a JSON-RPC client, using the cached API token as a Bearer credential.

---

## Before publishing to npm

- [x] Swap `DEFAULT_AUTH_CENTER_URL` and `DEFAULT_SESSION_MEMORY_URL` in `src/config.ts` to the real production URLs — done, they now point at `auth-center.phantaporntr.workers.dev` / `second-brain.phantaporntr.workers.dev`.
- [x] Confirm `npm pack --dry-run` doesn't include `.env` — verified, only `.env.example` ships.
- [ ] Decide whether `bobby-cli` is the final package name on the public npm registry, or if it should be scoped (e.g. `@chawengburi/bobby-cli`) to make the "internal tool, not a public offering" intent clearer to anyone who stumbles on it.

---

## License

ISC
