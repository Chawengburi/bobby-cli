import chalk from "chalk";

// Hard rule (inherited from the openClaw sm_live_* redaction issue documented in
// this project's CLAUDE.md): raw API tokens must never reach stdout/stderr, in
// either human or --json mode. Callers must not pass a token-bearing object here.

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printSuccess(message: string): void {
  console.log(chalk.green(message));
}

export function printError(message: string): void {
  console.error(chalk.red(message));
  process.exitCode = 1;
}

export function printInfo(message: string): void {
  console.log(chalk.dim(message));
}
