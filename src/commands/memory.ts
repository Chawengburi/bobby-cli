import { Command } from "commander";
import { requireCredentials, resolveSessionMemoryUrl, CliAuthError } from "../config.js";
import { mcpToolCall, McpError } from "../mcpClient.js";
import { printError, printJson } from "../output.js";

interface BaseOpts {
  json?: boolean;
}

async function callTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const creds = requireCredentials();
    const sessionMemoryUrl = resolveSessionMemoryUrl(creds.sessionMemoryUrl);
    const text = await mcpToolCall(sessionMemoryUrl, creds.apiToken, toolName, args);
    return { ok: true, text };
  } catch (err) {
    if (err instanceof CliAuthError || err instanceof McpError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: (err as Error).message };
  }
}

function emit(result: { ok: true; text: string } | { ok: false; error: string }, json?: boolean): void {
  if (json) {
    printJson(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (result.ok) {
    console.log(result.text);
  } else {
    printError(result.error);
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

function parseTags(tags?: string): string[] | undefined {
  if (!tags) return undefined;
  return tags.split(",").map((t) => t.trim()).filter(Boolean);
}

export function registerMemoryCommand(program: Command): void {
  const memory = program.command("memory").description("Read and write session-memory");

  memory
    .command("show")
    .description("List recent memories (chronological, with tag filtering)")
    .option("-n, --limit <n>", "number of entries", "10")
    .option("--tags <tags>", "comma-separated tags to filter by (single tag)")
    .option("--json", "machine-readable output")
    .action(async (opts: BaseOpts & { limit: string; tags?: string }) => {
      const tags = parseTags(opts.tags);
      const result = await callTool("list_recent", {
        n: parseInt(opts.limit, 10),
        ...(tags?.[0] ? { tag: tags[0] } : {}),
      });
      emit(result, opts.json);
    });

  memory
    .command("recall <query>")
    .description("Semantically search memories")
    .option("-n, --limit <n>", "number of results", "5")
    .option("--tags <tags>", "comma-separated tags to filter by (single tag)")
    .option("--json", "machine-readable output")
    .action(async (query: string, opts: BaseOpts & { limit: string; tags?: string }) => {
      const tags = parseTags(opts.tags);
      const result = await callTool("recall", {
        query,
        topK: parseInt(opts.limit, 10),
        ...(tags?.[0] ? { tag: tags[0] } : {}),
      });
      emit(result, opts.json);
    });

  memory
    .command("remember [text]")
    .description("Save a memory (reads stdin if no text given)")
    .option("--tags <tags>", "comma-separated tags")
    .option("--json", "machine-readable output")
    .action(async (text: string | undefined, opts: BaseOpts & { tags?: string }) => {
      const content = text ?? (await readStdin());
      if (!content) {
        emit({ ok: false, error: "No content given (pass text or pipe via stdin)." }, opts.json);
        return;
      }
      const result = await callTool("remember", {
        content,
        tags: parseTags(opts.tags) ?? [],
        source: "bobby-cli",
      });
      emit(result, opts.json);
    });

  memory
    .command("append <id> <text>")
    .description("Append additional context to an existing entry")
    .option("--json", "machine-readable output")
    .action(async (id: string, text: string, opts: BaseOpts) => {
      const result = await callTool("append", { id, addition: text });
      emit(result, opts.json);
    });

  memory
    .command("forget <id>")
    .description("Delete a memory entry by ID")
    .option("--json", "machine-readable output")
    .action(async (id: string, opts: BaseOpts) => {
      const result = await callTool("forget", { id });
      emit(result, opts.json);
    });
}
