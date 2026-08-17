// Classifies error-class instances into a canonical failure `code` + `hint`,
// per bobby-cli/tickets/T03-failure-code-hint-envelope.md (spec 12 § 2).
// The `code` values here are a subset of the canonical enum defined in
// tickets/T02-memory-outcome-classifier.md — never add a code here that
// isn't in that enum.
//
// | Situation | code | hint |
// |---|---|---|
// | no local credentials (CliAuthError), or session-memory 401 (McpError.status===401) | not_logged_in | Stop and ask the human to run 'bobby-cli auth login'. If they logged in recently, the auth server may be having an outage — report the error instead of retrying. |
// | auth-center rejected `auth login` credentials (AuthCenterError.status===401, during `auth login`) | login_failed | Login was rejected — check the email and password and try again. |
// | scope denied — McpError.scope is set, or AuthCenterError.status===403 | permission_denied | This identity does not have permission for this operation. Tell the user and suggest they contact the owner — do not retry or switch identities. |
// | network-level failure (.networkCause set) on either error class | network | The server is unreachable — check connectivity or report it; do not retry writes. |
// | server rejected the request with any other non-2xx status not covered above | server | Report this error verbatim. Do not retry writes — duplicate detection makes blind retries create duplicates. |
// | fallback: neither status nor networkCause set (a real, reachable state — empty MCP response, JSON-RPC error object, or a tool-level isError — see mcpClient.ts) | server | same server hint |
// | bad local input — commander's own validation, or a CliUsageError for checks commander can't express (invalid --profile name, non-numeric -n) | usage | commander's message unchanged; CliUsageError's own one-line message |

import type { McpError } from "./mcpClient.js";
import type { AuthCenterError } from "./authClient.js";
import type { CliAuthError } from "./config.js";

export interface Failure {
  code: string;
  hint: string;
  scope?: string;
}

export const NOT_LOGGED_IN_HINT =
  "Stop and ask the human to run 'bobby-cli auth login'. If they logged in recently, the auth server may be having an outage — report the error instead of retrying.";
export const LOGIN_FAILED_HINT = "Login was rejected — check the email and password and try again.";
export const PERMISSION_DENIED_HINT =
  "This identity does not have permission for this operation. Tell the user and suggest they contact the owner — do not retry or switch identities.";
export const NETWORK_HINT = "The server is unreachable — check connectivity or report it; do not retry writes.";
export const SERVER_HINT =
  "Report this error verbatim. Do not retry writes — duplicate detection makes blind retries create duplicates.";

export function classifyMcpFailure(err: McpError): Failure {
  if (err.status === 401) return { code: "not_logged_in", hint: NOT_LOGGED_IN_HINT };
  if (err.scope) return { code: "permission_denied", hint: PERMISSION_DENIED_HINT, scope: err.scope };
  if (err.networkCause) return { code: "network", hint: NETWORK_HINT };
  // Covers both "other non-2xx status" (e.g. a bare 403 with no .scope, or a
  // 5xx) and the fallback row (neither status nor networkCause set, e.g. an
  // empty MCP response or a JSON-RPC error object over HTTP 2xx) — both are
  // "server" per the table.
  return { code: "server", hint: SERVER_HINT };
}

// auth-center 401s outside of `auth login` are not a defined case in spec
// 12's table — only login-time 401 means "login_failed". Anywhere else, an
// AuthCenterError 401 falls through to "server" (deliberate, per T03).
//
// The "uploader" context is the one exception, added by spec 18 § 6.3: on
// /uploader/* a 401 means the caller's OWN token is dead, so `bobby-cli auth
// login` genuinely fixes it. Calling this with "other" for uploader errors
// would classify every expired token as `server` — and the T03 test suite
// would stay green, because `server` is what "other" is supposed to return.
export function classifyAuthCenterFailure(
  err: AuthCenterError,
  context: "login" | "other" | "uploader"
): Failure {
  if (context === "login" && err.status === 401) return { code: "login_failed", hint: LOGIN_FAILED_HINT };
  if (context === "uploader" && err.status === 401) return { code: "not_logged_in", hint: NOT_LOGGED_IN_HINT };
  if (err.status === 403) return { code: "permission_denied", hint: PERMISSION_DENIED_HINT };
  if (err.networkCause) return { code: "network", hint: NETWORK_HINT };
  // A 400 from /uploader/* is `usage`: every documented cause is screened
  // client-side first, so one that still arrives is input this CLI failed to
  // catch — a bug worth reporting as such, not an outage.
  if (context === "uploader" && err.status === 400) return { code: "usage", hint: err.message };
  if (context === "uploader") return { code: "server", hint: uploaderServerHint(err.slug) };
  return { code: "server", hint: SERVER_HINT };
}

// Five distinct server-side slugs collapse into `code: "server"`, so the hint
// is the only place left to say what a human should actually do about it.
// Machines read `reason` (the slug itself) off the envelope instead.
function uploaderServerHint(slug?: string): string {
  switch (slug) {
    case "uploader_not_configured":
      return "The document service is not configured on the server. Tell the user to contact the auth-center administrator — logging in again will not help.";
    case "uploader_auth_failed":
      return "The server's own document-service credential was rejected. Tell the user to contact the auth-center administrator — this is not their login, and logging in again will not help.";
    case "uploader_rate_limited":
      return "The document service is rate limiting requests. Wait and try again later.";
    case "too_many_requests":
      return "You are asking too often. Wait a moment before trying again.";
    case "uploader_unavailable":
      return "The document service is unavailable right now. Report it and try again later.";
    default:
      return SERVER_HINT;
  }
}

export function classifyCliAuthFailure(_err: CliAuthError): Failure {
  return { code: "not_logged_in", hint: NOT_LOGGED_IN_HINT };
}
