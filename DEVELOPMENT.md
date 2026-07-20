# bobby-cli — Development & Publishing Guide

Step-by-step commands for working on bobby-cli locally, and for publishing it to the public npm registry when you're ready. Written for someone who hasn't done npm packaging before — every command is explained, and every risky one has a caution callout.

**Read this first:** the single most important rule in this whole guide is **never run `npm publish` "just to see what happens."** Everything up to that command is safe and fully reversible. `npm publish` is the one action that goes out to the public internet and is very hard to take back. Always run `npm publish --dry-run` first (see Part 3) — it shows you exactly what would happen without actually doing it.

---

## Part 0 — Before you touch anything

- ⚠️ **`.env` must never be committed.** It's already in `.gitignore`, but double-check with `git status` before every commit — if `.env` ever shows up as a file `git` wants to add, stop and figure out why before continuing.
- ⚠️ **Never put real passwords, tokens, or secrets directly into code.** The only URLs baked into `src/config.ts` are Worker *URLs* (not secret — they're plain HTTPS addresses, same as any website), never the `sm_live_...` API token or your email/password. If you're ever asked to hardcode a token "just for testing," don't — use `.env` instead.
- ⚠️ **Nothing in Part 1 or Part 2 below is public or permanent.** `npm install`, `npm run build`, `npm link`, `npm pack` all only touch your own machine. You cannot break anything for anyone else by running them. Part 3 (publishing) is the only section where mistakes become hard to undo — take it slowly.

---

## Part 1 — Local development (nothing here is public)

### 1. Check your tools are installed

```bash
node --version   # should print v18 or higher
npm --version
```

If either command isn't found, you don't have Node.js installed — stop and install it first (not covered here).

### 2. Install dependencies

```bash
cd bobby-cli
npm install
```

Downloads `commander`, `chalk`, `inquirer`, `dotenv`, and dev tools into `node_modules/` (already gitignored — never commit this folder).

### 3. Build

```bash
npm run build
```

Compiles the TypeScript in `src/` into plain JavaScript in `dist/` (also gitignored — it's generated, not source code). You need to re-run this every time you change a `.ts` file, unless you use watch mode:

```bash
npm run dev
```

This runs `tsc --watch`, which rebuilds automatically every time you save a file. Leave it running in one terminal tab while you work.

⚠️ **If you add or change a command, flag, or `--json` output shape**, update `schema/tools.json` in the same change. That file is the tool-schema manifest AI agents use to call bobby-cli (see `specs/09-spec-agent-tool-schema.md`) — it's hand-maintained, not generated, so it silently drifts out of sync with `src/commands/*.ts` if you forget. Its top-level `"version"` field must also be bumped to match `package.json`'s `version` in the same change (spec 09). You must also update **every deployed `SKILL.md` command table** in the same change (today: the `chawengburi` repo's `.claude/skills/bobby-cli/SKILL.md`) — those tables are hand-written and only agree with the manifest if kept in sync deliberately (spec 13 § 2).

### 4. Run it without installing anything

```bash
node dist/index.js --help
node dist/index.js auth show
```

This runs the built CLI directly. Good for a quick check, but it's not how a real user would invoke it (they'd just type `bobby-cli`).

### 5. Make `bobby-cli` a real command on your machine (`npm link`)

```bash
npm link
```

This creates a symlink so the `bobby-cli` command works from **any directory**, exactly like it would after a real `npm install -g bobby-cli` — except it points at your local folder, so every rebuild (`npm run build`) is reflected immediately with no re-linking needed.

Verify it worked:

```bash
which bobby-cli
cd /tmp && bobby-cli --help
```

⚠️ **This does change something outside this folder** — it adds a global symlink to your machine's npm installation. It's still completely safe and fully reversible:

```bash
npm unlink -g bobby-cli
```

removes it with no trace left behind. Run this if you ever want your machine to stop having a `bobby-cli` command, or before testing a *real* published install (Part 3) so you're not confused about which version you're running.

### 6. Local dev config with `.env`

```bash
cp .env.example .env
```

Then edit `.env` with a text editor and fill in the testing-account URLs (already pre-filled in `.env.example`) or your own local `wrangler dev` URLs. This file is only read when your current directory is `bobby-cli/`.

For an installed/global CLI on your own devices, use the device-level dotenv file instead:

```bash
mkdir -p ~/.bobby-cli
cp .env.example ~/.bobby-cli/.env
```

`bobby-cli` loads that file from any working directory, so your devices can point at the testing-account deployment without replacing the production fallback URLs in code.

---

## Part 2 — Testing exactly like a real install (`npm pack`)

`npm link` is convenient but hides some mistakes (like forgetting a file that should ship). Before publishing for real, it's worth testing the *actual* package a user would download.

### 1. Build the real package file

```bash
npm pack
```

This creates a file like `bobby-cli-0.1.0.tgz` in this directory — this is the literal file that would be uploaded to npm. It also prints the full list of files inside it; skim it and confirm `.env` is **not** in that list (only `.env.example` should be).

### 2. Install from that file, like a real user would

```bash
npm install -g ./bobby-cli-0.1.0.tgz
```

### 3. Test it

```bash
bobby-cli --version
bobby-cli auth show
```

### 4. Clean up

```bash
npm uninstall -g bobby-cli
rm bobby-cli-*.tgz
```

⚠️ The `.tgz` file is a build artifact, not source code — it's already in `.gitignore` (`*.tgz`), but delete it anyway so it doesn't clutter the folder.

---

## Part 3 — Publishing to the public npm registry

⚠️ **Read Part 0 again before starting this section.** Everything from here on is about making bobby-cli downloadable by anyone in the world via `npm install -g bobby-cli`. Take your time.

### 1. Decide if you're really ready

Ask yourself:
- Have you tested the real tarball install from Part 2?
- Are you comfortable that `src/config.ts`'s baked-in URLs (`auth-center.phantaporntr.workers.dev`, `second-brain.phantaporntr.workers.dev`) are the ones you want live in the published package?
- Is `bobby-cli` really the name you want, publicly, forever associated with your npm account? (See step 4 below — names can't be easily reused once taken.)

If any of these feel uncertain, stop here and come back later. Nothing bad happens by waiting.

### 2. Create an npm account (if you don't have one)

Go to [npmjs.com/signup](https://www.npmjs.com/signup) in a browser and create an account. ⚠️ **Turn on two-factor authentication (2FA)** in your npm account settings afterward — this is the single best thing you can do to prevent someone else from publishing malicious updates to your package later.

### 3. Log in from your terminal

```bash
npm login
```

This opens a browser (or asks for username/password + 2FA code) and stores an auth token locally so future `npm publish` commands know it's you. Verify it worked:

```bash
npm whoami
```

This should print your npm username. (Checked on this machine already — currently **not** logged in, so this step is required before anything else in Part 3 will work.)

⚠️ This step needs your real npm password/2FA — I can't and shouldn't do this step for you. Run it yourself in a terminal you trust.

### 4. Check the package name is actually available

```bash
npm view bobby-cli
```

If you see `404 Not Found`, the name is free (confirmed available as of this guide being written). If you instead see package details, someone else already published a package called `bobby-cli` — you'd need a different name.

**Consider a scoped name instead**, e.g. `@yourNpmUsername/bobby-cli` or `@chawengburi/bobby-cli`. This has two advantages given this is really an internal tool:
- It can never collide with someone else's unscoped package of the same name.
- It signals "this belongs to a specific account/org," which better matches the "internal tool, published for convenience" intent from the README.

If you go with a scoped name, update `"name"` in `package.json` accordingly (e.g. `"@chawengburi/bobby-cli"`), and remember scoped packages publish as **private by default** — you'll need `npm publish --access public` (see step 7) or it will fail/attempt a paid private publish.

### 5. Double-check what's about to ship

```bash
npm pack --dry-run
```

Read the file list carefully. Confirm:
- `.env` is **not** listed (only `.env.example`)
- `dist/` files are present (the compiled code users actually run)
- Nothing looks like a personal file that shouldn't be there

### 6. Confirm the version number

Check `"version"` in `package.json` — it's currently `0.1.0`, which is a normal first release. npm uses [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. You don't need to change anything for a first publish. For later updates, bump it with:

```bash
npm version patch   # 0.1.0 -> 0.1.1, for small fixes
npm version minor    # 0.1.0 -> 0.2.0, for new features
npm version major    # 0.1.0 -> 1.0.0, for breaking changes
```

⚠️ `npm version` also makes a git commit and tag automatically (since this is a git repo) — it will refuse to run if you have uncommitted changes. Commit or stash first if it complains.

⚠️ **You can never reuse a version number once it's published**, even if you unpublish it later. If `0.1.0` goes out with a mistake, the fix has to be `0.1.1`, not a re-published `0.1.0`.

### 7. Dry-run the actual publish (does not publish anything)

```bash
npm publish --dry-run
```

This simulates the entire publish process and prints exactly what *would* be uploaded, without actually sending anything to npm's servers. **Always run this before the real command.** If anything looks wrong, fix it and dry-run again — as many times as you want, for free, with no consequences.

### 8. The real publish

Only after the dry-run looks correct:

```bash
npm publish
```

(If you used a scoped name like `@chawengburi/bobby-cli`, use `npm publish --access public` instead — otherwise npm will either reject it or try to publish it as a private package.)

This is the one command in this whole guide that is genuinely hard to undo. Once it succeeds, `bobby-cli` (or your scoped name) is live and installable by anyone, anywhere, immediately.

### 9. Verify it's live

```bash
npm view bobby-cli
npm install -g bobby-cli   # fresh install from the real registry, not a local link/tarball
bobby-cli --version
```

⚠️ Before this step, run `npm unlink -g bobby-cli` (from Part 1) if you still have the local dev link active, so you're not accidentally testing the linked version and thinking it's the published one.

### 10. Publishing updates later

Repeat steps 6–8: bump the version with `npm version patch` (or `minor`/`major`), dry-run, then `npm publish` again.

### 11. If something goes wrong after publishing

- **Wrong README, wrong description, small metadata mistakes**: fine, just publish a new patch version — no special action needed.
- **You published something sensitive or badly broken**: npm allows `npm unpublish <package>@<version>` but **only within 72 hours of publishing**, and only if no other package depends on it yet. After 72 hours, npm's policy is that packages should be deprecated, not removed, to avoid breaking other people's installs (this is the same policy that exists because of the historical "left-pad" incident). To mark a version as "don't use this" without removing it:

  ```bash
  npm deprecate bobby-cli@0.1.0 "This version had a bug, please upgrade"
  ```

  This is the safer, recommended way to walk back a bad release — it warns anyone who installs that version, without yanking it out from under people who already depend on it.

---

## Quick reference

| I want to... | Command |
|---|---|
| Install dependencies | `npm install` |
| Build | `npm run build` |
| Auto-rebuild while editing | `npm run dev` |
| Make `bobby-cli` a global command from my local code | `npm link` |
| Undo that | `npm unlink -g bobby-cli` |
| Build the real package file to inspect/test | `npm pack` |
| See what would be published, safely | `npm pack --dry-run` or `npm publish --dry-run` |
| Log in to npm | `npm login` then `npm whoami` to confirm |
| Check if the name is free | `npm view bobby-cli` (404 = free) |
| Bump the version before a new release | `npm version patch` / `minor` / `major` |
| **Actually publish (public, hard to undo)** | `npm publish` |
| Soft-remove a bad published version | `npm deprecate bobby-cli@<version> "<message>"` |
