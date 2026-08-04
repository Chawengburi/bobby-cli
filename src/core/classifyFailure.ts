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
export function classifyAuthCenterFailure(err: AuthCenterError, context: "login" | "other"): Failure {
  if (context === "login" && err.status === 401) return { code: "login_failed", hint: LOGIN_FAILED_HINT };
  if (err.status === 403) return { code: "permission_denied", hint: PERMISSION_DENIED_HINT };
  if (err.networkCause) return { code: "network", hint: NETWORK_HINT };
  return { code: "server", hint: SERVER_HINT };
}

export function classifyCliAuthFailure(_err: CliAuthError): Failure {
  return { code: "not_logged_in", hint: NOT_LOGGED_IN_HINT };
}
