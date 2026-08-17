// Talks to auth-center's two-tier login flow:
//   POST /auth/token  { email, password } -> Better Auth session token (short-lived)
//   POST /auth/tokens { label, resource, scopes } (Bearer <session token>) -> sm_live_... API token (shown once)
// See auth-center/src/app.ts:720 and :791.
//
// Machine users take a different door entirely — POST /auth/m2m/login — see
// machineLogin() below.

import { describeNetworkError, networkErrorCode } from "./networkError.js";

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

export class AuthCenterError extends Error {
  status?: number;
  networkCause?: string;
  constructor(message: string, opts?: { status?: number; networkCause?: string }) {
    super(message);
    this.status = opts?.status;
    this.networkCause = opts?.networkCause;
  }
}

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
    throw new AuthCenterError(describeNetworkError(err, url), { networkCause: networkErrorCode(err) });
  }

  if (!res.ok) {
    throw new AuthCenterError(`Login failed: ${await readErrorMessage(res)}`, { status: res.status });
  }

  const data = (await res.json()) as { accessToken: string; user: AuthCenterUser };
  return { sessionToken: data.accessToken, user: data.user };
}

// Machine users cannot use the flow above. `POST /auth/tokens` rejects them
// outright — auth-center checks `accountType === 'machine'` and answers 403
// with the comment "Machine users must use /auth/machine-users/:id/rotate-token,
// not this endpoint" — so a machine that logs in the human way gets a session
// token it can never exchange for anything.
//
// `/auth/m2m/login` is their door, and it collapses both tiers into one call:
// the response's `accessToken` IS the sm_live_... API token, already minted,
// carrying over the scopes and resource of the machine's previous token. There
// is nothing left to mint, no label to choose (auth-center hardcodes
// "m2m-login"), and no token list to rotate against — auth-center revokes the
// machine's previous active token for that resource as part of the call.
export async function machineLogin(
  authCenterUrl: string,
  email: string,
  password: string
): Promise<{ apiToken: string; user: AuthCenterUser }> {
  const url = `${authCenterUrl.replace(/\/$/, "")}/auth/m2m/login`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    throw new AuthCenterError(describeNetworkError(err, url), { networkCause: networkErrorCode(err) });
  }

  if (!res.ok) {
    throw new AuthCenterError(`Machine login failed: ${await readErrorMessage(res)}`, { status: res.status });
  }

  const data = (await res.json()) as { accessToken?: unknown; user?: AuthCenterUser };

  // Both checks guard the same failure mode: a 200 that isn't the response we
  // think it is. This call is the LAST step of the machine path — nothing
  // downstream would fail loudly — so a missing token would be written to disk
  // as `undefined`, `credentialsExist()` would report a healthy login, and
  // every later memory call would send `Bearer undefined` and 401 forever. The
  // human path gets this for free because a mint follows and blows up.
  if (typeof data.accessToken !== "string" || data.accessToken.length === 0) {
    throw new AuthCenterError(
      "Machine login returned no token — the response did not look like auth-center's. Check AUTH_CENTER points at the right deployment."
    );
  }
  // Today auth-center filters `accountType !== 'machine'` before it checks the
  // password, so a 200 already implies a machine. Asserting it anyway costs one
  // line and covers the case where that endpoint loosens or this CLI is pointed
  // at another deployment: silently recording a human as `machine` would tell
  // the operator they have an isolated memory space while they write into the
  // owner's — the single guarantee this path exists to provide.
  if (data.user?.accountType !== "machine") {
    throw new AuthCenterError(
      `Machine login returned a ${data.user?.accountType ?? "unknown"} principal, not a machine. Use \`bobby-cli auth login\` for human accounts.`
    );
  }

  return { apiToken: data.accessToken, user: data.user };
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
    throw new AuthCenterError(describeNetworkError(err, url), { networkCause: networkErrorCode(err) });
  }

  if (!res.ok) {
    throw new AuthCenterError(`Could not mint an API token: ${await readErrorMessage(res)}`, {
      status: res.status,
    });
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
    throw new AuthCenterError(describeNetworkError(err, url), { networkCause: networkErrorCode(err) });
  }

  if (!res.ok) {
    throw new AuthCenterError(`Could not list tokens: ${await readErrorMessage(res)}`, {
      status: res.status,
    });
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
    throw new AuthCenterError(describeNetworkError(err, url), { networkCause: networkErrorCode(err) });
  }

  if (!res.ok) {
    throw new AuthCenterError(`Could not rotate the API token: ${await readErrorMessage(res)}`, {
      status: res.status,
    });
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
