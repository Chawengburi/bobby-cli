import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { registerMemoryCommand } from "../src/commands/memory.js";
import { registerAuthCommand } from "../src/commands/auth.js";

// The classification fixes (invalid --profile → `usage`, non-numeric -n →
// `usage`) live in the command layer, so testing the core alone cannot prove
// them: an independent review reverted both fixes and the whole suite stayed
// green. These tests drive the real commander programs and assert on the
// emitted envelope, so a revert fails here.
//
// Every case below must fail BEFORE reaching the network — a test that only
// passes because a request happened to fail would prove nothing. `fetch` is
// stubbed to throw so any accidental network call is a loud failure.

const realFetch = globalThis.fetch;
const realLog = console.log;

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  process.exitCode = 0;
});

async function runCli(
  argv: string[],
  env: Record<string, string> = {}
): Promise<{ envelope: Record<string, unknown>; exitCode: number }> {
  globalThis.fetch = (async () => {
    throw new Error("test made a network call — it should have failed locally");
  }) as typeof fetch;

  const savedEnv = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(env)) {
    savedEnv.set(k, process.env[k]);
    process.env[k] = v;
  }

  const lines: string[] = [];
  console.log = (msg?: unknown) => {
    lines.push(String(msg));
  };

  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {} });
  registerAuthCommand(program);
  registerMemoryCommand(program);

  process.exitCode = 0;
  try {
    await program.parseAsync(["node", "bobby-cli", ...argv]);
  } finally {
    for (const [k, v] of savedEnv) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  return { envelope: JSON.parse(lines.join("\n")) as Record<string, unknown>, exitCode };
}

// --- invalid --profile name: every command must agree (F3) -------------------

for (const argv of [
  ["memory", "show", "--profile", "../evil", "--json"],
  ["memory", "recall", "q", "--profile", "../evil", "--json"],
  ["auth", "show", "--profile", "../evil", "--json"],
  ["auth", "forget", "--profile", "../evil", "--json"],
]) {
  test(`invalid --profile is usage: ${argv.slice(0, 2).join(" ")}`, async () => {
    const { envelope, exitCode } = await runCli(argv);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.code, "usage", `${argv.join(" ")} should classify a bad profile name as usage`);
    assert.match(String(envelope.error), /Invalid profile name/);
    assert.equal(exitCode, 1);
  });
}

test("auth login classifies an invalid --profile as usage too", async () => {
  // Regression: login resolves the profile before any network call, but its
  // catch block only knew about AuthCenterError, so this came back as `server`
  // with a hint telling the agent to report an outage over a typo.
  const { envelope, exitCode } = await runCli([
    "auth",
    "login",
    "--profile",
    "../evil",
    "--email",
    "a@b.test",
    "--password",
    "x",
    "--json",
  ]);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, "usage");
  assert.equal(exitCode, 1);
});

test("a filesystem error still produces an envelope instead of escaping the command", async (t) => {
  // The regression this guards: `auth forget`'s catch used to rethrow anything
  // that wasn't a CliUsageError. The rethrow escaped to index.ts's handler,
  // which is not --json-aware, so stdout was EMPTY and only a bare stderr line
  // appeared — spec 12 says every ok:false envelope carries a hint.
  //
  // An invalid --profile name does NOT reproduce it: that's a CliUsageError,
  // the one case the rethrowing version already handled. It takes a real I/O
  // failure, so this makes the profiles directory unwritable and deletes from
  // it. Root ignores mode 0500, and Windows has no equivalent.
  if (process.platform === "win32" || (typeof process.getuid === "function" && process.getuid() === 0)) {
    t.skip("needs POSIX permissions and a non-root user");
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "bobby-cli-ro-"));
  writeFileSync(join(dir, "locked.json"), "{}");
  chmodSync(dir, 0o500);
  try {
    const { envelope, exitCode } = await runCli(["auth", "forget", "--profile", "locked", "--json"], {
      BOBBY_CLI_PROFILES_DIR: dir,
    });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.code, "server");
    assert.ok(typeof envelope.hint === "string" && (envelope.hint as string).length > 0, "envelope must carry a hint");
    assert.equal(exitCode, 1);
  } finally {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- -n / --limit validation (F4) -------------------------------------------

for (const bad of ["abc", "0", "-3", "2.5", "1e3", "0x10", ""]) {
  test(`-n ${JSON.stringify(bad)} is rejected locally as usage`, async () => {
    const { envelope, exitCode } = await runCli(["memory", "show", "-n", bad, "--json"]);
    assert.equal(envelope.ok, false, `-n ${bad} should be rejected`);
    assert.equal(envelope.code, "usage");
    assert.match(String(envelope.error), /positive whole number/);
    assert.equal(exitCode, 1);
  });
}

test("recall validates -n the same way show does", async () => {
  const { envelope } = await runCli(["memory", "recall", "query", "-n", "abc", "--json"]);
  assert.equal(envelope.code, "usage");
});

test("a valid -n passes validation and gets past parseLimit", async () => {
  // Proves the guard rejects bad input specifically rather than everything.
  // Pinned to an empty temp profiles dir so it reads no real credentials —
  // the suite must never depend on, or disturb, the developer's own login.
  const dir = mkdtempSync(join(tmpdir(), "bobby-cli-empty-"));
  try {
    const { envelope } = await runCli(["memory", "show", "-n", "5", "--profile", "absent", "--json"], {
      BOBBY_CLI_PROFILES_DIR: dir,
    });
    assert.equal(envelope.ok, false);
    // Got past parseLimit: it fails on the missing profile, not on the flag.
    assert.equal(envelope.code, "not_logged_in");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
