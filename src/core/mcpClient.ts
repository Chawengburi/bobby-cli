// Thin JSON-RPC client against session-memory's /mcp endpoint — adapted from the
// upstream second-brain-cli's mcpClient.ts pattern (github.com/rahilp/second-brain-cli).
// No MCP SDK dependency needed on the client side: post tools/call directly and
// fall back to the initialize handshake only if the server demands it (see
// mcpToolCall). Every session-memory tool (remember/append/recall/list_recent/forget)
// returns { content: [{ type: "text", text }] }.

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  // `isError` is how MCP reports a TOOL-level failure: the JSON-RPC call
  // itself succeeded (HTTP 200, `result` populated, no `error` member), but
  // the tool refused or blew up, and the reason is in `content[].text`.
  // Omitting it here is what let every tool error be read as success.
  result?: { content: Array<{ type: string; text: string }>; isError?: boolean };
  error?: { code: number; message: string };
}

import { describeNetworkError, networkErrorCode } from "./networkError.js";
import { VERSION } from "../version.js";

export class McpError extends Error {
  status?: number;
  networkCause?: string;
  scope?: string;
  constructor(message: string, opts?: { status?: number; networkCause?: string; scope?: string }) {
    super(message);
    this.status = opts?.status;
    this.networkCause = opts?.networkCause;
    this.scope = opts?.scope;
  }
}

// Tests usability, not just key presence: `{"result": null}` has a `result`
// key and is still nothing to read, and returning "" for it is the same
// "failure read as success" the isError gap produced. Both transport shapes
// route through here so they can't diverge.
function isUsable(msg: unknown): msg is JsonRpcResponse {
  if (typeof msg !== "object" || msg === null) return false;
  const { result, error } = msg as JsonRpcResponse;
  return (result ?? null) !== null || (error ?? null) !== null;
}

async function readJsonRpc(res: Response): Promise<JsonRpcResponse | null> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const body = await res.text();
    for (const line of body.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const msg: unknown = JSON.parse(line.slice(6));
        if (isUsable(msg)) return msg;
      } catch {
        // ignore malformed SSE chunks
      }
    }
    return null;
  }
  // Without this the JSON path returned "" as a successful empty result while
  // the SSE path correctly errored on the same body.
  try {
    const msg: unknown = await res.json();
    return isUsable(msg) ? msg : null;
  } catch {
    return null;
  }
}

export async function mcpToolCall(
  sessionMemoryUrl: string,
  apiToken: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const post = async (body: JsonRpcRequest, extra: Record<string, string> = {}) => {
    try {
      return await fetch(sessionMemoryUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${apiToken}`,
          ...extra,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new McpError(describeNetworkError(err, sessionMemoryUrl), {
        networkCause: networkErrorCode(err),
      });
    }
  };

  const unauthorized = (status: number) =>
    new McpError(
      "Not authorized — your session may have expired. Run `bobby-cli auth login` again.",
      { status }
    );

  const toolBody: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };

  // No initialize handshake on the happy path. session-memory runs the MCP
  // transport statelessly (`sessionIdGenerator: undefined`,
  // session-memory/src/index.ts:1331): it builds a fresh server per request, so
  // the handshake establishes nothing and the mcp-session-id it hands back is
  // never consulted. What it does cost is a second round trip per operation —
  // and a second chance to be hit by a transient edge failure. On 2026-08-13 a
  // one-off HTTP 404 on the handshake killed a `remember` that had not sent a
  // single byte of content yet. Verified live the same day: a bare tools/call
  // answers 200 for read tools and write tools alike.
  //
  // This is deliberately outside the MCP spec, which requires initialize first,
  // so the handshake stays as a fallback rather than being deleted: a
  // deployment that does enforce it (a stateful server, a future SDK bump, or
  // the production Worker if it ever diverges from dev/test) rejects the bare
  // call with 400, and we replay it properly. Safe on writes because a call
  // rejected at the transport never reached the tool.
  let toolRes = await post(toolBody);

  if (toolRes.status === 401 || toolRes.status === 403) throw unauthorized(toolRes.status);

  if (toolRes.status === 400) {
    const initRes = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "bobby-cli", version: VERSION },
      },
    });

    if (initRes.status === 401 || initRes.status === 403) throw unauthorized(initRes.status);
    if (!initRes.ok) {
      throw new McpError(`MCP init failed: HTTP ${initRes.status}`, { status: initRes.status });
    }

    const sessionHeader: Record<string, string> = {};
    const sessionId = initRes.headers.get("mcp-session-id");
    if (sessionId) sessionHeader["mcp-session-id"] = sessionId;

    // Replayed once, never in a loop: if this still fails, the 400 was about the
    // request itself, not the missing handshake, and the error below reports it.
    toolRes = await post(toolBody, sessionHeader);
    if (toolRes.status === 401 || toolRes.status === 403) throw unauthorized(toolRes.status);
  }

  if (!toolRes.ok) {
    throw new McpError(`MCP error calling ${toolName}: HTTP ${toolRes.status}`, {
      status: toolRes.status,
    });
  }

  const msg = await readJsonRpc(toolRes);
  if (!msg) throw new McpError("Empty MCP response");
  if (msg.error) throw new McpError(msg.error.message);

  const text = msg.result?.content?.map((c) => c.text).join("") ?? "";
  // .trim() before matching so a future trailing-newline change on the
  // Worker side can't make `$` fail to anchor and silently misclassify a
  // scope denial as success.
  const scopeMatch = /^Requires scope: (.+)$/.exec(text.trim());
  if (scopeMatch) {
    throw new McpError(text, { scope: scopeMatch[1] });
  }
  // The scope check above runs first as defence in depth, NOT because denials
  // are flagged today: every scope guard in the Worker returns a plain
  // successful result with no `isError` (session-memory/src/index.ts:641, 719,
  // 798, 907, 984), exactly as spec 12 § 2 records. The ordering only matters
  // if the Worker ever starts flagging them — and then `permission_denied`
  // (hint: stop, you lack permission) must still win over the generic `server`
  // code (hint: report an outage, don't retry).
  //
  // No status/networkCause: the transport succeeded, so classifyMcpFailure
  // resolves this to `server` — "the server answered and refused", which is
  // exactly what happened. Spec 12 § 2.
  if (msg.result?.isError) {
    throw new McpError(text || `MCP tool ${toolName} reported an error with no message.`);
  }
  return text;
}
