#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { Command, CommanderError } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { registerAuthCommand } from "./commands/auth.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { printError, printJson } from "./output.js";
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

// Commander's own usage errors (unknown command/option, missing required
// argument) default to writing plain text to stderr and calling
// process.exit() directly, bypassing every --json handler in commands/*.ts.
// exitOverride() makes commander throw a CommanderError instead so a --json
// caller still gets a `{ ok: false, code: "usage", ... }` envelope on stdout
// (spec 12 § 2 / T03 AC7) rather than commander's raw stderr text. This must
// run BEFORE registerAuthCommand/registerMemoryCommand: subcommands copy
// exitOverride/configureOutput from `program` at the moment they're created
// (Command.copyInheritedSettings), so setting these after subcommand
// registration silently fails to apply to any of them.
const jsonRequested = process.argv.includes("--json");
program.exitOverride();
// Suppress commander's own stderr write — the catch block below prints the
// message itself in both --json and human mode, so leaving this on would
// double-print in human mode. Non-error output (--help, --version) still
// goes through configureOutput's writeOut, untouched.
program.configureOutput({ writeErr: () => {} });

registerAuthCommand(program);
registerMemoryCommand(program);

process.on("unhandledRejection", (err) => {
  // Never dump the raw error object — it could echo request/response bodies
  // that included a header we don't control end to end.
  printError(err instanceof Error ? err.message : "Unexpected error");
  process.exitCode = 1;
});

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof CommanderError) {
    if (err.exitCode === 0) {
      process.exitCode = 0;
      return;
    }
    const message = err.message.replace(/^error: /, "");
    if (jsonRequested) {
      printJson({ ok: false, code: "usage", error: message, hint: message });
    } else {
      printError(message);
    }
    process.exitCode = err.exitCode;
    return;
  }
  printError(err instanceof Error ? err.message : "Unexpected error");
  process.exitCode = 1;
});
