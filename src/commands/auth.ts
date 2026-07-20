import { Command } from "commander";
import inquirer from "inquirer";
import { hostname } from "node:os";
import {
  credentialsExist,
  deleteCredentials,
  loadCredentials,
  requireCredentials,
  resolveAuthCenterUrl,
  resolveSessionMemoryUrl,
  resolveCredentialsPath,
  saveCredentials,
  login,
  mintApiToken,
  listApiTokens,
  rotateApiToken,
  AuthCenterError,
  classifyAuthCenterFailure,
  SERVER_HINT,
} from "../core/index.js";
import { printError, printInfo, printJson, printSuccess } from "../output.js";

const PROFILE_OPTION = [
  "--profile <name>",
  "use a named credential profile instead of the default (see BOBBY_CLI_PROFILES_DIR)",
] as const;

interface LoginOptions {
  email?: string;
  password?: string;
  label?: string;
  json?: boolean;
  profile?: string;
}

async function resolveEmailPassword(
  opts: LoginOptions
): Promise<{ email: string; password: string }> {
  // Non-interactive path first: flags, then env vars — so scripted/agent-driven
  // logins never block on a prompt they can't answer.
  const email = opts.email ?? process.env.BOBBY_CLI_EMAIL;
  const password = opts.password ?? process.env.BOBBY_CLI_PASSWORD;
  if (email && password) return { email, password };

  const answers = await inquirer.prompt<{ email: string; password: string }>([
    {
      type: "input",
      name: "email",
      message: "Email:",
      default: email,
      when: !email,
      validate: (v: string) => (v.trim().length > 0 ? true : "Email cannot be empty"),
    },
    {
      type: "password",
      name: "password",
      message: "Password:",
      mask: "*",
      when: !password,
      validate: (v: string) => (v.trim().length > 0 ? true : "Password cannot be empty"),
    },
  ]);

  return {
    email: email ?? answers.email,
    password: password ?? answers.password,
  };
}

async function runLogin(opts: LoginOptions): Promise<void> {
  try {
    // Fixed org backend — not user-configurable per install. See config.ts:
    // env vars / .env only exist to point *this* machine at a different
    // deployment for local dev/testing, not as an end-user-facing option.
    const stored = loadCredentials(opts.profile);
    const authCenterUrl = resolveAuthCenterUrl(stored?.authCenterUrl);
    const sessionMemoryUrl = resolveSessionMemoryUrl(stored?.sessionMemoryUrl);
    const { email, password } = await resolveEmailPassword(opts);

    const { sessionToken, user } = await login(authCenterUrl, email, password);
    // Per-install label so a second machine's login doesn't collide with this
    // one's token. --label overrides it so a multi-profile caller (openClaw)
    // can keep one label per end user (e.g. discord-dm-<id>) instead of every
    // profile on the machine sharing bobby-cli@<host>.
    const tokenLabel = opts.label ?? `bobby-cli@${hostname()}`;

    // Rotate-by-label: logging in again where an active token with this exact
    // label already exists replaces that token instead of minting another one,
    // so repeated logins don't pile up tokens (GitHub PAT-style semantics).
    // Only the newest same-label token is rotated; differently-labeled tokens
    // (other machines/clients) are never touched.
    const sameLabel = (await listApiTokens(authCenterUrl, sessionToken))
      .filter((t) => t.label === tokenLabel)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const minted = sameLabel.length > 0
      ? await rotateApiToken(authCenterUrl, sessionToken, sameLabel[0].id)
      : await mintApiToken(authCenterUrl, sessionToken, tokenLabel);

    saveCredentials(
      {
        authCenterUrl,
        sessionMemoryUrl,
        email: user.email,
        tenantId: user.tenantId,
        apiToken: minted.rawToken,
        apiTokenId: minted.tokenId,
        apiTokenLabel: tokenLabel,
        scopes: minted.scopes,
        createdAt: new Date().toISOString(),
        expiresAt: minted.expiresAt,
      },
      opts.profile
    );

    if (opts.json) {
      printJson({ ok: true, email: user.email, tenantId: user.tenantId });
    } else {
      printSuccess(`Logged in as ${user.email}. Credentials saved to ${resolveCredentialsPath(opts.profile)}`);
    }
  } catch (err) {
    const message = err instanceof AuthCenterError ? err.message : (err as Error).message;
    // context: "login" — a 401 here (bad credentials during `auth login`
    // itself) is login_failed, not not_logged_in (see classifyFailure.ts).
    const failure = err instanceof AuthCenterError
      ? classifyAuthCenterFailure(err, "login")
      : { code: "server", hint: SERVER_HINT };
    if (opts.json) {
      printJson({ ok: false, error: message, code: failure.code, hint: failure.hint });
      process.exitCode = 1;
    } else {
      printError(message);
      printInfo(failure.hint);
    }
  }
}

function runShow(opts: { json?: boolean; profile?: string }): void {
  let creds;
  try {
    creds = loadCredentials(opts.profile);
  } catch (err) {
    // loadCredentials only throws from resolveCredentialsPath's invalid
    // --profile name check (bad local input) — never a CliAuthError or
    // AuthCenterError, so "usage" is the right code, not a fallback.
    const message = (err as Error).message;
    if (opts.json) {
      printJson({ ok: false, error: message, code: "usage", hint: message });
      process.exitCode = 1;
    } else {
      printError(message);
      printInfo(message);
    }
    return;
  }

  if (!creds) {
    if (opts.json) {
      printJson({ loggedIn: false });
    } else {
      printInfo("Not logged in. Run `bobby-cli auth login`.");
    }
    return;
  }

  // Never include creds.apiToken here — see output.ts.
  const summary = {
    loggedIn: true,
    email: creds.email,
    tenantId: creds.tenantId,
    apiTokenLabel: creds.apiTokenLabel,
    apiTokenId: creds.apiTokenId,
    scopes: creds.scopes,
    createdAt: creds.createdAt,
    expiresAt: creds.expiresAt,
    authCenterUrl: creds.authCenterUrl,
    sessionMemoryUrl: creds.sessionMemoryUrl,
  };

  if (opts.json) {
    printJson(summary);
  } else {
    console.log(`Email:        ${summary.email}`);
    console.log(`Tenant:       ${summary.tenantId ?? "(none)"}`);
    console.log(`Token label:  ${summary.apiTokenLabel} (${summary.apiTokenId})`);
    console.log(`Scopes:       ${summary.scopes.join(", ")}`);
    console.log(`Created:      ${summary.createdAt}`);
    console.log(`Expires:      ${summary.expiresAt ?? "(never)"}`);
  }
}

function runForget(opts: { json?: boolean; profile?: string }): void {
  // Local-only delete for v1 — does not call DELETE /auth/tokens/:id on
  // auth-center to revoke server-side. See plan's open question #1.
  let existed: boolean;
  try {
    existed = deleteCredentials(opts.profile);
  } catch (err) {
    // Same reasoning as runShow: deleteCredentials only throws from
    // resolveCredentialsPath's invalid --profile name check.
    const message = (err as Error).message;
    if (opts.json) {
      printJson({ ok: false, error: message, code: "usage", hint: message });
      process.exitCode = 1;
    } else {
      printError(message);
      printInfo(message);
    }
    return;
  }

  if (opts.json) {
    printJson({ ok: true, deleted: existed });
  } else if (existed) {
    printSuccess("Forgot local credentials.");
  } else {
    printInfo("Already logged out.");
  }
}

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Manage your auth-center login");

  auth
    .command("login")
    .description("Log in to auth-center and mint a session-memory API token")
    .option("--email <email>", "email (skips the prompt)")
    .option("--password <password>", "password (skips the prompt)")
    .option(
      "--label <label>",
      "token label; logging in again with the same label rotates that token instead of minting a new one (default: bobby-cli@<hostname>)"
    )
    .option(...PROFILE_OPTION)
    .option("--json", "machine-readable output")
    .action(runLogin);

  auth
    .command("show")
    .description("Show the current login (never prints the raw token)")
    .option(...PROFILE_OPTION)
    .option("--json", "machine-readable output")
    .action(runShow);

  auth
    .command("forget")
    .description("Delete the local credentials file")
    .option(...PROFILE_OPTION)
    .option("--json", "machine-readable output")
    .action(runForget);
}

export { credentialsExist, requireCredentials };
