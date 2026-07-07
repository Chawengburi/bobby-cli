#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import { registerAuthCommand } from "./commands/auth.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { printError } from "./output.js";

// Loads a .env from the current working directory if present (silently a
// no-op otherwise). Only fills in vars not already set in the environment, so
// a real `export AUTH_CENTER=...` always wins over a stray .env — this is a
// convenience for local dev, not a way to override an explicit shell env.
// Safe to run after the imports above: none of them read process.env at
// module-evaluation time, only later inside command actions.
loadDotenv({ quiet: true });

const program = new Command();

program
  .name("bobby-cli")
  .description(
    "Unified CLI for auth-center + session-memory — one credential store and " +
      "memory client for coding agents, AI agents, openClaw, Hermes, or any other platform"
  )
  .version("0.1.0");

registerAuthCommand(program);
registerMemoryCommand(program);

process.on("unhandledRejection", (err) => {
  // Never dump the raw error object — it could echo request/response bodies
  // that included a header we don't control end to end.
  printError(err instanceof Error ? err.message : "Unexpected error");
  process.exitCode = 1;
});

program.parseAsync(process.argv);
