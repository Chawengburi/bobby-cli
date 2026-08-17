import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { registerAuthCommand } from "../src/commands/auth.js";

// Machine users cannot mint through `POST /auth/tokens` — auth-center answers
// 403 for them — so `auth login --machine` goes to /auth/m2m/login instead and
// stores the token that call returns directly. The point of the separate
// identity is a separate memory space: session-memory owns entries by
// `claims.sub` for machine tokens, so two machine users are two spaces.
//
// Every test here writes into a throwaway BOBBY_CLI_PROFILES_DIR and always
// passes --profile, so the real ~/.bobby-cli/credentials.json is never touched.

const realFetch = globalThis.fetch;
const realLog = console.log;
let tmp: string | null = null;

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  process.exitCode = 0;
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

interface Call {
  url: string;
  body: string;
}

function harness(response: () => Response): { calls: Call[]; profilesDir: string } {
  tmp = mkdtempSync(join(tmpdir(), "bobby-machine-"));
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return response();
  }) as unknown as typeof fetch;
  return { calls, profilesDir: tmp };
}

async function runCli(
  argv: string[],
  profilesDir: string
): Promise<{ lines: string[]; envelope: Record<string, unknown> | null; exitCode: number }> {
  const saved = process.env.BOBBY_CLI_PROFILES_DIR;
  process.env.BOBBY_CLI_PROFILES_DIR = profilesDir;

  const lines: string[] = [];
  console.log = (msg?: unknown) => {
    lines.push(String(msg));
  };

  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {} });
  registerAuthCommand(program);

  process.exitCode = 0;
  try {
    await program.parseAsync(["node", "bobby-cli", ...argv]);
  } finally {
    if (saved === undefined) delete process.env.BOBBY_CLI_PROFILES_DIR;
    else process.env.BOBBY_CLI_PROFILES_DIR = saved;
  }

  const joined = lines.join("\n");
  let envelope: Record<string, unknown> | null = null;
  try {
    envelope = JSON.parse(joined) as Record<string, unknown>;
  } catch {
    envelope = null;
  }
  const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  return { lines, envelope, exitCode };
}

// Drives the two-step machine login: the /auth/m2m/login response first, then
// whatever session-memory answers the verification call.
function harnessWithVerify(verify: () => Response): { calls: Call[]; profilesDir: string } {
  tmp = mkdtempSync(join(tmpdir(), "bobby-machine-"));
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return String(url).includes("/auth/m2m/login") ? m2mOk() : verify();
  }) as unknown as typeof fetch;
  return { calls, profilesDir: tmp };
}

function mcpOk(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "No entries found." }] } }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function m2mOk(): Response {
  return new Response(
    JSON.stringify({
      accessToken: "sm_live_machine_token_value",
      user: {
        id: "machine_guild_a",
        email: "guild-a@machines.test",
        name: "guild-a",
        tenantId: "chawengburi",
        accountType: "machine",
        roles: ["machine"],
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

test("--machine posts to /auth/m2m/login, never to the human two-tier flow", async () => {
  const { calls, profilesDir } = harnessWithVerify(mcpOk);

  const { envelope, exitCode } = await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "guild-a@machines.test", "--password", "pw", "--json"],
    profilesDir
  );

  assert.equal(exitCode, 0);
  assert.equal(envelope?.ok, true);
  assert.equal(envelope?.principalType, "machine");
  // Asserted by destination, not by request count: how many requests the MCP
  // transport itself makes is its own business and has changed before.
  assert.match(calls[0].url, /\/auth\/m2m\/login$/, "the login goes to the machine door first");
  assert.ok(!calls.some((c) => /\/auth\/tokens/.test(c.url)), "POST /auth/tokens rejects machines outright");
  assert.ok(calls.slice(1).length > 0, "the token is then used against session-memory");
});

test("--machine stores the returned token with principalType and no token id", async () => {
  const { profilesDir } = harnessWithVerify(mcpOk);

  await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "guild-a@machines.test", "--password", "pw", "--json"],
    profilesDir
  );

  const path = join(profilesDir, "guildA.json");
  const creds = JSON.parse(readFileSync(path, "utf-8"));
  assert.equal(creds.apiToken, "sm_live_machine_token_value");
  assert.equal(creds.principalType, "machine");
  // null, not "": the CLI is never told the token's id, and an empty string
  // would be indistinguishable from a real one in `auth show`.
  assert.equal(creds.apiTokenId, null);
  assert.equal(creds.apiTokenLabel, "m2m-login");
  assert.equal(creds.email, "guild-a@machines.test");
  // Same file permissions as every other credential file.
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("two machine profiles keep two separate credential files", async () => {
  // The whole reason this path exists: one machine user per guild means one
  // token per guild, which session-memory turns into one memory space per guild.
  const { profilesDir } = harnessWithVerify(mcpOk);
  await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "a@machines.test", "--password", "pw", "--json"],
    profilesDir
  );

  globalThis.fetch = (async (url: string) => {
    if (!String(url).includes("/auth/m2m/login")) return mcpOk();
    return new Response(
      JSON.stringify({
        accessToken: "sm_live_token_b",
        user: {
          id: "machine_guild_b",
          email: "guild-b@machines.test",
          name: "guild-b",
          tenantId: "chawengburi",
          accountType: "machine",
          roles: ["machine"],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as unknown as typeof fetch;

  await runCli(
    ["auth", "login", "--machine", "--profile", "guildB", "--email", "b@machines.test", "--password", "pw", "--json"],
    profilesDir
  );

  const a = JSON.parse(readFileSync(join(profilesDir, "guildA.json"), "utf-8"));
  const b = JSON.parse(readFileSync(join(profilesDir, "guildB.json"), "utf-8"));
  assert.notEqual(a.apiToken, b.apiToken);
  assert.notEqual(a.email, b.email);
});

test("the raw token never reaches stdout, in either output mode", async () => {
  const { profilesDir } = harnessWithVerify(mcpOk);

  const json = await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "a@machines.test", "--password", "pw", "--json"],
    profilesDir
  );
  const human = await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "a@machines.test", "--password", "pw"],
    profilesDir
  );
  const shown = await runCli(["auth", "show", "--profile", "guildA", "--json"], profilesDir);

  for (const out of [json, human, shown]) {
    assert.doesNotMatch(out.lines.join("\n"), /sm_live_/);
  }
});

test("--machine with --label is a usage error before any network call", async () => {
  // Labels do nothing on this path (auth-center hardcodes "m2m-login"), and
  // accepting one would suggest a single machine user can hold two tokens.
  const { calls, profilesDir } = harness(m2mOk);

  const { envelope, exitCode } = await runCli(
    ["auth", "login", "--machine", "--label", "guild-a", "--profile", "guildA", "--email", "a@machines.test", "--password", "pw", "--json"],
    profilesDir
  );

  assert.equal(envelope?.ok, false);
  assert.equal(envelope?.code, "usage");
  assert.equal(exitCode, 1);
  assert.equal(calls.length, 0, "the guard must run before the request");
});

test("a rejected machine credential classifies as login_failed", async () => {
  const { profilesDir } = harness(() =>
    new Response(JSON.stringify({ error: "Invalid credentials" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  );

  const { envelope, exitCode } = await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "human@example.test", "--password", "pw", "--json"],
    profilesDir
  );

  // auth-center answers 401 for a human account here too, since it filters on
  // accountType before checking the password — same code, same hint.
  assert.equal(envelope?.ok, false);
  assert.equal(envelope?.code, "login_failed");
  assert.equal(exitCode, 1);
});

test("auth show reports the identity and does not print an empty scope list for machines", async () => {
  const { profilesDir } = harnessWithVerify(mcpOk);
  await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "a@machines.test", "--password", "pw", "--json"],
    profilesDir
  );

  const { envelope } = await runCli(["auth", "show", "--profile", "guildA", "--json"], profilesDir);
  assert.equal(envelope?.principalType, "machine");
  assert.equal(envelope?.apiTokenId, null);

  const human = await runCli(["auth", "show", "--profile", "guildA"], profilesDir);
  const text = human.lines.join("\n");
  assert.match(text, /Identity:\s+machine/);
  assert.match(text, /auth-center/, "an empty scope list would read as 'no permissions'");
  assert.doesNotMatch(text, /\(null\)/, "a missing token id must not be printed as a value");
});

test("scopes are null (unknown), never [] (none) — in the file and in --json", async () => {
  // [] is a claim: "this identity may do nothing". The CLI was never told the
  // scopes, so the only honest value is null, and the agent-facing --json
  // surface has to carry the same distinction the human text does.
  const { profilesDir } = harnessWithVerify(mcpOk);
  await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "a@machines.test", "--password", "pw", "--json"],
    profilesDir
  );

  const creds = JSON.parse(readFileSync(join(profilesDir, "guildA.json"), "utf-8"));
  assert.equal(creds.scopes, null);

  const { envelope } = await runCli(["auth", "show", "--profile", "guildA", "--json"], profilesDir);
  assert.equal(envelope?.scopes, null);
});

test("a 200 with no accessToken fails instead of writing a tokenless credentials file", async () => {
  // The machine path ends here — nothing downstream would fail loudly — so a
  // renamed/missing field would be persisted as `undefined`, reported as a
  // healthy login, and sent as `Bearer undefined` on every later call.
  const { profilesDir } = harness(() =>
    new Response(
      JSON.stringify({ user: { id: "m", email: "a@machines.test", name: "a", tenantId: "t", accountType: "machine", roles: ["machine"] } }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );

  const { envelope, exitCode } = await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "a@machines.test", "--password", "pw", "--json"],
    profilesDir
  );

  assert.equal(envelope?.ok, false);
  assert.equal(exitCode, 1);
  assert.throws(() => readFileSync(join(profilesDir, "guildA.json")), "no credentials file may be written");
});

test("a human principal coming back from the machine endpoint is rejected", async () => {
  // auth-center filters accountType before checking the password today, so this
  // cannot happen against it — the guard covers that endpoint loosening, or the
  // CLI being pointed at another deployment. Recording a human as `machine`
  // would promise an isolated memory space that does not exist.
  const { profilesDir } = harness(() =>
    new Response(
      JSON.stringify({
        accessToken: "sm_live_human",
        user: { id: "u", email: "human@example.test", name: "h", tenantId: "t", accountType: "human", roles: ["owner"] },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );

  const { envelope, exitCode } = await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "human@example.test", "--password", "pw", "--json"],
    profilesDir
  );

  assert.equal(envelope?.ok, false);
  assert.match(String(envelope?.error), /not a machine/);
  assert.equal(exitCode, 1);
  assert.throws(() => readFileSync(join(profilesDir, "guildA.json")));
});

// --- the token is used once before it is trusted -----------------------------

test("a wrong-resource token is caught at login and never written to disk", async () => {
  // auth-center reuses the resource of the machine's most recent token, so a
  // machine whose last token was for another resource gets one session-memory
  // rejects. Before this check the failure surfaced later as `not_logged_in`,
  // whose hint says "run bobby-cli auth login" — the command that made it.
  const { calls, profilesDir } = harnessWithVerify(() => new Response("nope", { status: 401 }));

  const { envelope, exitCode } = await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "a@machines.test", "--password", "pw", "--json"],
    profilesDir
  );

  assert.equal(envelope?.ok, false);
  assert.equal(envelope?.code, "permission_denied", "not not_logged_in — logging in again reproduces this");
  assert.match(String(envelope?.error), /different resource/);
  assert.equal(exitCode, 1);
  assert.throws(() => readFileSync(join(profilesDir, "guildA.json")), "a rejected token must not be saved");
  assert.equal(calls.length, 2, "one login, one verification");
});

test("a scope-less machine user is caught at login, naming the missing scope", async () => {
  // session-memory answers a scope denial as a successful result whose text is
  // "Requires scope: ..." — a machine user created without a first token comes
  // back with no scopes at all.
  const { profilesDir } = harnessWithVerify(() =>
    new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "Requires scope: memory:read" }] } }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );

  const { envelope, exitCode } = await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "a@machines.test", "--password", "pw", "--json"],
    profilesDir
  );

  assert.equal(envelope?.ok, false);
  assert.equal(envelope?.code, "permission_denied");
  assert.match(String(envelope?.error), /memory:read/);
  assert.match(String(envelope?.error), /POST \/auth\/machine-users/, "must say where scopes are actually set");
  assert.equal(exitCode, 1);
  assert.throws(() => readFileSync(join(profilesDir, "guildA.json")));
});

test("session-memory being unreachable warns but still saves — it is not evidence about the token", async () => {
  // Refusing to provision during an unrelated outage would trade one broken
  // state for another.
  const { profilesDir } = harnessWithVerify(() => new Response("boom", { status: 503 }));

  const { envelope, exitCode } = await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "a@machines.test", "--password", "pw", "--json"],
    profilesDir
  );

  assert.equal(envelope?.ok, true);
  assert.equal(envelope?.verified, false, "false means unchecked, not bad");
  assert.ok(envelope?.verifyWarning, "the operator has to be told the check did not happen");
  assert.equal(exitCode, 0);
  const creds = JSON.parse(readFileSync(join(profilesDir, "guildA.json"), "utf-8"));
  assert.equal(creds.apiToken, "sm_live_machine_token_value");
});

test("a verified machine login reports verified:true and saves", async () => {
  const { calls, profilesDir } = harnessWithVerify(mcpOk);

  const { envelope, exitCode } = await runCli(
    ["auth", "login", "--machine", "--profile", "guildA", "--email", "a@machines.test", "--password", "pw", "--json"],
    profilesDir
  );

  assert.equal(envelope?.ok, true);
  assert.equal(envelope?.verified, true);
  assert.equal(envelope?.verifyWarning, undefined);
  assert.equal(exitCode, 0);
  const verifyCalls = calls.filter((c) => !/\/auth\/m2m\/login/.test(c.url));
  assert.ok(
    verifyCalls.some((c) => /"name":"list_recent"/.test(c.body)),
    "the verification is the cheapest read there is"
  );
  assert.ok(
    !verifyCalls.some((c) => /"name":"(remember|append|forget)"/.test(c.body)),
    "verifying must never write"
  );
  assert.ok(JSON.parse(readFileSync(join(profilesDir, "guildA.json"), "utf-8")).apiToken);
});

test("a credentials file written before this feature still reads as a user login", async () => {
  tmp = mkdtempSync(join(tmpdir(), "bobby-machine-"));
  writeFileSync(
    join(tmp, "legacy.json"),
    JSON.stringify({
      authCenterUrl: "https://auth.test",
      sessionMemoryUrl: "https://mem.test/mcp",
      email: "human@example.test",
      tenantId: "chawengburi",
      apiToken: "sm_live_legacy",
      apiTokenId: "tok_legacy",
      apiTokenLabel: "bobby-cli@host",
      scopes: ["memory:read", "memory:write"],
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: null,
    }),
    { mode: 0o600 }
  );

  const { envelope } = await runCli(["auth", "show", "--profile", "legacy", "--json"], tmp);
  assert.equal(envelope?.principalType, "user");
  assert.deepEqual(envelope?.scopes, ["memory:read", "memory:write"]);
});
