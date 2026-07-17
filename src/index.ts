#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { registerAuthCommand } from "./commands/auth.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { printError } from "./output.js";
import { VERSION } from "./version.js";

// Load .env files without overriding already-exported env vars. The cwd .env
// keeps repo-local development working; ~/.bobby-cli/.env gives installed CLIs
// a per-device backend without baking those URLs into the package.
loadDotenv({ quiet: true });
loadDotenv({ path: join(homedir(), ".bobby-cli", ".env"), quiet: true });

const program = new Command();

program
  .name("bobby-cli")
  .description(
    "Unified CLI for auth-center + session-memory — one credential store and " +
      "memory client for coding agents, AI agents, openClaw, Hermes, or any other platform"
  )
  .version(VERSION);

registerAuthCommand(program);
registerMemoryCommand(program);

process.on("unhandledRejection", (err) => {
  // Never dump the raw error object — it could echo request/response bodies
  // that included a header we don't control end to end.
  printError(err instanceof Error ? err.message : "Unexpected error");
  process.exitCode = 1;
});

program.parseAsync(process.argv);
