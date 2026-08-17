# bobby-cli

A CLI for our own auth-center + session-memory — one login and one memory client that works the same way whether it's you at a terminal, a coding agent, an AI agent, openClaw, Hermes, or anything else that can shell out to a binary.

**This is an internal tool published to npm for easy installation, not a generic bring-your-own-backend CLI.** Every install talks to the same fixed auth-center/session-memory deployment unless you set a per-device `.env` or exported env vars — `auth login` only ever asks for your email and password, never for a server URL. See "Configuration" below if that surprises you.

```
npm install -g @chawengburi/bobby-cli
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
| `bobby-cli auth login --machine` | Log in as a machine user (own memory space; see below) |
| `bobby-cli auth show` | Show the current login (never prints the raw token) |
| `bobby-cli auth forget` | Delete the local credentials file |
| `bobby-cli memory show` | List recent memories (chronological, with tag filtering) |
| `bobby-cli memory recall <query>` | Search memories semantically |
| `bobby-cli memory remember [text]` | Save a memory (reads stdin if no text given) |
| `bobby-cli memory append <id> <text>` | Add more context to an existing memory |
| `bobby-cli memory forget <id>` | Delete a memory |
| `bobby-cli uploader search [query]` | Search indexed documents (owner role required) |
| `bobby-cli uploader fetch <id>` | Read one document's markdown by record id |

### Options

```bash
bobby-cli memory show -n 20 --tags work
bobby-cli memory recall "last week's decision" -n 10
bobby-cli memory recall "architecture" --tags engineering
bobby-cli memory recall "architecture" --tags engineering,auth-center   # multiple tags: matches any (OR)
```

```bash
bobby-cli uploader search "reservation" --document-type reservation_list -n 5
bobby-cli uploader search --month 2026-04 --source-system hoteltime      # filters only, no query
bobby-cli uploader fetch abc123 --max-chars 4000
```

Document search goes through auth-center, which holds the one credential for the
document service and checks that the logged-in identity has the `owner` role.
There is nothing to configure on this side, and the CLI never sees that
credential. A `403` means the account lacks the role — logging in again will not
change that.

Every command accepts `--json` for machine-readable output — this is what agents/scripts should parse, not the human-formatted text.

### Machine logins

```bash
bobby-cli auth login --machine --profile <name>
```

A machine user is an identity owned by a person but distinct from them, created
by an owner in auth-center. It matters because **session-memory owns entries by
the machine's own id, not by its owner's** — so a machine identity gets a memory
space of its own, and two machine users get two separate spaces. That is how a
shared host (a Discord bot serving several guilds) keeps one guild's memory from
landing in another's, or in the admin's personal one.

Machine accounts cannot use the normal login: `POST /auth/tokens` rejects them
with 403, so `--machine` goes to `/auth/m2m/login`, which returns an API token
directly. Consequences worth knowing:

- **`--label` is refused.** auth-center labels every machine login `m2m-login`.
  Two identities need two machine users, not two labels.
- **One live token per machine user.** Logging in again revokes the previous
  one, so a single machine user cannot serve two profiles at once.
- **The new token copies the machine's *previous* token**, not a fresh grant:
  auth-center reads the machine's most recent token record and reuses its
  scopes and resource. Two things follow, and both are set where the machine
  user is created, not here:
  - A machine user whose first token was never issued comes back with **no
    scopes**. Create machine users through `POST /auth/machine-users`, which
    issues that first token with the scopes you pass.
  - A machine user whose latest token was for a **different resource** gets a
    token for that resource, which session-memory rejects. Keep one machine
    user to one resource.
- **The token is used once before it is saved.** Neither problem above is
  visible in the login response, and left unchecked both surface later as a
  401 — which reports `not_logged_in`, whose hint says to log in again, the
  exact command that produced the broken token. So `--machine` makes one
  `list_recent` call first:
  - rejected or scope-denied → **nothing is written**, and the error names the
    cause and where to fix it (`permission_denied`, so an agent stops instead
    of retrying);
  - session-memory unreachable → the credentials **are** saved with
    `verified: false` and a warning, because an outage is not evidence about
    the token.
- **`auth show` cannot list the scopes.** The m2m response does not include
  them, so it reports `scopes: null` — unknown, as distinct from `[]`, which
  would claim the identity may do nothing — alongside
  `principalType: "machine"`.

---

## Configuration

**bobby-cli has one fixed backend, baked into the code** (`src/core/config.ts`) — not a per-installer setting. `auth login` never asks for a server URL, only email + password. This is deliberate: bobby-cli is published to npm purely so it's easy to `npm install -g` across every machine/agent in our own setup, not so arbitrary third parties can point it at their own infrastructure.

```
DEFAULT_AUTH_CENTER_URL     = https://auth-center.example.com
DEFAULT_SESSION_MEMORY_URL  = https://second-brain.example.com/mcp
```

These are the package default URLs for the organization deployment; if you are using your own environment, override them with your own values instead of editing the package defaults.

### Overriding the fixed backend (dev/testing only)

`AUTH_CENTER` / `SESSION_MEMORY_URL` env vars override the built-in default, for pointing *your own* dev environment at the separate testing-account deployment or a local `wrangler dev` — this is not something end users of the published package are expected to touch:

```bash
AUTH_CENTER=https://auth-center.example.com SESSION_MEMORY_URL=https://second-brain.example.com/mcp bobby-cli memory show
```

The override applies per-command and needs no re-login — `auth login` itself also respects it (see `resolveAuthCenterUrl`/`resolveSessionMemoryUrl` in `src/core/config.ts`), so you can log in against a test deployment or local environment without touching the fixed default.

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

## License

ISC
