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
  machineLogin,
  mintApiToken,
  listApiTokens,
  rotateApiToken,
  AuthCenterError,
  CliUsageError,
  classifyAuthCenterFailure,
  mcpToolCall,
  McpError,
  SERVER_HINT,
  PERMISSION_DENIED_HINT,
} from "../core/index.js";
import { printError, printInfo, printJson, printSuccess } from "../output.js";

// A machine token auth-center happily issued can still be unusable, and the
// cause is always set where the machine user was created — never here.
// `/auth/m2m/login` copies the machine's PREVIOUS token record: its scopes and
// its resource. So a machine whose latest token was for another resource comes
// back with a token session-memory rejects outright, and one that never had a
// first token issued comes back with no scopes at all. Neither is visible in
// the login response, and bobby-cli cannot introspect — that endpoint needs a
// secret no client holds.
//
// Left unchecked, both surface later as a 401, which classifies as
// `not_logged_in`, whose hint tells the operator to run `bobby-cli auth login`
// — the exact command that just produced the broken token. That loop is the
// reason this class exists: it stops at provisioning time, with the cause named.
class MachineProvisioningError extends Error {}

const PROFILE_OPTION = [
  "--profile <name>",
  "use a named credential profile instead of the default (see BOBBY_CLI_PROFILES_DIR)",
] as const;

// One place decides how a thrown error becomes an envelope, so every auth
// subcommand answers the same input with the same `code`. Two bugs came from
// having this logic duplicated per call site: the same invalid --profile name
// was `usage` from `auth show` but `server` from `auth login` and `memory
// show`; and a catch that rethrew anything unrecognised produced NO envelope
// at all under --json, breaking spec 12's rule that every failure carries a
// hint. Anything that isn't a known class is still reported — as `server` —
// never rethrown.
function failureEnvelope(
  err: unknown,
  preClassified?: { code: string; hint: string }
): { message: string; code: string; hint: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (preClassified) return { message, ...preClassified };
  if (err instanceof CliUsageError) return { message, code: "usage", hint: message };
  return { message, code: "server", hint: SERVER_HINT };
}

// `preClassified` is for the one case the class alone can't decide: an
// auth-center 401 means `login_failed` during `auth login` but `server`
// anywhere else, so the caller supplies the context (spec 12 § 2).
function emitFailure(err: unknown, json?: boolean, preClassified?: { code: string; hint: string }): void {
  const { message, code, hint } = failureEnvelope(err, preClassified);
  if (json) {
    printJson({ ok: false, error: message, code, hint });
    process.exitCode = 1;
  } else {
    printError(message);
    printInfo(hint);
  }
}

interface LoginOptions {
  email?: string;
  password?: string;
  label?: string;
  machine?: boolean;
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

// Uses the freshly minted token once, before it is written to disk. Returns a
// warning string when the check could not be carried out, or null when it
// passed. Throws MachineProvisioningError when the token itself is the problem.
//
// The distinction is what makes this safe to run on every machine login: a 401
// or a scope denial is evidence ABOUT THE TOKEN, so refuse to save it; a
// timeout or a 5xx is evidence about the network or the Worker, so save and say
// so. Refusing to provision during an unrelated session-memory outage would
// trade one broken state for another.
async function verifyMachineToken(sessionMemoryUrl: string, apiToken: string): Promise<string | null> {
  try {
    // The cheapest read there is, and `n: 1` keeps it cheap on the Worker too.
    await mcpToolCall(sessionMemoryUrl, apiToken, "list_recent", { n: 1 });
    return null;
  } catch (err) {
    if (err instanceof McpError && err.scope) {
      throw new MachineProvisioningError(
        `The machine logged in, but its token lacks the ${err.scope} scope, so it cannot use session-memory. Scopes come from the machine user's first token — set them where the machine user is created (POST /auth/machine-users), then log in again. Nothing was saved.`
      );
    }
    if (err instanceof McpError && (err.status === 401 || err.status === 403)) {
      throw new MachineProvisioningError(
        "The machine logged in, but session-memory rejected its token. auth-center reuses the resource of the machine's most recent token, so this usually means that machine user's last token was issued for a different resource — keep one machine user to one resource. Nothing was saved."
      );
    }
    // Not evidence about the credential: session-memory unreachable, a 5xx, a
    // malformed response. Saving and warning beats blocking provisioning.
    return err instanceof Error ? err.message : String(err);
  }
}

async function runLogin(opts: LoginOptions): Promise<void> {
  try {
    // Fixed org backend — not user-configurable per install. See config.ts:
    // env vars / .env only exist to point *this* machine at a different
    // deployment for local dev/testing, not as an end-user-facing option.
    const stored = loadCredentials(opts.profile);
    const authCenterUrl = resolveAuthCenterUrl(stored?.authCenterUrl);
    const sessionMemoryUrl = resolveSessionMemoryUrl(stored?.sessionMemoryUrl);

    // Rejected before the password prompt, not after: --label is meaningless on
    // the machine path (auth-center hardcodes "m2m-login") and silently
    // ignoring it would let an admin believe two guilds got separate tokens
    // from one machine user, which is exactly the mistake this path exists to
    // make impossible.
    if (opts.machine && opts.label !== undefined) {
      throw new CliUsageError(
        "--label cannot be used with --machine: auth-center labels every machine login 'm2m-login'. Separate identities need separate machine users, not separate labels."
      );
    }

    const { email, password } = await resolveEmailPassword(opts);

    if (opts.machine) {
      const { apiToken, user } = await machineLogin(authCenterUrl, email, password);

      // Before saving, not after: a credentials file that exists is treated as
      // a working login by every other command and by `credentialsExist()`.
      const verifyWarning = await verifyMachineToken(sessionMemoryUrl, apiToken);

      saveCredentials(
        {
          authCenterUrl,
          sessionMemoryUrl,
          email: user.email,
          tenantId: user.tenantId,
          apiToken,
          // Both unknown by construction: /auth/m2m/login returns the token and
          // the principal, nothing about the token record. The scopes are
          // whatever the owner set on the machine user in auth-center, and
          // `auth show` says so rather than printing an empty list that reads
          // as "no permissions".
          apiTokenId: null,
          apiTokenLabel: "m2m-login",
          // null, not []: the CLI is never told this token's scopes, and an
          // empty array is a claim ("no permissions") rather than an absence.
          scopes: null,
          principalType: "machine",
          createdAt: new Date().toISOString(),
          expiresAt: null,
        },
        opts.profile
      );

      if (opts.json) {
        printJson({
          ok: true,
          email: user.email,
          tenantId: user.tenantId,
          principalType: "machine",
          // false does NOT mean the token is bad — it means the check could not
          // be made. A bad token never reaches this line.
          verified: verifyWarning === null,
          ...(verifyWarning ? { verifyWarning } : {}),
        });
      } else {
        printSuccess(
          `Logged in as machine ${user.email}. Credentials saved to ${resolveCredentialsPath(opts.profile)}`
        );
        if (verifyWarning) {
          printError(`Warning: could not verify the token against session-memory — ${verifyWarning}`);
          printInfo("The credentials were saved. Run `bobby-cli memory show -n 1` once it is reachable.");
        }
      }
      return;
    }

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
        principalType: "user",
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
    // context: "login" — a 401 here (bad credentials during `auth login`
    // itself) is login_failed, not not_logged_in (see classifyFailure.ts).
    // Everything else (including an invalid --profile name, which is thrown by
    // loadCredentials before any network call) goes through the shared
    // classifier so it can't drift from the other subcommands again.
    // A provisioning failure is `permission_denied`, not `login_failed`: the
    // credentials were accepted, the identity simply cannot do the job. That
    // hint — stop, contact the owner, do not retry — is the correct advice, and
    // the opposite of `not_logged_in`'s "log in again", which is what this path
    // produced before the token was verified at login time.
    emitFailure(
      err,
      opts.json,
      err instanceof MachineProvisioningError
        ? { code: "permission_denied", hint: PERMISSION_DENIED_HINT }
        : err instanceof AuthCenterError
          ? classifyAuthCenterFailure(err, "login")
          : undefined
    );
  }
}

function runShow(opts: { json?: boolean; profile?: string }): void {
  let creds;
  try {
    creds = loadCredentials(opts.profile);
  } catch (err) {
    emitFailure(err, opts.json);
    return;
  }

  if (!creds) {
    if (opts.json) {
      printJson({
        ok: true,
        code: "status",
        loggedIn: false,
        hint: "Run 'bobby-cli auth login' to log in.",
      });
    } else {
      printInfo("Not logged in. Run `bobby-cli auth login`.");
    }
    return;
  }

  // Never include creds.apiToken here — see output.ts.
  // Files written before machine logins existed carry no principalType; they
  // were all human logins, so absent reads as "user".
  const principalType = creds.principalType ?? "user";
  const summary = {
    loggedIn: true,
    email: creds.email,
    tenantId: creds.tenantId,
    principalType,
    apiTokenLabel: creds.apiTokenLabel,
    apiTokenId: creds.apiTokenId,
    scopes: creds.scopes,
    createdAt: creds.createdAt,
    expiresAt: creds.expiresAt,
    authCenterUrl: creds.authCenterUrl,
    sessionMemoryUrl: creds.sessionMemoryUrl,
  };

  if (opts.json) {
    printJson({ ok: true, code: "status", ...summary });
  } else {
    console.log(`Email:        ${summary.email}`);
    console.log(`Tenant:       ${summary.tenantId ?? "(none)"}`);
    console.log(`Identity:     ${principalType}`);
    console.log(
      `Token label:  ${summary.apiTokenLabel}${summary.apiTokenId ? ` (${summary.apiTokenId})` : ""}`
    );
    // Unknown and empty are different facts, and conflating them would tell an
    // admin their machine has no permissions when the CLI simply never
    // received them. The --json branch carries the same distinction as null.
    console.log(
      `Scopes:       ${
        summary.scopes === null
          ? "(unknown — set on the machine user in auth-center; m2m login does not return them)"
          : summary.scopes.join(", ")
      }`
    );
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
    // Not just an invalid --profile name: deleteCredentials does real I/O, so
    // EACCES/EPERM on a locked ~/.bobby-cli reaches here too and must still
    // produce a proper envelope rather than escaping the command.
    emitFailure(err, opts.json);
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
    .option(
      "--machine",
      "log in as a machine user via /auth/m2m/login (its own memory space, separate from the owner's); cannot be combined with --label"
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
