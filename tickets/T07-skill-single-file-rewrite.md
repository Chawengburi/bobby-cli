# T07 — Rewrite `SKILL.md` as a ≤~2.5 KB single-file skill (policy + per-domain command tables)

**Type:** Task
**Priority:** High
**Complexity:** S (half day)

> **Revised 2026-07-18:** the earlier version of this ticket produced a
> hub-and-spoke layout (routing table pointing at generated `auth.md`/
> `memory.md`). That architecture was retired the same day (spec 13,
> § "Retired: the renderer") — there are **no spoke files and no renderer**.
> This ticket now produces the complete single-file skill.

## Summary

`.claude/skills/bobby-cli/SKILL.md` (in the `chawengburi` repo, currently
4977 bytes — measured with `wc -c`) is loaded every Claude Code session in
this project because recall-at-start is mandatory. Roughly 40–50% of its
body is prose that exists only to compensate for the CLI's old flat output
contract — `text`-parsing instructions, the duplicate-lag warning's
placement, a full auth-recovery paragraph. Now that T01–T06 have shipped
`code`/`hint` into the CLI's output, that prose collapses to policy + a
one-line "follow the `code`/`hint`" rule. This ticket rewrites the file as
the **complete single-file skill** spec 13 (2026-07-18 revision) defines:
shared mechanics + one short command-table section per domain (memory,
auth) + project policy, all in one hand-maintained file.

## Background & Context

- Spec: `bobby-cli/specs/12-spec-agent-legible-output.md` § 4 ("Skill
  diet") — the target content list.
- Spec: `bobby-cli/specs/13-spec-skill-architecture.md` (2026-07-18
  single-file revision) § 1 (layout), § 2 (same-change rule — this ticket
  must also record it in DEVELOPMENT.md), § 5 (description budget).
- Current file:
  `/Users/tanaphat/Work/000-chawengburi/.claude/skills/bobby-cli/SKILL.md`
  — **note this file lives in the `chawengburi` repo, not `bobby-cli`**,
  same cross-repo situation as T05. Re-read the live file before editing —
  it may have drifted since this ticket was written.
- Command source of truth for the tables: `bobby-cli/schema/tools.json`
  (post-T06). The tables are hand-written but must agree with the manifest
  — that agreement is the same-change rule's subject.

## What the file must contain (per spec 12 § 4 + spec 13 § 1)

- **Per-domain command-template tables** (memory: recall / remember /
  append / forget / show; auth: login / show / forget) — kept in this one
  file, one short section per domain.
- the stdin-heredoc quoting rule (inherent to Bash, can't move into the CLI)
- project policy: recall-at-start, store-don't-ask, append-over-duplicate,
  tag taxonomy, never-print-credentials
- one line: "on `ok: false`, follow `hint`; on writes, branch on `code`"

Everything else from the current file — the full "Output contract" section
explaining `text`-parsing, the duplicate-indexing-lag paragraph, the
multi-paragraph auth-recovery section — is deleted or reduced to the single
line above.

## Target content (draft — adjust wording, keep the structure and byte budget)

```markdown
---
name: bobby-cli
description: Perform auth and session-memory operations via bobby-cli through Bash — replaces the mcp__session-memory__* MCP tools for this project (MCP remains as fallback). Domains: memory (recall, remember, append, forget, show — list recent), auth (login, show, forget).
---

# bobby-cli skill

The single skill for all `bobby-cli` usage (one skill per CLI — new
domains become new sections here, never a new skill). Command tables must
stay in sync with `bobby-cli/schema/tools.json` — update both in the same
change.

## Shared rules

- Every call ends with `--json`. Never use `--profile` on this machine
  (default single identity).
- Values as separate argv elements; omit optional flags entirely when
  absent (never an empty string). `--tags` takes ONE comma-separated
  argument.
- Multi-line or quote-heavy content: omit the argument and pipe via stdin
  heredoc — `memory remember` reads stdin when its argument is omitted.
- On `ok: false`, follow the `hint` field exactly. On writes, branch on
  `code` (`stored` / `duplicate_candidate` / `duplicate_rejected` /
  `appended` / `forgotten` / `not_found`), not on parsing `text`.
- Never `cat`/`grep`/echo the credentials file or password env vars. If a
  raw `sm_live_*` token ever appears in output, stop and report it as a
  bug.

## Memory

| operation | command |
|---|---|
| recall (semantic search) | `bobby-cli memory recall '<query>' -n <topK> [--tags t1,t2] --json` |
| remember (store) | `bobby-cli memory remember '<content>' --tags <t1,t2> --json` |
| append (update) | `bobby-cli memory append '<id>' '<text>' --json` |
| forget (delete) | `bobby-cli memory forget '<id>' --json` |
| show (list recent) | `bobby-cli memory show -n <n> [--tags t1,t2] --json` |

## Auth

| operation | command |
|---|---|
| login state | `bobby-cli auth show --json` |
| log in (human only — never run for the user) | `bobby-cli auth login` |
| forget local credentials | `bobby-cli auth forget --json` |

## Project policy (from CLAUDE.md)

1. Start every conversation with `memory recall` on the main topic.
2. Store everything important automatically via `memory remember` — never
   ask permission.
3. Prefer `memory append` over a duplicate `remember` when something
   evolved.
4. Store condensed summaries of your own key responses too.
5. Tag: combine specific project tags with generic ones. `source` is
   hardcoded to `bobby-cli` by the CLI.
6. If the CLI path is unavailable, tell the user immediately, then fall
   back to `mcp__session-memory__*`.
```

The draft as printed measures ≈2.55 KB — right at the 2560-byte budget.
Re-measure with `wc -c` after ANY wording change. If over, tighten
shared-rules wording (but keep the one-line stdin rule — spec 12 § 4
requires it), never the command tables or project policy.

## Also in this ticket: record the same-change rule

Add to `bobby-cli/DEVELOPMENT.md`, next to the existing tools.json line
(line ~51): any command or flag change must update `schema/tools.json`
**and every deployed SKILL.md command table** in the same change (today:
the chawengburi repo's `.claude/skills/bobby-cli/SKILL.md`). This is spec
13 § 2's drift control and success criterion 3.

## Acceptance Criteria

1. Given the rewritten
   `/Users/tanaphat/Work/000-chawengburi/.claude/skills/bobby-cli/SKILL.md`,
   when measured with `wc -c`, then its size is ≤ ~2560 bytes (spec 12
   success criterion 3's "≤ ~2.5 KB").
2. Given the file's frontmatter, then `description` mentions both domains
   (`memory` and `auth`) by name — spec 13 § 5.
3. Given the skill directory, then it contains exactly one `.md` file
   (`SKILL.md`) — no `auth.md`/`memory.md` spokes (spec 13 success
   criterion 1).
4. Given the file body, then the memory table's 5 rows and the auth
   table's 3 rows agree with `schema/tools.json` (post-T06) —
   command paths and flags match the manifest's `command`/`input_schema`
   for all 8 tools. Rows may omit flags irrelevant to agent use (e.g.
   `auth login`'s `--email`/`--password` — human-only) and may show
   policy-mandated flags as required even where the manifest marks them
   optional (e.g. `remember`'s `--tags`).
5. Given the file body, then it contains the one-line rule "on `ok: false`,
   follow `hint`; on writes, branch on `code`" (or equivalent wording) and
   does NOT contain the old multi-paragraph "Also verified: duplicate
   detection has an indexing lag..." / "Always read `text` for..." prose
   from the current file.
6. Given `bobby-cli/DEVELOPMENT.md`, then its command-change checklist
   names both `schema/tools.json` and the deployed SKILL.md tables (spec
   13 success criterion 3).
7. Smoke check: a fresh Claude Code session in the `chawengburi` project
   performs a `memory recall` correctly using only this file (full
   trial-protocol re-run is T09).

## Dependencies

Depends on T06 (manifest) having landed, since the tables must agree with
the post-T06 manifest (AC4) and the shared-rules section references
`code`/`hint` semantics that only exist once T01–T04 are live. Must land
before T09 (trial re-run).

## Out of Scope

- Any change to `bobby-cli`'s source code — this ticket touches the
  `chawengburi` repo's SKILL.md and `bobby-cli/DEVELOPMENT.md` only.
- openClaw's copy of this skill and the consolidation of openClaw's
  login/forget skills into it — decided direction (spec 13 § 4) but
  belongs to the openClaw migration spec, not this ticket set (see
  README's "deliberately out of scope").
