# 12 Spec: Agent-Legible Output — shrinking skill prose by moving semantics into the CLI

> **Status: ACCEPTED (2026-07-17) — ticket-ready.** All open items from the
> 2026-07-15 expert review are resolved; decisions recorded in
> `docs/sessions/NEXT-SESSION-PROMPT-2026-07-16.md` (chawengburi repo) and
> reflected inline: `text`→`code` contract (§ 1.1), error-class enrichment
> (§ 2, amends spec 06), per-(transport, status) failure classification
> (§ 2 — revised 2026-07-17 after a verification review caught the original
> status-only rule testing the wrong endpoints), `auth show` normalization
> (§ 2.1).

> Decision context: 2026-07-15 discussion — the `bobby-cli` Claude Code skill
> (spec 11 trial) is invoked every session (recall-at-start is mandatory), so
> its ~4.8 KB body is a context cost paid every session. Roughly 40–50% of
> that body is prose compensating for the CLI's flat output contract: how to
> read domain outcomes out of `text`, why `ok: true` isn't success, what to
> do on `Not logged in`. The long-term direction is ONE `bobby-cli` skill
> bundling every domain (memory today; auth and future domains later) — with
> the current contract, per-domain instruction prose grows linearly. This
> spec moves those semantics into the CLI itself so every consumer (Claude
> Code skill, openClaw skill, any future agent) gets them for free.
>
> Builds on: [06-spec-output-conventions.md](./06-spec-output-conventions.md)
> (the `{ ok, text | error }` envelope this spec extends; its "Error taxonomy"
> section already notes the cost of losing structured codes and defers the
> question to spec 07 — this spec is the answer),
> [11-spec-claude-code-skill.md](./11-spec-claude-code-skill.md) (the trial
> that produced the evidence), [09-spec-agent-tool-schema.md](./09-spec-agent-tool-schema.md)
> (`schema/tools.json` must describe whatever this spec adds).

## Problem

Findings from the spec 11 trial (verified 2026-07-14) that each cost standing
skill prose to work around:

1. **`ok: true` ≠ the operation had its intended effect.** Domain outcomes —
   `... not found.`, `Duplicate detected (N% match) — not stored.`,
   `... Tagged as duplicate-candidate.` — come back as exit-0 successes with
   the real result embedded in the human-formatted `text` string. The skill
   must teach the agent to string-match `text` after every write.
2. **Errors describe, they don't instruct.** `Not logged in` requires the
   skill to carry a recovery paragraph ("stop, tell the human to run
   `bobby-cli auth login`, never collect credentials"). An agent that hasn't
   loaded that paragraph does the wrong thing.
3. **Input strictness leaks into instructions.** Rules like "never pass
   `--tags` with an empty string" exist only because the CLI treats a
   degenerate-but-unambiguous input as an error instead of ignoring it.

What does NOT move into the CLI (tried and rejected in the same discussion):
replacing the skill's command-template table with "run `--help`". Help output
enters the agent's context anyway when fetched, is wordier than the table,
and adds a tool call — it relocates the token cost, it doesn't reduce it.

## Goal

Extend the `--json` envelope and error messages so that:

- domain outcomes are machine-readable (`code` + structured fields), and
- every failure message tells the agent what to do next,

allowing the `bobby-cli` skill body to shrink to **policy + command table**
(target ≤ ~2.5 KB), and every future domain added to the CLI to ship with
near-zero new skill prose.

## Non-goals

- Changing the one hard rule (spec 06): raw tokens still never reach
  stdout/stderr. Nothing in this spec adds fields sourced from the
  credentials object.
- Removing `text`. Humans (and the current skill) keep the formatted string;
  structured fields are additive.
- Server-side changes to duplicate detection (the Vectorize indexing lag is
  a session-memory Worker property, not a CLI property).

## Design

### 1. Envelope extension: `code` + structured fields (backward compatible)

Every `memory *` command's JSON output gains an optional `code` string and,
where applicable, structured fields. Existing consumers that only read
`ok`/`text`/`error` keep working unchanged.

| Outcome (today: buried in `text`) | Extended envelope |
|---|---|
| stored normally | `{ ok: true, code: "stored", id, text }` |
| stored but ≥85% similar | `{ ok: true, code: "duplicate_candidate", id, similarity, text }` |
| rejected, >95% match | `{ ok: true, code: "duplicate_rejected", existingId, similarity, text }` |
| append succeeded | `{ ok: true, code: "appended", id, text }` |
| forget succeeded | `{ ok: true, code: "forgotten", id, text }` |
| append/forget on missing ID | `{ ok: true, code: "not_found", id, text }` |
| recall/show results (incl. empty) | `{ ok: true, code: "results", count, text }` |
| scope denied (arrives as a 200 `text`, not an HTTP 403 — see § 1.1 and § 2) | `{ ok: false, code: "permission_denied", scope, error, hint }` |
| transport/auth failure | `{ ok: false, code: "...", error, hint }` (see § 2) |

Notes:

- `id` / `existingId` / `similarity` are parsed from the server's `text` by
  the CLI (the same strings the skill currently teaches the agent to parse —
  the parsing moves to one tested place instead of N skill files). The exact
  mapping is a contract — see § 1.1.
- `similarity` is a **0–1 float** (e.g. `0.97`), matching the Worker's
  internal thresholds (block > 0.95, warn > 0.85). The server `text` says
  `"97% match"`; the CLI divides by 100. One unit everywhere in the
  structured fields, regardless of how the prose phrases it. Precision is
  bounded by the source: the MCP emit sites round to an integer percent
  (`toFixed(0)`), so `similarity` resolves in 0.01 steps — the CLI cannot
  recover more than the Worker prints.
- Empty recall/show results are not a special code: `code: "results"` with
  `count: 0`. Note the two surfaces use different empty strings — recall
  says `Nothing found matching that query.`, show/list says
  `No entries found.` — both map to `results`/`count: 0` (§ 1.1).
- `duplicate_rejected` and `not_found` stay `ok: true` / exit 0 in this
  spec: `ok` keeps meaning "the call reached the server and the server
  answered", exactly as spec 06 defines it. Whether domain non-effects
  should become exit-code failures is an Open question (breaking change).
- If the CLI cannot confidently classify `text`, it emits
  `code: "unclassified"` with the untouched `text` — never guess.

### 1.1 The `text`→`code` contract (decided 2026-07-17)

The classification is a string contract, written down here and matched
exactly. Source of truth: `session-memory/src/index.ts` (line refs as of
2026-07-17):

| Server `text` pattern (canonical) | `code` | Extracted fields |
|---|---|---|
| `Stored. ID: <id>` | `stored` | `id` |
| `Stored with ID: <id> — note: similar entry exists (<N>% match, ID: <matchId>). Tagged as duplicate-candidate.` | `duplicate_candidate` | `id`, `similarity` (= N/100), `existingId` (= matchId) |
| `Duplicate detected (<N>% match) — not stored. Existing entry ID: <id>` | `duplicate_rejected` | `similarity` (= N/100), `existingId` |
| `Appended to entry <id>. …` (prefix match) | `appended` | `id` |
| `Forgotten: <id>` | `forgotten` | `id` |
| `No entry found with ID: <id>` (append) | `not_found` | `id` |
| `Entry <id> not found.` (forget) | `not_found` | `id` |
| `Requires scope: <scope>` (any tool — see § 2 on why this is a 200, not a 403) | `permission_denied` — **flips the envelope to `ok: false`, exit 1, with the § 2 hint** | `scope` |
| `Nothing found matching that query.` (recall, empty) | `results` | `count: 0` |
| `No entries found.` (show/list, empty) / numbered entry list | `results` | `count` (0 for the former) |

`permission_denied` is deliberately the **only** row that overrides `ok`:
the server said 200 but authorization blocked the effect, and reporting
that as success is the worst possible misread (verified failure mode,
2026-07-17 review finding B1). Every other row keeps `ok`'s
"transport succeeded" meaning. The Worker's append-validation strings
(`Addition cannot be empty.`, `Append failed: <message>`) intentionally
have no row — they fall to `code: "unclassified"` with the server text
intact, which is the correct honest answer for rare/unstructured failures.

Two obligations come with this table:

1. **Worker side:** these strings are hereby declared part of the
   session-memory Worker's API surface. Changing any of them is a breaking
   change and must update this table (and the CLI's classifier + tests) in
   the same change. This obligation must be recorded in the session-memory
   repo (a comment at each emit site plus a note in its spec set) as part
   of implementing this spec.
2. **CLI side:** the classifier matches these patterns and nothing looser.
   Anything unmatched → `code: "unclassified"` (never a wrong code), which
   doubles as the drift alarm if obligation 1 is ever missed.

**Bridge, not destination (decision c):** string-matching is the v1
transport because it needs no Worker change. The roadmap step is for the
Worker to return machine-readable outcomes itself (MCP
`structuredContent` in the tool response); once the CLI reads those, this
table stops being load-bearing and becomes a fallback for older Workers.
That Worker change lands in the session-memory repo on its own schedule —
it must not block this spec's implementation.

### 2. Failure `code` + `hint`: errors that instruct

The three error classes (spec 06: `AuthCenterError`, `McpError`,
`CliAuthError`) map to stable failure codes, and every failure envelope
gains a `hint` — one sentence telling the caller (human or agent) the next
action:

| Situation | `code` | `hint` |
|---|---|---|
| no local credentials (`CliAuthError`), or session-memory answered **401** (token invalid/expired/inactive) | `not_logged_in` | `Stop and ask the human to run 'bobby-cli auth login'. If they logged in recently, the auth server may be having an outage — report the error instead of retrying.` |
| auth-center rejected `auth login` credentials (**401 on the auth-center transport**) | `login_failed` | `Login was rejected — check the email and password and try again.` |
| scope denied — session-memory answers **200** with `Requires scope: <scope>` (§ 1.1), or an auth-center endpoint answers **403** | `permission_denied` | `This identity does not have permission for this operation. Tell the user and suggest they contact the owner — do not retry or switch identities.` |
| server unreachable (`ECONNREFUSED`, DNS, …) | `network` | `The server is unreachable — check connectivity or report it; do not retry writes.` |
| server rejected the request (other 4xx/5xx) | `server` | `Report this error verbatim. Do not retry writes — duplicate detection makes blind retries create duplicates.` |
| bad local input (unknown flag, missing arg) | `usage` | commander's own message, unchanged |

**Classification is per (transport, status), never status alone** (revised
2026-07-17 after review finding that a status-only rule was verified
against REST endpoints the CLI doesn't use):

- **session-memory transport (`McpError`, the `/mcp` endpoint):** the
  Worker returns `401 {"error":"Unauthorized"}` for every token problem —
  missing, unknown, inactive, wrong resource (`src/index.ts:89–138`,
  confirmed live) → `not_logged_in`. It **never returns 403 to the CLI**:
  scope enforcement happens inside each MCP tool handler and comes back as
  a *successful* JSON-RPC result whose text is `Requires scope: <scope>`
  (e.g. `:637` write, `:932` delete) — which is why `permission_denied` on
  this transport is detected by the § 1.1 text contract, not by status.
  **Verified live 2026-07-17** with a freshly minted `memory:read`-only
  token against the test deployment: `tools/call remember` → HTTP 200 +
  `Requires scope: memory:write`, while `tools/call list_recent` with the
  same token succeeded (denial is scope-driven, not a broken token).
  (The `403`s at `:985`/`:1048` belong to the REST `/capture`/`/list`
  endpoints, which bobby-cli never calls.)
- **auth-center transport (`AuthCenterError`, `/auth/token` +
  `/auth/tokens`):** a 401 during `auth login` means the submitted
  credentials were rejected → `login_failed` — NOT `not_logged_in`, whose
  hint ("run `auth login`") would be circular advice in the middle of a
  login. A 403 (e.g. requested scopes exceed allowed) → `permission_denied`.
- **Known ambiguity (accepted degradation):** if auth-center introspection
  is down, the Worker's `introspectToken()` catches the failure, returns
  null, and the Worker answers 401 — indistinguishable from a bad token at
  the CLI. A healthy token can therefore surface as `not_logged_in` during
  an auth-center outage. Accepted for v1 because the Worker gives the CLI
  nothing to tell the cases apart; the `not_logged_in` hint is worded above
  to keep an agent from looping re-login during an outage. The real fix
  (Worker distinguishes "introspection unavailable" as a 503) is a
  session-memory roadmap item alongside the § 1.1 structuredContent step.

**Prerequisite (amends spec 06):** this classification needs the HTTP
status and network cause, which the error classes don't carry today.
`AuthCenterError`, `McpError`, and `CliAuthError` gain optional structured
fields — `status?: number` (HTTP status when the server answered) and
`networkCause?: string` (the network error code from `describeNetworkError()`,
e.g. `ECONNREFUSED`, when it didn't). Spec 06's "plain Error, no extra
fields" statement is superseded; spec 06's Error-taxonomy section is
updated in the same change as this spec (not left as a remote amendment).
Call sites that only read `.message` keep working — the fields are
additive.

| Error state | Fields set |
|---|---|
| server answered non-2xx | `status` |
| connection-level failure | `networkCause` |
| no local credentials (`CliAuthError`) | neither — the class itself is the signal |

`permission_denied` exists because authorization is **server-side by design**:
scopes live on the API token and are enforced by auth-center introspection,
never by the skill or the calling bot. Today this can already occur within
the existing `memory:*` scope set (e.g. a token holding `memory:read` but
not `memory:write`). As bobby-cli grows scope-gated domains (uploader is
the first planned case on multi-user openClaw hosts), this becomes one of
the most common failures an agent sees, and the hint is what keeps "user
lacks permission" from being misread as "the command is broken". Note:
auth-center's current scope model is a **fixed set** — unknown scopes are
rejected with 400, so any uploader scope requires an auth-center amendment
first (tracked in the uploader spec, not here).

Human (non-`--json`) mode prints the same hint after the error line. This is
the highest-leverage change in the spec: instructions arrive exactly when
they're needed, at zero standing context cost — the skill's auth-recovery
and retry-safety paragraphs reduce to one line each ("follow the `hint`").

### 2.1 `auth show` joins the envelope (decided 2026-07-17)

The `{ loggedIn }` shape — the inconsistency spec 06 records and specs
07/09 re-defer — is normalized here rather than deferred a fifth time. The
only consumers today are the Claude Code skill (rewritten by this spec
anyway) and the manifest's `output_schema` (updated per § 5), so the blast
radius will never be smaller.

| State | New shape | Exit |
|---|---|---|
| logged in | `{ ok: true, code: "status", loggedIn: true, email, tenantId, apiTokenLabel, apiTokenId, scopes, createdAt, expiresAt, authCenterUrl, sessionMemoryUrl }` | 0 |
| not logged in | `{ ok: true, code: "status", loggedIn: false, hint: "Run 'bobby-cli auth login' to log in." }` | 0 |

Not-logged-in stays `ok: true` / exit 0: asking "am I logged in?" and
learning "no" is a successfully answered question, not a failure — which
also keeps the change additive-plus-rename rather than a semantics flip.
`loggedIn` remains as the domain field. With this, "every `ok: false`
envelope carries a `hint`" is true without exceptions, and the not-logged-in
status answer carries one too.

### 3. Input tolerance

- `--tags ''` (empty string) is ignored, as if the flag were omitted —
  deletes the "never substitute optional flags as empty strings" rule for
  this flag. The spec 09 argv discipline stays the general rule; the CLI
  just stops punishing the most common violation.
- Trailing/duplicate commas in `--tags` (`a,,b,`) are normalized, not
  errored.

### 4. Skill diet (consequence, not a change in this repo's CLI)

Once 1–3 ship, `.claude/skills/bobby-cli/SKILL.md` shrinks to:

- the command-template table (kept — see Problem § on why `--help` doesn't
  replace it),
- the stdin-heredoc quoting rule (inherent to Bash, can't move),
- project policy: recall-at-start, store-don't-ask, append-over-duplicate,
  tag taxonomy, never-print-credentials (policy belongs in the skill),
- one line: "on `ok: false`, follow `hint`; on writes, branch on `code`".

Everything else — the Output contract section's `text`-parsing instructions,
the duplicate-lag warning's placement, the auth recovery paragraph — is
deleted or reduced to a single line. The same diet applies verbatim to the
future openClaw skill: this is the multiplier, since openClaw's skill would
otherwise duplicate all of that prose.

The skill stays a **single hand-maintained file** with one short section
per domain — see [13-spec-skill-architecture.md](./13-spec-skill-architecture.md)
(revised 2026-07-18: single-file architecture, no generator). This spec's
diet is what makes a complete single file that small.

### 5. Schema manifest

`schema/tools.json` (spec 09) gains the envelope description: the `code`
enum per tool and the `hint` field, so typed-tool executors can branch
without reading this spec. Updating every affected `output_schema`
(including `auth_show`'s normalized shape from § 2.1) in the same change
is an acceptance criterion, not a follow-up — the manifest documenting the
old shapes against the new CLI is exactly the drift spec 09 exists to
prevent.

## Success criteria

1. **Compat** — existing spec 11 skill keeps working unmodified against the
   new CLI (fields are additive; `text`/`error` unchanged).
2. **Coverage** — every domain outcome observed in the spec 11 trial
   (`not found`, `duplicate_rejected`, `duplicate_candidate`) plus the
   success codes (`stored`, `appended`, `forgotten`, `results`) yields the
   documented `code` + fields; induced transport failures yield
   `code` + `hint`; an induced scope denial (token without `memory:write`
   driving `memory remember` through `/mcp`) yields
   `ok: false, code: "permission_denied"` + hint — this last case must be
   exercised against a real scoped token, not simulated, since the 200-text
   shape is exactly what the original review missed.
3. **Diet realized** — SKILL.md rewritten per § 4 lands at ≤ ~2.5 KB and a
   fresh session passes the spec 11 trial protocol (all five ops, error
   legibility test) with the slim skill.
4. **No leakage** — grep over new output paths confirms no credential-derived
   fields; the `unhandledRejection` guard still emits `.message` only.
5. **Manifest updated** — every affected `output_schema` in
   `schema/tools.json` describes the extended envelope (`code`, `hint`,
   structured fields, `auth_show`'s § 2.1 shape) in the same change.
6. **Edge behaviors verified at implementation** (decided 2026-07-17, verify
   don't assume): (a) commander `usage` errors under `--json` actually emit
   the failure envelope on stdout — if commander's default writes plain text
   to stderr first, wrap it; (b) empty recall/show yields
   `code: "results", count: 0`.

## Open questions

1. Should `duplicate_rejected` / `not_found` become `ok: false` + exit 1?
   Cleaner semantics, but breaking for anything scripted against exit 0, and
   it muddies `ok`'s "transport succeeded" meaning. Deferred until openClaw
   migration says which semantics its dispatcher wants.
2. ~~Fix the `auth login` vs `auth show` envelope inconsistency while
   touching output code anyway?~~ **Decided 2026-07-17: yes, in scope —
   § 2.1.**
3. Should `hint` text live in the CLI or in `schema/tools.json` (per-tool
   `on_error` guidance)? CLI-embedded is simpler and works for shell-out
   consumers that never read the manifest — start there.
4. When the session-memory Worker ships `structuredContent` (§ 1.1 roadmap),
   does the CLI prefer it silently or version-gate on the Worker? Decide in
   the session-memory repo when that change is specced.
