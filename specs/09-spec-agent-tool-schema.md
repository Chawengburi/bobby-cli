# 09 Spec: Agent Tool Schema

> Decision context: [01-spec-motivation-architecture.md § Decision (2026-07-09)](./01-spec-motivation-architecture.md#decision-2026-07-09-agent-integration-stays-cli-first-no-shared-mcp-server)
> Depends on: [08-spec-shared-auth-core.md](./08-spec-shared-auth-core.md) (not required for this spec's manifest itself, but the two land together as part of the same agent-integration push)

## Goal

Let any AI agent — Claude Code, a Claude Agent SDK–based agent, openClaw, a
future Hermes — discover and call bobby-cli's commands as typed tools,
without bobby-cli running a shared server. Execution stays exactly what it
is today: a fresh `bobby-cli` subprocess per call. Only the *description* of
what's callable becomes structured instead of living solely in `--help`
text and this spec folder.

## Explicitly not this: no MCP server, no daemon

Restating the decision from spec 01 so it isn't silently re-proposed later:
a shared long-lived process (MCP or otherwise) fielding calls from multiple
agents/identities is rejected — it recreates the exact
process-level-singleton race that broke openClaw's sidecar in
[session-memory/specs/09-spec-discord-actor.md](../../session-memory/specs/09-spec-discord-actor.md).
This spec's manifest is *only* a description consumed by agents to construct
subprocess invocations — it is never itself a running service.

## The manifest

A single JSON file, checked into the repo (not generated at publish time,
so it's readable without building): `bobby-cli/schema/tools.json`.

One entry per subcommand, following the naming/shape conventions common to
tool-use/function-calling schemas (Anthropic `tools`, OpenAI functions, MCP
`tools/list` all converge on: a flat `name`, a `description`, and a
JSON-Schema `input_schema` for parameters):

```json
{
  "tools": [
    {
      "name": "memory_recall",
      "description": "Semantically search saved memories, optionally filtered by tag.",
      "command": ["memory", "recall"],
      "input_schema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search text" },
          "limit": { "type": "integer", "default": 5, "description": "Max results" },
          "tags": { "type": "string", "description": "Comma-separated tags to filter by — matches any (OR)" }
        },
        "required": ["query"]
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "ok": { "type": "boolean" },
          "text": { "type": "string" },
          "error": { "type": "string" }
        },
        "required": ["ok"]
      },
      "invocation": "bobby-cli memory recall {query} -n {limit} --tags {tags} --json"
    }
  ]
}
```

### Naming convention

`<noun>_<verb>` snake_case (`auth_login`, `auth_show`, `auth_forget`,
`memory_show`, `memory_recall`, `memory_remember`, `memory_append`,
`memory_forget`) — matches `command` (the noun-verb subcommand path in
[03-spec-commands.md](./03-spec-commands.md)), and avoids spaces/slashes
that most function-calling schemas reject in tool names.

### Field meaning

| Field | Purpose |
|---|---|
| `name` | Tool identifier an agent's function-calling layer registers |
| `description` | What the agent sees when deciding whether to call this tool |
| `command` | The bobby-cli subcommand path, for building the invocation |
| `input_schema` | JSON Schema for arguments — matches each command's actual flags/positional args in [03](./03-spec-commands.md) |
| `output_schema` | Matches the `--json` shapes documented in [06-spec-output-conventions.md](./06-spec-output-conventions.md), i.e. the spec 12 extended envelope (`code`, `hint`, structured fields; `auth_show` normalized per spec 12 § 2.1) once that ships — updating these in the same change as the envelope is a spec 12 acceptance criterion |
| `invocation` | A template string an executor fills in and spawns as a subprocess — always includes `--json` |

(A per-tool `x-skill-exclude` field was briefly specced 2026-07-17 for a
skill-file renderer; that renderer was retired 2026-07-18 before
implementation — see [13-spec-skill-architecture.md](./13-spec-skill-architecture.md)
§ "Retired" — so the field does not exist.)

### Manifest `version` tracks the CLI version

Decided 2026-07-17 (closing the 0.1.0-manifest vs 0.2.x-CLI drift):
`schema/tools.json`'s top-level `version` always equals the npm package
version and is bumped in the same change — it versions the
manifest-as-shipped, not an independent schema lineage. This lets any
consumer (skill author, tool executor, a human debugging) check whether
the manifest they're reading describes the binary that's installed.

## Generation strategy: hand-maintained for v1

The command surface is 8 commands today. Hand-maintaining
`schema/tools.json` alongside `src/commands/*.ts` is simpler than building a
generator, and avoids a generator's own maintenance burden for a surface
this small. **Revisit only if** the command count grows enough that drift
between the manifest and actual commander definitions becomes a real risk —
not solved preemptively here.

Until automated, add a checklist reminder to `DEVELOPMENT.md`: any new
command or flag change must update `schema/tools.json` in the same change.

## Consumption patterns

| Consumer | How it uses the manifest |
|---|---|
| Claude Code Skill | A `SKILL.md` either embeds/references `schema/tools.json` or documents the same commands in prose for discovery — the manifest is the source of truth either way, so the Skill's prose doesn't drift from actual behavior |
| Claude Agent SDK / custom agent | Loads `schema/tools.json` entries directly into a `tools` parameter for native tool-use; its tool executor fills in the `invocation` template, spawns `bobby-cli ... --json` as a subprocess, and returns parsed stdout as the tool result |
| openClaw / future Hermes | Whatever tool-calling layer each has reads the same manifest and executes the same way — one manifest, no agent-specific reimplementation |

In every case, execution is identical to a human running the command by
hand: a new process, credentials resolved fresh from
`~/.bobby-cli/credentials.json` (or its extracted-core equivalent per
[08](./08-spec-shared-auth-core.md)), no shared state across calls.

## Invocation safety

Flagged during review (2026-07-09) and fixed in `schema/tools.json`'s
top-level `$comment`, recorded here as the canonical statement:

`invocation` template strings (e.g.
`"bobby-cli memory recall {query} -n {limit} --tags {tags} --json"`) are
illustrative only, not something to run through a shell:

- **An executor must build an argv array and spawn directly** (e.g. Node's
  `execFile`/`spawn` with an `args` array, `shell: false`/default), placing
  each substituted value as its own argv element. Never string-concatenate
  the template and hand it to a shell — a value containing spaces, quotes,
  or shell metacharacters would break argument boundaries, and for
  `{password}` specifically this is a real injection vector, not just a
  correctness bug.
- **Omit optional fields entirely when absent — never substitute an empty
  string.** `memory_show`/`memory_recall`'s `{tags}` and `memory_remember`'s
  `{text}` are optional. Naive substitution of `--tags {tags} --json` with
  no tags produces `--tags --json`, which makes `--tags` swallow the
  literal string `"--json"` as its value and silently drops the real
  `--json` flag — a correctness bug that would make every affected call
  return human-formatted text instead of JSON, not an error an executor
  would notice immediately.

This applies to every tool in the manifest, not just the two called out
above — any optional `input_schema` property must have its corresponding
flag+value pair dropped from argv when not provided.

## Open questions

- Where does `schema/tools.json` ship relative to the npm package — inside
  `dist/` (so a `require`/`import` of the installed package can read it) or
  only in the repo for agents that clone/reference it directly? Depends on
  whether any consumer needs to load it from an installed `node_modules`
  copy vs. just reading it from this repo. Not decided here.
- Should `output_schema` be fixed to match [07](./07-spec-roadmap-open-questions.md)'s
  open item about `auth_login`/`auth_show` shape inconsistency, or should
  the manifest document the *current* (inconsistent) shapes and note the
  fix separately? Leaning toward documenting current behavior accurately
  and letting the shape fix (open question 5 in spec 07) update both the
  code and the manifest together — but flagging rather than assuming.

## Acceptance criteria

- [x] `bobby-cli/schema/tools.json` exists with one entry per current
      subcommand (8 total), matching [03-spec-commands.md](./03-spec-commands.md)
      exactly
- [x] Every `input_schema` matches the command's actual commander flags/
      positional args (spot-checked against `src/commands/auth.ts` and
      `src/commands/memory.ts`) — verified by independent sub-agent review
      (2026-07-09); one mismatch found and fixed (`memory_remember`'s `text`
      was wrongly marked required, missing the documented stdin fallback)
- [x] Every `output_schema` matches the actual `--json` output shape
      documented in [06-spec-output-conventions.md](./06-spec-output-conventions.md)
- [x] `DEVELOPMENT.md` has a note that command/flag changes must update this
      manifest in the same change
- [x] No code in this repo runs the manifest as a server — it is read-only
      data, never imported by anything that opens a network listener
- [x] Invocation-template substitution safety (shell-injection risk,
      empty-optional-field risk) is documented — added in
      § Invocation safety above after sub-agent review flagged it as missing
