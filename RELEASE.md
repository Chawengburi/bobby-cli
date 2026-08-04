# Releasing bobby-cli

Canonical runbook for shipping a version of `@chawengburi/bobby-cli` to npm.

`DEVELOPMENT.md` Part 3 explains what publishing *is* and walks through the
manual commands — read it once if you have never published an npm package.
**This file is the process that actually gets used.** Releases go out through
CI from a `release/<version>` git tag, not from a laptop.

---

## One-time setup (not done yet)

None of this exists at the time of writing — it must be set up before the
first release under the `@chawengburi` scope.

1. **Create the npm org** `chawengburi` at
   [npmjs.com/org/create](https://www.npmjs.com/org/create). The scope in
   `package.json` (`@chawengburi/bobby-cli`) will not publish without it.
2. **Turn on 2FA** for the account that owns the org.
3. **Create an npm Automation token** (Access Tokens → Generate New Token →
   Automation). Automation tokens bypass the 2FA prompt, which is what lets
   CI publish; a Classic "Publish" token will fail the 2FA challenge.
4. **Add the token** as repo secret `NPM_TOKEN`
   (Settings → Secrets and variables → Actions).
5. **Create the `npm-production` environment**
   (Settings → Environments → New environment) and add yourself as a
   **required reviewer**. This is the approval gate — without it, pushing a
   tag publishes immediately with no human in the loop.
6. **Add a tag protection rule** for `release/*`
   (Settings → Rules → Rulesets → New tag ruleset) restricting tag creation
   to maintainers.

Verify the org and name are free before relying on them:

```bash
npm view @chawengburi/bobby-cli   # expect: 404, i.e. name is available
```

---

## Cutting a release

```bash
# 1. Be on dev, up to date, clean tree
git checkout dev && git pull && git status --short

# 2. Bump the version WITHOUT letting npm create its own tag —
#    this repo's tag convention is `release/<version>`, not npm's `v<version>`
npm version 1.0.0 --no-git-tag-version

# 3. Sanity-check locally (CI runs these too, but fail fast here)
npm ci && npm run build && npm test && npm pack --dry-run

# 4. Commit the bump
git add package.json package-lock.json
git commit -m "chore(release): 1.0.0"
git push origin dev

# 5. Tag and push — this is what triggers the publish workflow
git tag release/1.0.0
git push origin release/1.0.0
```

Then go to **Actions → release** and approve the `npm-production` deployment.
Nothing reaches the registry until that approval.

### Verify after publish

```bash
npm view @chawengburi/bobby-cli version    # matches the tag
npm install -g @chawengburi/bobby-cli@1.0.0
bobby-cli --version                        # matches
bobby-cli auth show --json                 # existing credentials still work
```

Then update `../PRODUCTION-UPDATES.md` — add the entry and flip its status
from `⏳ รอ deploy` to `✅ deployed <date>` only once the production machines
have actually been upgraded.

---

## Rules

- **The tag is the trigger.** Pushing to `dev` or `main` never publishes.
- **The tag version must equal `package.json`'s version.** CI hard-fails
  otherwise. This is not cosmetic: `0.3.0` went to npm with no matching git
  tag, and that release can no longer be traced to a commit.
- **Never `npm publish` from a laptop.** It skips the approval gate and the
  version guard. If CI is broken, fix CI.
- **No provenance attestation.** npm only generates provenance for packages
  built from a public repository, and this repo is private. If it is ever made
  public, add `--provenance` to the publish step in
  `.github/workflows/release.yml`.
- **Versions are immutable.** npm does not allow republishing a version, even
  after `npm unpublish`. A bad release is fixed by publishing the next patch.

## Rollback

There is no un-publish. To pull a bad version back:

```bash
# Point `latest` at the previous good version so new installs get it
npm dist-tag add @chawengburi/bobby-cli@<previous-good> latest

# Mark the bad version so anyone installing it explicitly sees a warning
npm deprecate @chawengburi/bobby-cli@<bad-version> "Broken release, use <previous-good>"
```

Then fix forward and cut a new patch release.

## Migrating installs off `@babyferret/bobby-cli`

`@babyferret/bobby-cli@0.3.0` was published under a personal/trial npm
account. Once the first `@chawengburi` release is live:

```bash
npm deprecate @babyferret/bobby-cli "Moved to @chawengburi/bobby-cli"
```

Machines that installed the old package must uninstall it first — two global
packages both providing a `bobby-cli` binary will shadow each other:

```bash
npm uninstall -g @babyferret/bobby-cli
npm install -g @chawengburi/bobby-cli@<version>
which bobby-cli && bobby-cli --version
```
