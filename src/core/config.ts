import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_DIR = join(homedir(), ".bobby-cli");
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");
const DEFAULT_PROFILES_DIR = join(CONFIG_DIR, "profiles");
const PROFILE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

// bobby-cli talks to ONE fixed organization backend, not an arbitrary
// user-supplied one — it's published to npm for easy installation, not as a
// generic bring-your-own-backend tool. Every installer (you, openClaw, Hermes,
// any coding agent) hits the same auth-center/session-memory deployment.
//
// These are the real PRODUCTION URLs. For local dev/testing against the
// separate testing-account deployment, copy .env.example to .env or
// ~/.bobby-cli/.env — see README.
//
// AUTH_CENTER / SESSION_MEMORY_URL env vars (or dotenv files) override these —
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

// Selecting a named profile is opt-in per call (spec 10). Omitting `profile`
// entirely must reproduce today's exact single-file behavior — this is what
// lets a shared machine (openClaw) dispatch to one identity per Discord user
// via --profile, while a human/coding-agent caller on their own machine never
// has to know this exists. The caller supplies only a short name, never a
// path — bobby-cli owns the directory, so path traversal is closed by
// construction (rejecting anything the regex doesn't allow) rather than by
// validating an arbitrary caller-supplied path.
export function resolveCredentialsPath(profile?: string): string {
  if (!profile) return CREDENTIALS_PATH;
  if (!PROFILE_NAME_RE.test(profile)) {
    throw new Error(`Invalid profile name: ${profile}. Use only letters, numbers, "-", "_".`);
  }
  const profilesDir = process.env.BOBBY_CLI_PROFILES_DIR ?? DEFAULT_PROFILES_DIR;
  return join(profilesDir, `${profile}.json`);
}

export function credentialsExist(profile?: string): boolean {
  return existsSync(resolveCredentialsPath(profile));
}

export function loadCredentials(profile?: string): Credentials | null {
  const path = resolveCredentialsPath(profile);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Credentials;
  } catch {
    return null;
  }
}

export function requireCredentials(profile?: string): Credentials {
  const creds = loadCredentials(profile);
  if (!creds) {
    throw new CliAuthError("Not logged in. Run `bobby-cli auth login` first.");
  }
  return creds;
}

export function saveCredentials(creds: Credentials, profile?: string): void {
  const path = resolveCredentialsPath(profile);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function deleteCredentials(profile?: string): boolean {
  const path = resolveCredentialsPath(profile);
  if (!existsSync(path)) return false;
  rmSync(path);
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

// Deliberately no status/networkCause fields (spec 12 §2): "no local
// credentials" needs no transport detail — the class itself is the signal.
export class CliAuthError extends Error {}
