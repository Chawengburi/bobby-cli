// Thin JSON-RPC client against session-memory's /mcp endpoint — adapted from the
// upstream second-brain-cli's mcpClient.ts pattern (github.com/rahilp/second-brain-cli).
// No MCP SDK dependency needed on the client side: initialize, capture the
// mcp-session-id header, then call tools/call. Every session-memory tool
// (remember/append/recall/list_recent/forget) returns { content: [{ type: "text", text }] }.

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: { content: Array<{ type: string; text: string }> };
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

async function readJsonRpc(res: Response): Promise<JsonRpcResponse | null> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const body = await res.text();
    for (const line of body.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const msg = JSON.parse(line.slice(6));
        if (msg && ("result" in msg || "error" in msg)) return msg as JsonRpcResponse;
      } catch {
        // ignore malformed SSE chunks
      }
    }
    return null;
  }
  return (await res.json()) as JsonRpcResponse;
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

  if (initRes.status === 401 || initRes.status === 403) {
    throw new McpError(
      "Not authorized — your session may have expired. Run `bobby-cli auth login` again.",
      { status: initRes.status }
    );
  }
  if (!initRes.ok) {
    throw new McpError(`MCP init failed: HTTP ${initRes.status}`, { status: initRes.status });
  }

  const sessionHeader: Record<string, string> = {};
  const sessionId = initRes.headers.get("mcp-session-id");
  if (sessionId) sessionHeader["mcp-session-id"] = sessionId;

  const toolRes = await post(
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } },
    sessionHeader
  );

  if (!toolRes.ok) {
    throw new McpError(`MCP error calling ${toolName}: HTTP ${toolRes.status}`, {
      status: toolRes.status,
    });
  }

  const msg = await readJsonRpc(toolRes);
  if (!msg) throw new McpError("Empty MCP response");
  if (msg.error) throw new McpError(msg.error.message);

  const text = msg.result?.content?.map((c) => c.text).join("") ?? "";
  const scopeMatch = /^Requires scope: (.+)$/.exec(text);
  if (scopeMatch) {
    throw new McpError(text, { scope: scopeMatch[1] });
  }
  return text;
}
