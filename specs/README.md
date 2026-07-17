# bobby-cli — Spec Index

Source of truth for bobby-cli's design and behavior. Written after the initial
implementation (see `../DEVELOPMENT.md` and git history) to document what was
built, why it's shaped the way it is, and what's intentionally deferred.

| # | File | Covers |
|---|------|--------|
| 01 | [01-spec-motivation-architecture.md](./01-spec-motivation-architecture.md) | Why bobby-cli exists: the MCP dynamic-token/concurrency problem it works around, and the architecture choice (thin per-invocation CLI, not an MCP client or long-lived server) |
| 02 | [02-spec-requirements.md](./02-spec-requirements.md) | Goals, users, functional requirements, design principles borrowed from popular CLIs |
| 03 | [03-spec-commands.md](./03-spec-commands.md) | Full command reference: flags, exit codes, examples |
| 04 | [04-spec-auth-model.md](./04-spec-auth-model.md) | Two-tier token flow, credential storage, known token-collision risk |
| 05 | [05-spec-config-environment.md](./05-spec-config-environment.md) | Env vars, `.env`, fixed-backend model, resolution precedence |
| 06 | [06-spec-output-conventions.md](./06-spec-output-conventions.md) | Human vs `--json` output contract, error taxonomy, token-redaction rule |
| 07 | [07-spec-roadmap-open-questions.md](./07-spec-roadmap-open-questions.md) | Deferred work (OAuth device flow, server-side revoke, credential storage hardening) and decisions that still need the user to weigh in |
| 08 | [08-spec-shared-auth-core.md](./08-spec-shared-auth-core.md) | Extracting the auth/session-memory client into a reusable module for future tools |
| 09 | [09-spec-agent-tool-schema.md](./09-spec-agent-tool-schema.md) | Tool-schema manifest so AI agents can call bobby-cli as typed tools — no shared MCP server |
| 10 | [10-spec-credential-profiles.md](./10-spec-credential-profiles.md) | `--profile` override so one shared machine (openClaw on a cloud host) can dispatch to a different identity per invocation, e.g. one profile per Discord user |
| 11 | [11-spec-claude-code-skill.md](./11-spec-claude-code-skill.md) | Claude Code skill that drives all memory ops through bobby-cli (first real consumer of the spec 09 manifest) — the dress rehearsal for openClaw's migration |
| 12 | [12-spec-agent-legible-output.md](./12-spec-agent-legible-output.md) | Structured `code`/`hint` extension to the `--json` envelope so domain outcomes and recovery instructions live in the CLI, letting agent skills shrink to policy + command table |
| 13 | [13-spec-skill-architecture.md](./13-spec-skill-architecture.md) | One single-file hand-maintained skill per CLI (revised 2026-07-18; the hub-and-spoke + `schema render` generator design was retired before implementation) — drift controlled by the same-change rule, with a growth path for when domains multiply |

**Read order:** 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 18, ESM |
| CLI framework | commander |
| Prompts | inquirer |
| Output color | chalk |
| Local dev config | dotenv |
| Transport | plain `fetch` — REST against auth-center, JSON-RPC (MCP `tools/call`) against session-memory |
| Distribution | npm, global install (`npm install -g bobby-cli`) |

## One-paragraph summary

bobby-cli is a single Node binary that any human, coding agent, or bot process
can shell out to for two things: logging in to `auth-center` and reading/writing
`session-memory`. It exists because the alternative — agents holding an MCP
client configured with a static token — broke down in practice (see
[01](./01-spec-motivation-architecture.md)). Every command is a fresh process:
it reads `~/.bobby-cli/credentials.json`, makes the HTTP/JSON-RPC calls itself,
and never lets the raw token reach stdout, an agent's context window, or any
caller.

## Related specs in this repo

- [auth-center/specs/05-spec-token-api.md](../../auth-center/specs/05-spec-token-api.md) — token issuance/scopes bobby-cli depends on
- [auth-center/tickets/03-personal-api-token.md](../../auth-center/tickets/03-personal-api-token.md) — the 1-active-token-per-principal rule and its pending multi-token amendment
- [session-memory/specs/09-spec-discord-actor.md](../../session-memory/specs/09-spec-discord-actor.md) — the openClaw MCP static-config/race-condition history that motivated bobby-cli's shape
- [session-memory/specs/02-spec-auth-center.md](../../session-memory/specs/02-spec-auth-center.md) — token introspection contract bobby-cli's calls go through
