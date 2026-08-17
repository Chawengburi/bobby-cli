import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { mcpToolCall, McpError } from "../src/core/mcpClient.js";
import { classifyMcpFailure } from "../src/core/classifyFailure.js";

// Regression cover for the bug where a tool-level MCP failure was reported as
// success. session-memory answers HTTP 200 with a JSON-RPC `result` (no `error`
// member) carrying `isError: true` and the reason in `content[].text` — the
// shape below is copied from a real response captured against the deployed
// Worker. Because `isError` was never read, the error text flowed out as if it
// were a stored/recalled result and the envelope said `ok: true`.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// The happy path is a single POST — the initialize handshake is only sent if the
// server answers 400 (see mcpClient.ts). So the first response a stub hands back
// is the tool response, not an init response.
function stubTransport(toolResponse: Response): void {
  globalThis.fetch = (async () => toolResponse) as typeof fetch;
}

// Records every request so a test can assert how many round trips were made and
// what headers each carried.
function recordingTransport(responses: Response[]): Array<{ headers: Headers; body: string }> {
  const seen: Array<{ headers: Headers; body: string }> = [];
  let call = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push({ headers: new Headers(init.headers), body: String(init.body) });
    const res = responses[call] ?? responses[responses.length - 1];
    call += 1;
    return res;
  }) as unknown as typeof fetch;
  return seen;
}

function initResponse(): Response {
  return new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json", "mcp-session-id": "sess-1" },
  });
}

function jsonRpc(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("a tool error (isError) throws instead of being returned as text", async () => {
  stubTransport(
    jsonRpc({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: "MCP error -32602: Input validation error" }],
        isError: true,
      },
    }),
  );

  await assert.rejects(
    () => mcpToolCall("https://example.test/mcp", "tok", "list_recent", { n: null }),
    (err: unknown) => {
      assert.ok(err instanceof McpError);
      assert.match(err.message, /Input validation error/);
      // No status and no networkCause: the transport worked, the tool refused.
      assert.deepEqual(classifyMcpFailure(err).code, "server");
      return true;
    },
  );
});

test("a scope denial keeps permission_denied even though it is also an isError", async () => {
  // Ordering guard: if the generic isError check ran first, this would collapse
  // to `server` and the caller would be told to report an outage instead of
  // being told it lacks permission.
  stubTransport(
    jsonRpc({
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: "Requires scope: memory:write" }], isError: true },
    }),
  );

  await assert.rejects(
    () => mcpToolCall("https://example.test/mcp", "tok", "remember", {}),
    (err: unknown) => {
      assert.ok(err instanceof McpError);
      const failure = classifyMcpFailure(err);
      assert.equal(failure.code, "permission_denied");
      assert.equal(failure.scope, "memory:write");
      return true;
    },
  );
});

test("an isError with no text still throws, naming the tool", async () => {
  stubTransport(jsonRpc({ jsonrpc: "2.0", id: 2, result: { content: [], isError: true } }));

  await assert.rejects(
    () => mcpToolCall("https://example.test/mcp", "tok", "forget", { id: "x" }),
    (err: unknown) => {
      assert.ok(err instanceof McpError);
      assert.match(err.message, /forget/);
      return true;
    },
  );
});

test("a normal result is returned unchanged", async () => {
  stubTransport(
    jsonRpc({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "Stored. ID: abc" }] } }),
  );

  const text = await mcpToolCall("https://example.test/mcp", "tok", "remember", {});
  assert.equal(text, "Stored. ID: abc");
});

test("absent isError is treated as success, not as a failure", async () => {
  // Guards against over-correcting into `if (!result.isError === false)`-style
  // logic: the field is optional and its absence means the tool succeeded.
  stubTransport(
    jsonRpc({
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: "No entries found." }], isError: false },
    }),
  );

  assert.equal(await mcpToolCall("https://example.test/mcp", "tok", "list_recent", {}), "No entries found.");
});

test("a JSON-RPC protocol error still throws", async () => {
  stubTransport(jsonRpc({ jsonrpc: "2.0", id: 2, error: { code: -32601, message: "Method not found" } }));

  await assert.rejects(
    () => mcpToolCall("https://example.test/mcp", "tok", "nope", {}),
    /Method not found/,
  );
});

test("isError is honoured when the response arrives as SSE", async () => {
  // session-memory answers text/event-stream in practice — the captured live
  // response was SSE-framed, so the isError check must survive that path too.
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    result: { content: [{ type: "text", text: "MCP error -32602: bad args" }], isError: true },
  });
  stubTransport(
    new Response(`event: message\ndata: ${payload}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
  );

  await assert.rejects(
    () => mcpToolCall("https://example.test/mcp", "tok", "list_recent", {}),
    (err: unknown) => err instanceof McpError && /bad args/.test(err.message),
  );
});

test("a 401 from the transport is not_logged_in, ahead of any tool result", async () => {
  globalThis.fetch = (async () => new Response("nope", { status: 401 })) as typeof fetch;

  await assert.rejects(
    () => mcpToolCall("https://example.test/mcp", "tok", "list_recent", {}),
    (err: unknown) => {
      assert.ok(err instanceof McpError);
      assert.equal(classifyMcpFailure(err).code, "not_logged_in");
      // The human-facing wording has to survive the handshake removal: this 401
      // now arrives on the tool call, where it used to arrive on initialize.
      assert.match(err.message, /bobby-cli auth login/);
      return true;
    },
  );
});

// ── No handshake on the happy path (2026-08-13) ──────────────────────────────

test("a tool call is a single round trip — no initialize handshake", async () => {
  const seen = recordingTransport([
    jsonRpc({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "Stored. ID: abc" }] } }),
  ]);

  assert.equal(await mcpToolCall("https://example.test/mcp", "tok", "remember", {}), "Stored. ID: abc");
  assert.equal(seen.length, 1);
  assert.match(seen[0].body, /"method":"tools\/call"/);
  assert.equal(seen[0].headers.get("mcp-session-id"), null);
});

test("a 400 falls back to the handshake and replays the call with the session id", async () => {
  // What a server that does enforce initialize first answers — the reason the
  // handshake is kept as a fallback instead of deleted.
  const seen = recordingTransport([
    new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Bad Request: Server not initialized" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
    initResponse(),
    jsonRpc({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "Stored. ID: abc" }] } }),
  ]);

  assert.equal(await mcpToolCall("https://example.test/mcp", "tok", "remember", {}), "Stored. ID: abc");
  assert.equal(seen.length, 3);
  assert.match(seen[1].body, /"method":"initialize"/);
  assert.match(seen[2].body, /"method":"tools\/call"/);
  assert.equal(seen[2].headers.get("mcp-session-id"), "sess-1");
});

test("the 400 fallback replays exactly once — it does not loop", async () => {
  // A 400 that was never about the handshake (malformed arguments, say) must
  // cost one extra round trip and then surface, not retry forever.
  const seen = recordingTransport([
    new Response("bad", { status: 400 }),
    initResponse(),
    new Response("bad", { status: 400 }),
  ]);

  await assert.rejects(
    () => mcpToolCall("https://example.test/mcp", "tok", "remember", {}),
    (err: unknown) => {
      assert.ok(err instanceof McpError);
      assert.match(err.message, /HTTP 400/);
      assert.equal(classifyMcpFailure(err).code, "server");
      return true;
    },
  );
  assert.equal(seen.length, 3);
});

test("a transient non-400 failure is never retried — writes must not be replayed", async () => {
  // The 404 that started this: one bad response kills the call. Retrying a
  // tools/call is what duplicate detection exists to punish, so the fallback is
  // scoped to 400 alone.
  const seen = recordingTransport([new Response("nope", { status: 404 })]);

  await assert.rejects(
    () => mcpToolCall("https://example.test/mcp", "tok", "remember", {}),
    (err: unknown) => err instanceof McpError && classifyMcpFailure(err).code === "server",
  );
  assert.equal(seen.length, 1);
});
