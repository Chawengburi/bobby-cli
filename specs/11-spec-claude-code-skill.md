# 11 Spec: Claude Code Skill Integration

> Decision context: `docs/sessions/PLAN-2026-07-13-decisions.md` (chawengburi
> repo) — trial bobby-cli with Claude Code **before** migrating openClaw, so
> the shell-out pattern gets exercised where failures are cheap, visible, and
> affect no Discord user.
>
> Builds on: [09-spec-agent-tool-schema.md](./09-spec-agent-tool-schema.md)
> (`schema/tools.json` is the contract this skill consumes — this spec is its
> first real consumer), [03-spec-commands.md](./03-spec-commands.md) (`--json`
> output contract, dual `tag`/`tags` filter), [06-spec-output-conventions.md](./06-spec-output-conventions.md)
> (token-redaction guarantee that makes shelling out safe at all),
> [10-spec-credential-profiles.md](./10-spec-credential-profiles.md) (NOT used
> here — see § Identity).

## Problem

Claude Code currently reaches session-memory through MCP tools
(`mcp__session-memory__recall` etc.) configured per machine. openClaw reaches
the same Worker through a hand-written `curl`+Python helper. The migration
target for openClaw is "shell out to bobby-cli per call" — but that pattern
has never been driven by a real agent end to end. If it has sharp edges
(JSON parsing, error surfaces, latency, token leakage), we want to find them
in a Claude Code session where a human is watching, not in the Discord bot.

Measured baseline (2026-07-13, this machine → test deployment):
`bobby-cli memory show -n 1 --json` completes in **0.6–0.85 s** end-to-end,
of which Node process startup is only ~56 ms — the rest is two sequential
HTTP round trips (MCP `initialize`, then `tools/call`). Acceptable for an
interactive coding agent; also the same order of cost openClaw's current
Python helper already pays.

## Goal

A Claude Code **skill** (`SKILL.md`) that makes Claude Code perform all five
memory operations by running `bobby-cli` through its Bash tool instead of MCP
tools, with parity to the mandatory memory rules in the project `CLAUDE.md`.
The skill's structure should transfer to openClaw skills (openClaw uses the
same SKILL.md convention), so lessons learned here are directly reusable.

## Non-goals

- Changing openClaw (that is the next spec, informed by this trial).
- Removing the MCP server config permanently — the trial must be revertible
  by deleting the skill and restoring the `CLAUDE.md` rules section.
- `--profile` usage. Claude Code on a dev machine is exactly the
  single-identity-per-machine caller spec 10 says should never need to know
  profiles exist.
- Wrapping `auth login` in the skill beyond a "not logged in" recovery hint —
  interactive login stays a human action on this machine.

## Design

### Skill placement and shape

- Location: `000-chawengburi/.claude/skills/session-memory/SKILL.md`
  (project-level, so it ships with the repo and only affects this project).
- The skill is instructions + command templates only — no wrapper script.
  Claude Code builds argv from the templates the same way spec 09 requires
  executors to: values as separate argv elements, optional flags omitted
  entirely when absent (never substituted as empty strings).

### Command mapping (from `schema/tools.json`)

| MCP tool (today) | Skill command |
|---|---|
| `recall` | `bobby-cli memory recall <query> -n <topK> [--tags t1,t2] --json` |
| `remember` | `bobby-cli memory remember <content> --tags <t1,t2,...> --json` |
| `append` | `bobby-cli memory append <id> <text> --json` |
| `forget` | `bobby-cli memory forget <id> --json` |
| `list_recent` | `bobby-cli memory show -n <n> [--tags t1,t2] --json` |

Rules carried over from `CLAUDE.md` unchanged: recall at conversation start,
store-don't-ask, append-over-duplicate, multi-tag tagging (now actually
honored end-to-end after the 0.2.0 `--tags` fix), `source` is hardcoded to
`bobby-cli` by the CLI — the skill notes this replaces the old
`source: "claude-code"` convention and that's acceptable for the trial.

### Output contract

Every call uses `--json` and parses exactly the spec 06 envelope:
`{ ok: true, text }` | `{ ok: false, error }`, exit code 0/1. The skill
instructs: treat non-zero exit or `ok: false` as the operation failing, show
`error` verbatim, and **never retry writes blindly** (duplicate detection on
the server makes a blind `remember` retry a duplicate-warning generator).

`text` is the server's human-formatted string (entries with `ID: ...` lines),
not structured JSON — same as what the MCP tools return today, so no
information is lost relative to the status quo.

### Identity and auth

- Uses the default `~/.bobby-cli/credentials.json` (already logged in on this
  machine against the test deployment — stored URLs win over the baked-in
  production default, per spec 05 resolution order).
- On `Not logged in` errors the skill says to stop and tell the user to run
  `bobby-cli auth login` themselves — never attempt to collect credentials.

### Token safety

The reason shelling out is safe where MCP config was not (openClaw redacts
`sm_live_*` from MCP context): bobby-cli never writes the raw token to
stdout/stderr in any mode (spec 06). The skill adds one guard on top: never
`cat` the credentials file and never echo `$BOBBY_CLI_PASSWORD`-style values.

### Relationship to the CLAUDE.md mandatory rules

During the trial the project `CLAUDE.md` memory section gets a one-line
pointer: "memory operations go through the `session-memory` skill
(bobby-cli), not the MCP tools." The MCP server stays configured as fallback;
rule 6's "tell me immediately if tools are unavailable" applies to the CLI
path the same way. Rollback = delete the skill + restore the section.

## Trial protocol and success criteria

Run normal work sessions in this repo with the skill active. Log every
friction point in the session log. The trial passes when all of:

1. **Parity** — all five operations succeed through the CLI in real sessions
   (recall-at-start, remember with ≥3 tags, append on update, forget on
   cleanup, show for review).
2. **Latency** — per-call wall time stays under ~1.5 s p95 as measured from
   session transcripts; no session is visibly degraded by memory calls.
3. **No leakage** — zero occurrences of `sm_live_` in any transcript/output
   (spot-check with grep over the session logs).
4. **Error legibility** — at least one induced failure (e.g. bogus entry ID)
   produces an error message Claude Code acts on correctly without human
   decoding.
5. **Schema fidelity** — no case where the skill needed a command/flag that
   `schema/tools.json` didn't describe (if found: fix the manifest, that's
   the point of the trial).

Exit: fold findings into the openClaw migration spec (next number in the
chawengburi docs, not this repo) — including whatever the trial says about
`initialize`+`tools/call` double round-trip being worth collapsing.

## Open questions

1. Should `memory remember` grow a `--source <s>` flag so Claude Code can
   keep tagging entries `claude-code` instead of `bobby-cli`? Cheap, but it
   widens the CLI surface for cosmetics — deferred unless the trial shows
   source-based filtering actually matters.
2. Whether the skill should auto-load at session start (skill description
   triggers on memory-related work) or be referenced from `CLAUDE.md` — start
   with the `CLAUDE.md` pointer; revisit if recall-at-start gets skipped in
   practice.
