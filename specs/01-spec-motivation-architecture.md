# 01 Spec: Motivation & Architecture

> This spec exists because bobby-cli was built before it was specced. It
> reconstructs the "why" from the openClaw incident history already recorded
> in this repo, plus external research on how the wider MCP ecosystem handles
> the same problem, so the design isn't accidental — it's the documented
> answer to a documented failure.

## The problem: MCP doesn't have a clean per-turn identity story

openClaw originally talked to `session-memory` as a direct MCP client. Two
failures showed up in practice, both already logged elsewhere in this repo:

**1. Static config, no per-user token.** An MCP client's connection
(headers, auth) is configured once, not per tool call. openClaw needed a
different `sm_live_...` token per Discord user in a DM, but had nowhere to
put it — MCP config is set up front, not re-injected per turn. Per this
project's root `CLAUDE.md`: *"openClaw memory: ใช้ bash + curl แทน MCP เพราะ
openClaw redacts `sm_live_*` tokens ออกจาก MCP context"* — openClaw's own
runtime strips anything matching `sm_live_*` out of MCP tool-call context
before it reaches the client, as a safety measure against leaking secrets
into the LLM's context window. That safety measure makes MCP token injection
a dead end for this use case, by design, on openClaw's side.

**2. A sidecar proxy was tried and reverted for a race condition.** To work
around (1), a local sidecar (`sidecar.js`) was built to inject
`X-Actor-Discord-Id` per turn in front of the Worker. It kept `currentActor`
as a **process-level singleton**, so a second concurrent turn's
`DELETE /_actor` cleared the first turn's actor mid-flight — see
[session-memory/specs/09-spec-discord-actor.md § ประวัติ: Sidecar Experiment](../../session-memory/specs/09-spec-discord-actor.md#ประวัติ-sidecar-experiment-revert-แล้ว).
Reverted. The follow-up two-tier token model (per-DM-user session file,
per-guild machine file) fixed *that* race, but introduced a **different**
collision: any client — web UI "create new key", `bobby-cli auth login` —
minting a token for the same principal silently revokes the other's copy,
because `auth-center` currently allows only one active token per
`(principal_id, resource)`. See
[session-memory/specs/09-spec-discord-actor.md § REJECTED (2026-07-09)](../../session-memory/specs/09-spec-discord-actor.md)
and [auth-center/tickets/03-personal-api-token.md § Amended (2026-07-09)](../../auth-center/tickets/03-personal-api-token.md).
That fix is tracked as an `auth-center` token-model change (allow multiple
named active tokens per user, GitHub/GitLab-PAT style), not something
bobby-cli itself can solve — see [07](./07-spec-roadmap-open-questions.md).

## What the wider ecosystem does about this (research, 2026)

The same "how does a stateless/shared MCP server know which end-user is
calling" problem is active in the broader MCP community, not unique to this
project:

- **Pass the token at call time, not at connect time.** Proposals such as
  [modelcontextprotocol/modelcontextprotocol#234](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/234)
  and the MCP authorization spec's discussion of per-request credentials
  argue for tool-call-scoped auth instead of connection-scoped auth, exactly
  the gap that broke openClaw's static MCP config.
- **Token exchange (RFC 8693)** — an agent presents one token, the server
  exchanges it for one scoped to itself — is the standards-track version of
  what the rejected "per-turn scoped token" idea in spec 09 was reaching for.
- **Delegate to an external OAuth/OIDC provider and treat the MCP server as
  a relying party** (e.g. Red Hat's guidance via Keycloak) — this is
  structurally what `auth-center` already is for this stack.
- **Short-lived tokens with rotation** (15 min–1 hr) bound to a tenant/user
  claim, refreshed out-of-band — mirrors `auth-center`'s session-token +
  long-lived `sm_live_...` API-token split, though the API token is currently
  non-expiring by design (see `auth-center/specs/05-spec-token-api.md`).

None of these are about the MCP *server* being wrong — session-memory's
server-side MCP implementation is fine. The gap is client-side: something has
to hold and resolve the right credential per caller, without exposing it to
whatever is orchestrating the call (a Discord bot process, an LLM's context
window, a shell script).

## bobby-cli's answer: don't be an MCP client at all

bobby-cli sidesteps the static-config problem structurally, not by
implementing any of the proposals above:

```
agent / human / bot
   │  shells out: `bobby-cli memory remember "..."`
   ▼
bobby-cli (fresh process per invocation)
   │  1. reads ~/.bobby-cli/credentials.json from disk (this call, not connect-time config)
   │  2. resolves auth-center/session-memory URLs (env > stored > fixed default)
   │  3. makes the HTTP call itself: JSON-RPC `tools/call` to session-memory, or
   │     REST to auth-center for login
   │  4. prints only the result — never the raw token — to stdout
   ▼
caller only ever sees command output, never a credential
```

Consequences of this shape, each mapped to one of the two failures above:

| Failure that motivated it | How the CLI shape avoids it |
|---|---|
| MCP static config has no per-call token slot | There's no persistent MCP connection to configure. Every invocation is a new process that reads the credential file fresh — the "config" *is* per-call, because the whole process is per-call. |
| openClaw strips `sm_live_*` from MCP context to avoid leaking it to the LLM | The token never has to cross into MCP tool-call context or the LLM's context window at all — it stays inside the CLI process, read from a local file with `0600` permissions, and is never printed (see [06](./06-spec-output-conventions.md)). The calling agent only sees `bobby-cli`'s stdout. |
| Sidecar's process-level singleton actor caused cross-turn races | There is no shared server-side or sidecar-side mutable state between invocations. Two concurrent `bobby-cli` invocations are two independent processes, each with its own credential read and its own HTTP calls — no singleton to race on. |
| One active token per `(principal, resource)` — logging in from one place can revoke another's token | **Not solved by the CLI.** This is a real, currently-live risk described in [04](./04-spec-auth-model.md) and tracked as an `auth-center` schema change in [07](./07-spec-roadmap-open-questions.md). bobby-cli's only mitigation today is per-hostname token labeling (`bobby-cli@<hostname>`), which makes the *symptom* diagnosable, not the collision impossible. |

## Non-goals

- bobby-cli is **not** a general-purpose MCP client, gateway, or proxy. It
  does not expose an MCP server of its own, and it is not meant to replace
  openClaw's own Discord-specific two-tier token model — that problem
  (per-Discord-user identity inside a shared bot process) is different from
  bobby-cli's problem (one human/agent/script running one command at a
  time) and is out of scope here.
- bobby-cli does not attempt token exchange, OAuth relaying, or any
  multi-user request-multiplexing. Each invocation acts as exactly one
  principal — whoever is logged in on that machine.

## Decision (2026-07-09): agent integration stays CLI-first, no shared MCP server

As bobby-cli's usage grows to include being called *by* AI agents (not just
by humans typing commands), the obvious next question is whether to also
expose it as an MCP server so agents can call it as a typed tool instead of
shelling out. **Rejected**, for the same root-cause reason documented above:
the sidecar failure in
[session-memory/specs/09-spec-discord-actor.md](../../session-memory/specs/09-spec-discord-actor.md)
was never a flaw in MCP the protocol — it was a **shared connection serving
many identities** (the `currentActor` process-level singleton). A single
bobby-mcp server process fielding calls from multiple agents/users would
recreate exactly that bug. An MCP connection scoped one-per-identity would
avoid it, but anything capable of holding a private per-identity connection
is also capable of spawning a subprocess — which is a strictly lower bar and
already the model bobby-cli proves safe today.

**Decision: the CLI itself, invoked as a subprocess per call, is the
universal agent-integration primitive** — not a protocol-level server.
"Tool schema for agents" is solved as a static, machine-readable manifest
describing each command as a typed tool (name, input schema, output shape),
which any agent (Claude Code, a Claude Agent SDK executor, openClaw, a
future Hermes) can load and execute by spawning
`bobby-cli <command> --json ...`, exactly like a human or script would.
No shared server, no per-connection static config, nothing to race.

See [08-spec-shared-auth-core.md](./08-spec-shared-auth-core.md) (extracting
the reusable auth/session-memory client so future tools don't reimplement
it) and [09-spec-agent-tool-schema.md](./09-spec-agent-tool-schema.md) (the
manifest design) for the concrete plan.

## Design principles adopted (see [02](./02-spec-requirements.md) for the full list)

Borrowed from `gh` (GitHub CLI) and the community
[Command Line Interface Guidelines](https://clig.dev/): resource-noun +
verb subcommands, human-formatted output by default with a `--json` escape
hatch for scripts/agents, non-interactive-first credential resolution
(flags → env vars → prompt), and a hard rule that secrets never appear in
either output mode.
