---
name: project-bobby-cli-ticket-conventions
description: bobby-cli/tickets/ conventions this project has established — retirement-not-reuse for superseded IDs, self-contained tickets copying spec contracts inline, repo-boundary notes when a ticket touches a non-primary repo
metadata:
  type: project
---

`bobby-cli/tickets/README.md` is the running ticket index across multiple
specs (grown by spec: T01-T09 for specs 12+13, T17-T21 for spec 16 — see
[[feedback-openclaw-secrets]] for a related caution from writing the T17-T21
batch, 2026-07-24).

**Established conventions, confirmed by reading T01-T09 before writing
T17-T21:**
- Every ticket is self-contained: exact file paths, exact contracts (full
  markdown/bash blocks copied inline from the spec, not "see spec §X"),
  mechanically checkable acceptance criteria (grep commands, `wc -c`,
  specific expected output strings), explicit "Out of Scope" section.
- **Retirement, not reuse, for superseded ticket IDs.** Precedent: T08 (a
  `schema render` renderer) was retired 2026-07-18 when that architecture
  was dropped — README records it with a one-line note, ID never reused.
  Repeated for T10-T13 (spec 15's four-separate-skill plan, superseded by
  spec 16's one-consolidated-skill design) — full retirement table added
  to README with disposition per old ID (retired outright vs. retargeted
  to a new ID under the new design).
- **Repo-boundary notes are mandatory whenever a ticket's file changes
  live outside the primary repo** (`bobby-cli` itself). Precedent: T05
  (session-memory repo), T07 (chawengburi repo's `.claude/skills/`). A
  dedicated "Note on repo boundaries" subsection lists which ticket
  touches which repo, explicitly naming repos that are *not* touched to
  avoid ambiguity. T17-T21 touch `~/.openclaw/workspace/` (openClaw's
  skill workspace, its own separate git repo, confirmed clean on `main`)
  — none of them touch `bobby-cli` or `chawengburi` repos.
- **"Implementation workflow" section (top of README) is a numbered
  step-by-step ritual** (read only the ticket, read every file before
  editing, implement exactly the named changes, build, verify every AC by
  actually running something, diff-scope check, commit referencing the
  ticket ID, run `/code-review`, fix findings, commit follow-up
  separately, report back concisely) — apply this to every ticket
  regardless of which spec batch it belongs to; don't write a new one per
  batch.
- Complexity/priority/type fields and a dependency-graph ASCII diagram +
  summary table are expected for every batch, mirroring the T01-T09
  table's shape.

**How to apply:** when cutting tickets for a new spec in this repo, read
`tickets/README.md` and 2-3 existing ticket files first to match this
rigor before writing anything new — don't invent a lighter format.
