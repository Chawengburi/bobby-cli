# Fix: Device-level server URL configuration

## Problem

`bobby-cli` already supported `AUTH_CENTER` and `SESSION_MEMORY_URL` through exported environment variables or a repo-local `.env` file. That worked while running commands from inside the `bobby-cli` project directory.

The issue was global/device usage: when `bobby-cli` is installed and run from another directory, the repo-local `.env` is not available. In that case the CLI could fall back to the production URLs hardcoded in `src/core/config.ts`.

## Code changes

### `src/index.ts`

Added support for loading a device-level dotenv file:

```ts
loadDotenv({ path: join(homedir(), ".bobby-cli", ".env"), quiet: true });
```

The CLI now loads dotenv in this order:

1. current working directory `.env`
2. `~/.bobby-cli/.env`

Because `dotenv` does not override existing environment variables by default, the final precedence is:

1. exported shell env vars, such as `AUTH_CENTER` or `SESSION_MEMORY_URL`
2. repo-local `.env`
3. device-level `~/.bobby-cli/.env`
4. stored URLs from existing credentials
5. hardcoded production fallback URLs

This means your own devices can use testing or local Worker URLs without editing production defaults in the codebase.

### `src/core/config.ts`

Updated comments around the production defaults to explain that dotenv files can override them for development/testing.

No runtime URL resolution logic changed here. The existing functions still read from `process.env`, and `src/index.ts` now populates `process.env` from both dotenv locations before commands run.

## Documentation changes

### `.env.example`

Updated the header comments to explain that the file can be copied to either:

```bash
.env
```

for repo-local development, or:

```bash
~/.bobby-cli/.env
```

for installed/global CLI usage on your own device.

### `README.md`

Added a new "Device-level `.env`" section with setup commands:

```bash
mkdir -p ~/.bobby-cli
cp .env.example ~/.bobby-cli/.env
```

Also updated the configuration explanation so production URLs are described as a fallback when no override is configured.

### `DEVELOPMENT.md`

Added the same device-level `.env` workflow for developers testing a global install.

### `specs/05-spec-config-environment.md`

Updated the configuration spec so it matches the new behavior:

1. explicit shell env vars
2. repo-local `.env`
3. `~/.bobby-cli/.env`
4. stored credential URLs
5. hardcoded production defaults

Also corrected implementation paths from `src/config.ts` to `src/core/config.ts`.

## Verification

Ran:

```bash
npm run build
```

Result: TypeScript build completed successfully.

Ran a smoke test with a temporary `HOME`, fake credentials, and a `~/.bobby-cli/.env` while executing the CLI from `/tmp`.

Result: the CLI attempted to reach the URL from `~/.bobby-cli/.env`, proving global/device dotenv loading works outside the repo directory.

Ran a second smoke test with both a repo-local `.env` and `~/.bobby-cli/.env`.

Result: the repo-local `.env` won, confirming the intended precedence.

Ran:

```bash
npm pack --dry-run
```

Result: the package includes `.env.example`, but not the real `.env`.

## How to use on your devices

Create this file:

```bash
mkdir -p ~/.bobby-cli
cp .env.example ~/.bobby-cli/.env
```

Then edit `~/.bobby-cli/.env`:

```bash
AUTH_CENTER=https://your-auth-center-url
SESSION_MEMORY_URL=https://your-session-memory-url/mcp
```

After that, an installed `bobby-cli` will use those URLs from any directory on that device.

## Note about existing working-tree changes

Before this fix, the repo already had other local changes, including `src/core/mcpClient.ts`, `package-lock.json`, and `src/version.ts`. Those were left intact.

The relevant changes for this fix are the dotenv loading behavior and the matching documentation/spec updates.
