// Talks to auth-center's uploader proxy — never to the uploader itself:
//   GET {authCenterUrl}/uploader/search?query=…&…   -> { ok: true, results: [...] }
//   GET {authCenterUrl}/uploader/fetch?id=…         -> { ok: true, record, markdown, … }
//
// The caller's own sm_live_ token is the only credential involved. The token
// that opens the uploader lives in auth-center's env and this process never
// sees it, which is the whole point of spec 18.

import { AuthCenterError } from "./authClient.js";
import { describeNetworkError, networkErrorCode } from "./networkError.js";

// Must stay above auth-center's own budget for one request (20s + 1s backoff +
// 20s retry = 41s, spec 18 § 5.5). Cutting the call earlier than the server
// gives up reports a `network` failure for a server that is still working
// correctly — the bug this number exists to prevent.
const REQUEST_TIMEOUT_MS = 45_000;

export interface UploaderSearchResponse {
  ok: true;
  results: Record<string, unknown>[];
}

export interface UploaderFetchResponse {
  ok: true;
  id: string;
  mdReady?: boolean;
  record?: Record<string, unknown>;
  markdown?: string;
  chars?: number;
  truncated?: boolean;
}

async function readError(res: Response): Promise<AuthCenterError> {
  let slug: string | undefined;
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    if (typeof body.error === "string") slug = body.error;
    if (typeof body.message === "string" && body.message) message = body.message;
  } catch {
    // A non-JSON body means the response never came from auth-center's own
    // handlers (a proxy error page, say). The status still classifies it.
  }
  return new AuthCenterError(message, { status: res.status, slug });
}

async function get<T>(url: string, apiToken: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Deliberately no retry, not even here: auth-center already retries the
    // uploader leg once, and a second attempt from this side multiplies the
    // requests that reach someone else's system per command the user typed.
    throw new AuthCenterError(describeNetworkError(err, url), {
      networkCause: networkErrorCode(err),
    });
  }

  if (!res.ok) throw await readError(res);

  try {
    return (await res.json()) as T;
  } catch {
    throw new AuthCenterError("The server returned a response that was not JSON.", {
      status: res.status,
    });
  }
}

function buildUrl(authCenterUrl: string, path: string, params: Record<string, string | undefined>): string {
  const url = new URL(`${authCenterUrl.replace(/\/+$/, "")}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

export function uploaderSearch(
  authCenterUrl: string,
  apiToken: string,
  params: Record<string, string | undefined>
): Promise<UploaderSearchResponse> {
  return get<UploaderSearchResponse>(buildUrl(authCenterUrl, "/uploader/search", params), apiToken);
}

export function uploaderFetch(
  authCenterUrl: string,
  apiToken: string,
  id: string,
  maxChars: number
): Promise<UploaderFetchResponse> {
  const url = buildUrl(authCenterUrl, "/uploader/fetch", { id, max_chars: String(maxChars) });
  return get<UploaderFetchResponse>(url, apiToken);
}
