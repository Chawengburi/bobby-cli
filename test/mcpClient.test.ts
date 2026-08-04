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

function stubTransport(toolResponse: Response): void {
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    // First POST is `initialize`; only its status and mcp-session-id header are
    // read, so an empty 200 is enough.
    if (call === 1) {
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "sess-1" },
      });
    }
    return toolResponse;
  }) as typeof fetch;
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
    (err: unknown) => err instanceof McpError && classifyMcpFailure(err).code === "not_logged_in",
  );
});
