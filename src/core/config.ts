import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".bobby-cli");
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");

// bobby-cli talks to ONE fixed organization backend, not an arbitrary
// user-supplied one — it's published to npm for easy installation, not as a
// generic bring-your-own-backend tool. Every installer (you, openClaw, Hermes,
// any coding agent) hits the same auth-center/session-memory deployment.
//
// These are the real PRODUCTION URLs. For local dev/testing against the
// separate testing-account deployment, copy .env.example to .env — see README.
//
// AUTH_CENTER / SESSION_MEMORY_URL env vars (or a local .env) override these —
// that's for your own dev/testing, not a feature for end users to touch.
const DEFAULT_AUTH_CENTER_URL = "https://auth-center.phantaporntr.workers.dev";
const DEFAULT_SESSION_MEMORY_URL = "https://second-brain.phantaporntr.workers.dev/mcp";

export interface Credentials {
  authCenterUrl: string;
  sessionMemoryUrl: string;
  email: string;
  tenantId: string | null;
  apiToken: string;
  apiTokenId: string;
  apiTokenLabel: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
}

export function credentialsExist(): boolean {
  return existsSync(CREDENTIALS_PATH);
}

export function loadCredentials(): Credentials | null {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8")) as Credentials;
  } catch {
    return null;
  }
}

export function requireCredentials(): Credentials {
  const creds = loadCredentials();
  if (!creds) {
    throw new CliAuthError("Not logged in. Run `bobby-cli auth login` first.");
  }
  return creds;
}

export function saveCredentials(creds: Credentials): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function deleteCredentials(): boolean {
  if (!existsSync(CREDENTIALS_PATH)) return false;
  rmSync(CREDENTIALS_PATH);
  return true;
}

// Resolution order: explicit env override (or .env) > stored value from a
// prior login > the fixed org default above.
export function resolveAuthCenterUrl(stored?: string | null): string {
  return process.env.AUTH_CENTER ?? stored ?? DEFAULT_AUTH_CENTER_URL;
}

export function resolveSessionMemoryUrl(stored?: string | null): string {
  return process.env.SESSION_MEMORY_URL ?? stored ?? DEFAULT_SESSION_MEMORY_URL;
}

export class CliAuthError extends Error {}
