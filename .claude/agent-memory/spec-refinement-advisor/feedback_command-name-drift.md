---
name: command-name-drift
description: Recurring blocking-class gap in openClaw/bobby-cli specs — command-name and CLI-subcommand drift in deployed AGENTS.md/SKILL.md text
metadata:
  type: feedback
---

When auditing openClaw-migration specs (14, 16, and likely their re-cut
tickets), the recurring highest-value class of bug is **command-name drift
in text that gets deployed verbatim** (AGENTS.md, SKILL.md completion
messages). Two distinct sub-traps:

1. **MCP tool name ≠ CLI subcommand name.** session-memory's MCP tool is
   `list_recent`, but bobby-cli exposes it as `memory show` (verified
   `src/commands/memory.ts` — `show` calls the `list_recent` tool
   internally). Specs repeatedly write `bobby-cli memory list_recent`,
   which errors "unknown command." bobby-cli memory subcommands are:
   `show`, `recall`, `remember`, `append`, `forget`. No `list_recent`.
2. **Slash-command sanitization.** openClaw's `sanitizeSkillCommandName`
   strips to `[a-z0-9_]`, so `bobby-cli` registers as `/bobby_cli` and
   `setup-chawengburi` as `/setup_chawengburi`. Stale bare `/login`,
   `/setup`, `/setup-memory` references (and mentions of the deleted
   `session-memory-call.py` "safe helper") linger in the live AGENTS.md and
   in completion messages.

**Why:** these files ship as-is to a running Discord bot; a wrong command
name is a live failure, not a doc nit. Spec 16 round-1 B1 was exactly this.

**How to apply:** on any spec that authors deployed AGENTS.md/SKILL.md
text, grep the *live* `~/.openclaw/workspace/` files yourself and re-derive
every CLI command against `bobby-cli/src/commands/` — do not trust the
spec's paraphrase. Verify `runShow` returns `ok:true` with a `loggedIn`
field (never `ok:false` for a valid profile) before accepting any branch on
`auth show` output — spec 14 round-2/G1 and the same check in spec 16
SETUP Steps 2/3 both hinge on this.
