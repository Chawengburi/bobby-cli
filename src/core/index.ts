export {
  credentialsExist,
  loadCredentials,
  requireCredentials,
  saveCredentials,
  deleteCredentials,
  resolveAuthCenterUrl,
  resolveSessionMemoryUrl,
  resolveCredentialsPath,
  CliAuthError,
  CliUsageError,
} from "./config.js";
export type { Credentials } from "./config.js";

export { login, machineLogin, mintApiToken, listApiTokens, rotateApiToken, AuthCenterError } from "./authClient.js";
export type { AuthCenterUser, LoginResult, MintedApiToken, ApiTokenSummary } from "./authClient.js";

export { mcpToolCall, McpError } from "./mcpClient.js";

export { parseLimit } from "./parseLimit.js";

export { uploaderSearch, uploaderFetch } from "./uploaderClient.js";
export type { UploaderSearchResponse, UploaderFetchResponse } from "./uploaderClient.js";

export { describeNetworkError } from "./networkError.js";

export {
  classifyMcpFailure,
  classifyAuthCenterFailure,
  classifyCliAuthFailure,
  SERVER_HINT,
  PERMISSION_DENIED_HINT,
} from "./classifyFailure.js";
export type { Failure } from "./classifyFailure.js";
