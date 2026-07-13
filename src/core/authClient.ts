// Talks to auth-center's two-tier login flow:
//   POST /auth/token  { email, password } -> Better Auth session token (short-lived)
//   POST /auth/tokens { label, resource, scopes } (Bearer <session token>) -> sm_live_... API token (shown once)
// See auth-center/src/app.ts:720 and :791.

import { describeNetworkError } from "./networkError.js";

export interface AuthCenterUser {
  id: string;
  email: string;
  name: string;
  tenantId: string | null;
  accountType: "human" | "machine";
  roles: string[];
}

export interface LoginResult {
  sessionToken: string;
  user: AuthCenterUser;
}

export interface MintedApiToken {
  rawToken: string;
  tokenId: string;
  scopes: string[];
  expiresAt: string | null;
}

export class AuthCenterError extends Error {}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function login(
  authCenterUrl: string,
  email: string,
  password: string
): Promise<LoginResult> {
  const url = `${authCenterUrl.replace(/\/$/, "")}/auth/token`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    throw new AuthCenterError(describeNetworkError(err, url));
  }

  if (!res.ok) {
    throw new AuthCenterError(`Login failed: ${await readErrorMessage(res)}`);
  }

  const data = (await res.json()) as { accessToken: string; user: AuthCenterUser };
  return { sessionToken: data.accessToken, user: data.user };
}

export async function mintApiToken(
  authCenterUrl: string,
  sessionToken: string,
  label: string
): Promise<MintedApiToken> {
  const url = `${authCenterUrl.replace(/\/$/, "")}/auth/tokens`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        label,
        resource: "session-memory",
        scopes: ["memory:read", "memory:write", "memory:delete"],
      }),
    });
  } catch (err) {
    throw new AuthCenterError(describeNetworkError(err, url));
  }

  if (!res.ok) {
    throw new AuthCenterError(`Could not mint an API token: ${await readErrorMessage(res)}`);
  }

  const data = (await res.json()) as {
    rawToken: string;
    token: { id: string; scopes: string[]; expiresAt: string | null };
  };
  return {
    rawToken: data.rawToken,
    tokenId: data.token.id,
    scopes: data.token.scopes,
    expiresAt: data.token.expiresAt,
  };
}

// Summary of an existing token from GET /auth/tokens. The endpoint's response
// also carries the raw token value — deliberately NOT picked up here so it can
// never leak through this client's return values.
export interface ApiTokenSummary {
  id: string;
  label: string;
  status: string;
  createdAt: string;
}

export async function listApiTokens(
  authCenterUrl: string,
  sessionToken: string
): Promise<ApiTokenSummary[]> {
  const url = `${authCenterUrl.replace(/\/$/, "")}/auth/tokens?resource=session-memory&status=active`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
  } catch (err) {
    throw new AuthCenterError(describeNetworkError(err, url));
  }

  if (!res.ok) {
    throw new AuthCenterError(`Could not list tokens: ${await readErrorMessage(res)}`);
  }

  const data = (await res.json()) as {
    tokens: Array<{ id: string; label: string; status: string; createdAt: string }>;
  };
  return data.tokens.map(({ id, label, status, createdAt }) => ({ id, label, status, createdAt }));
}

export async function rotateApiToken(
  authCenterUrl: string,
  sessionToken: string,
  tokenId: string
): Promise<MintedApiToken> {
  const url = `${authCenterUrl.replace(/\/$/, "")}/auth/tokens/${tokenId}/rotate`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
  } catch (err) {
    throw new AuthCenterError(describeNetworkError(err, url));
  }

  if (!res.ok) {
    throw new AuthCenterError(`Could not rotate the API token: ${await readErrorMessage(res)}`);
  }

  const data = (await res.json()) as {
    rawToken: string;
    token: { id: string; scopes: string[]; expiresAt: string | null };
  };
  return {
    rawToken: data.rawToken,
    tokenId: data.token.id,
    scopes: data.token.scopes,
    expiresAt: data.token.expiresAt,
  };
}
