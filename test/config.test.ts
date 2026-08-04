import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  CliUsageError,
  resolveAuthCenterUrl,
  resolveCredentialsPath,
  resolveSessionMemoryUrl,
} from "../src/core/config.js";

// All pure path/URL resolution — nothing here reads or writes the real
// ~/.bobby-cli, so running the suite can never disturb a live login.

const CONFIG_DIR = join(homedir(), ".bobby-cli");

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("no profile resolves to the single default credentials file", () => {
  assert.equal(resolveCredentialsPath(), join(CONFIG_DIR, "credentials.json"));
});

test("omitting the profile reproduces default behaviour exactly (spec 10)", () => {
  // openClaw dispatches per-Discord-user via --profile; a human on their own
  // machine must never be routed into the profiles directory by accident.
  assert.equal(resolveCredentialsPath(undefined), resolveCredentialsPath());
  assert.equal(resolveCredentialsPath(""), resolveCredentialsPath());
});

test("a named profile lands inside the profiles directory", () => {
  withEnv({ BOBBY_CLI_PROFILES_DIR: undefined }, () => {
    assert.equal(resolveCredentialsPath("discord-team"), join(CONFIG_DIR, "profiles", "discord-team.json"));
  });
});

test("BOBBY_CLI_PROFILES_DIR relocates profiles", () => {
  withEnv({ BOBBY_CLI_PROFILES_DIR: "/tmp/bobby-profiles" }, () => {
    assert.equal(resolveCredentialsPath("alice"), "/tmp/bobby-profiles/alice.json");
  });
});

test("profile names that could escape the directory are rejected as CliUsageError", () => {
  // bobby-cli owns the directory and the caller supplies only a short name, so
  // traversal is closed by rejecting anything outside [A-Za-z0-9_-] rather
  // than by trying to sanitise an arbitrary path.
  //
  // The error CLASS matters as much as the rejection: `auth show` and
  // `memory show` both classify this input by `instanceof CliUsageError`. When
  // it was a bare Error they each guessed, and the same typo came back as
  // `usage` from one command and `server` from the other.
  for (const bad of ["../evil", "a/b", "..", "a b", "a.json", "/etc/passwd", "a\\b"]) {
    assert.throws(
      () => resolveCredentialsPath(bad),
      (err: unknown) => err instanceof CliUsageError && /Invalid profile name/.test((err as Error).message),
      `expected CliUsageError: ${bad}`,
    );
  }
});

test("auth-center URL precedence: env > stored > baked-in default", () => {
  withEnv({ AUTH_CENTER: "https://env.example" }, () => {
    assert.equal(resolveAuthCenterUrl("https://stored.example"), "https://env.example");
  });
  withEnv({ AUTH_CENTER: undefined }, () => {
    assert.equal(resolveAuthCenterUrl("https://stored.example"), "https://stored.example");
    // The default is the production deployment — asserting the shape, not the
    // exact host, so a legitimate URL change doesn't fail the suite, while
    // accidentally shipping a test/localhost default still does.
    const fallback = resolveAuthCenterUrl(null);
    assert.match(fallback, /^https:\/\//);
    assert.doesNotMatch(fallback, /localhost|127\.0\.0\.1/);
  });
});

test("session-memory URL precedence: env > stored > baked-in default", () => {
  withEnv({ SESSION_MEMORY_URL: "https://env.example/mcp" }, () => {
    assert.equal(resolveSessionMemoryUrl("https://stored.example/mcp"), "https://env.example/mcp");
  });
  withEnv({ SESSION_MEMORY_URL: undefined }, () => {
    assert.equal(resolveSessionMemoryUrl("https://stored.example/mcp"), "https://stored.example/mcp");
    const fallback = resolveSessionMemoryUrl(null);
    assert.match(fallback, /^https:\/\/.*\/mcp$/);
    assert.doesNotMatch(fallback, /localhost|127\.0\.0\.1/);
  });
});
