import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyAuthCenterFailure,
  classifyCliAuthFailure,
  classifyMcpFailure,
  LOGIN_FAILED_HINT,
  NETWORK_HINT,
  NOT_LOGGED_IN_HINT,
  PERMISSION_DENIED_HINT,
  SERVER_HINT,
} from "../src/core/classifyFailure.js";
import { McpError } from "../src/core/mcpClient.js";
import { AuthCenterError } from "../src/core/authClient.js";
import { CliAuthError } from "../src/core/config.js";

// Agents branch on `code`, so a wrong code is worse than a wrong message —
// e.g. classifying a permission failure as `network` invites a retry loop
// against a server that will never say yes. Contract: spec 12 § 2 / T03.

test("mcp 401 is not_logged_in", () => {
  assert.deepEqual(classifyMcpFailure(new McpError("nope", { status: 401 })), {
    code: "not_logged_in",
    hint: NOT_LOGGED_IN_HINT,
  });
});

test("mcp scope denial is permission_denied and preserves the scope", () => {
  assert.deepEqual(classifyMcpFailure(new McpError("nope", { status: 403, scope: "memory:write" })), {
    code: "permission_denied",
    hint: PERMISSION_DENIED_HINT,
    scope: "memory:write",
  });
});

test("mcp network failure is network", () => {
  assert.deepEqual(classifyMcpFailure(new McpError("down", { networkCause: "ECONNREFUSED" })), {
    code: "network",
    hint: NETWORK_HINT,
  });
});

test("mcp 403 without a scope falls through to server, not permission_denied", () => {
  assert.deepEqual(classifyMcpFailure(new McpError("forbidden", { status: 403 })), {
    code: "server",
    hint: SERVER_HINT,
  });
});

test("mcp error with neither status nor networkCause is server", () => {
  assert.deepEqual(classifyMcpFailure(new McpError("empty response")), {
    code: "server",
    hint: SERVER_HINT,
  });
});

test("401 outranks scope — re-auth is the actionable step, not a permission message", () => {
  assert.equal(
    classifyMcpFailure(new McpError("nope", { status: 401, scope: "memory:write" })).code,
    "not_logged_in",
  );
});

test("auth-center 401 during login is login_failed", () => {
  assert.deepEqual(classifyAuthCenterFailure(new AuthCenterError("bad creds", { status: 401 }), "login"), {
    code: "login_failed",
    hint: LOGIN_FAILED_HINT,
  });
});

test("auth-center 401 outside login is server, deliberately not login_failed", () => {
  // Telling an agent "check the email and password" when it never submitted
  // any would send it down a dead end. T03 makes this explicit.
  assert.deepEqual(classifyAuthCenterFailure(new AuthCenterError("expired", { status: 401 }), "other"), {
    code: "server",
    hint: SERVER_HINT,
  });
});

test("auth-center 403 is permission_denied", () => {
  assert.equal(
    classifyAuthCenterFailure(new AuthCenterError("no", { status: 403 }), "other").code,
    "permission_denied",
  );
});

test("auth-center network failure is network", () => {
  assert.equal(
    classifyAuthCenterFailure(new AuthCenterError("down", { networkCause: "ENOTFOUND" }), "login").code,
    "network",
  );
});

test("missing local credentials is not_logged_in", () => {
  assert.deepEqual(classifyCliAuthFailure(new CliAuthError("Not logged in.")), {
    code: "not_logged_in",
    hint: NOT_LOGGED_IN_HINT,
  });
});
