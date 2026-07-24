# T19 — Archive `login/`, `setup/`, `setup-memory/` into `old_skills/`

**Type:** Chore
**Priority:** High
**Complexity:** S (half day)

**Repo:** `~/.openclaw/workspace/` — same repo as T17/T18, its own git
history, confirmed clean on `main` (`90debb4 feat: add /forget skill for
magic link password reset`) at the time this ticket was written. Not
`bobby-cli`, not `chawengburi`. See tickets README "Note on repo
boundaries."

## Summary

Moves the three superseded skill directories (`login/`, `setup/`,
`setup-memory/`) unmodified into a new `old_skills/` subfolder, using
`git mv` to preserve history rather than delete-and-recreate. This is
`bobby-cli/specs/16-spec-openclaw-consolidated-skill.md` § 3, copied
inline below. This is a new ticket with no equivalent in the retired
spec 15 plan (T10–T13) — that plan rewrote `login`/`setup` in place and
added `logout` alongside them, so it never needed an archival step; this
spec's consolidation makes the three old directories fully redundant once
T17/T18 land, which is what creates the need to archive them.

## Background & Context

- Source: spec 16 § 3, "Archival: `old_skills/`."
- **Decided** (spec 16, this conversation): archive rather than delete.
  `~/.openclaw/workspace/skills/` is its own git repo, confirmed clean on
  `main`, so `git mv` preserves file history rather than losing it to a
  delete-and-recreate.
- **Verified safe, not assumed** (spec 16 § 3, re-confirmed while writing
  this ticket by locating the loader source): openClaw's skill loader
  (`listCandidateSkillDirs`/`loadSkillsFromDirSafe`, in
  `/opt/homebrew/lib/node_modules/openclaw/dist/workspace-P8p68RCT.js` or
  `status-Dgv8n0cR.js` — re-grep
  `grep -rln "listCandidateSkillDirs" /opt/homebrew/lib/node_modules/openclaw/dist/`
  if the exact file has shifted) scans **exactly one directory level**
  under `skills/`: a root `fs.readdirSync` on `skills/`, then one
  `loadSingleSkillDirectory` check per immediate child, non-recursive.
  `old_skills/` itself will have no `SKILL.md`, and its children
  (`old_skills/login/`, etc.) are a second level down the loader never
  reaches. Once moved, these three directories are fully inert: not
  discovered, not registered as Discord commands, not listed in
  `<available_skills>` for model-invocation — while remaining on disk
  verbatim for reference/rollback.
- `forget/` is **not** moved — unchanged, still active, no part of this
  migration touches it (spec 16 § 3, spec 14 § 3.5 unchanged).

## Exact changes required

Run from `~/.openclaw/workspace/skills/`:
```bash
mkdir -p old_skills
git mv login old_skills/login
git mv setup old_skills/setup
git mv setup-memory old_skills/setup-memory
```
Resulting layout:
```
~/.openclaw/workspace/skills/old_skills/login/SKILL.md          (was skills/login/)
~/.openclaw/workspace/skills/old_skills/setup/SKILL.md           (was skills/setup/)
~/.openclaw/workspace/skills/old_skills/setup-memory/SKILL.md    (was skills/setup-memory/)
```
No file content changes — this is a pure move. `bobby-cli/SKILL.md`,
`setup-chawengburi/SKILL.md`, and `forget/` (all outside `old_skills/`)
are untouched by this ticket.

## Acceptance Criteria

1. Given `~/.openclaw/workspace/skills/`, then `login/`, `setup/`, and
   `setup-memory/` no longer exist at that top level.
2. Given `~/.openclaw/workspace/skills/old_skills/`, then it contains
   `login/SKILL.md`, `setup/SKILL.md`, and `setup-memory/SKILL.md`, each
   byte-identical to its pre-move content (`git diff --stat` for the three
   `git mv` commits shows 100% rename similarity, 0 insertions/deletions).
3. Given `~/.openclaw/workspace/skills/old_skills/`, then it contains **no**
   `SKILL.md` of its own at that level (only the three subdirectories) —
   this is what makes it structurally invisible to the one-level-deep
   loader, not just conventionally ignored.
4. Given `~/.openclaw/workspace/skills/forget/`, then it is unchanged and
   still present at the top level (not moved).
5. `git log --follow -- skills/old_skills/login/SKILL.md` (and the setup/
   setup-memory equivalents) shows the pre-move commit history, confirming
   `git mv` preserved history rather than a delete+recreate.
6. Restart (or re-load skills in) the openClaw agent and confirm `/login`,
   `/setup`, and `/setup-memory` (now `/setup_chawengburi`, but confirm the
   *old* sanitized names specifically) no longer appear as registered
   Discord slash commands, and none of the three appear in the
   `<available_skills>` listing used for model-invocation.

## Dependencies

Depends on T17 and T18 having landed first — archiving the old skills
before their replacements exist would leave a window with no working
login/setup/logout path at all. Must land before T21 (verification),
since T21's success-criterion-1 check (§ below) confirms this exact final
layout.

## Out of Scope

- Any content change to the three archived files — pure move, verified by
  AC2/AC5.
- `forget/` — unaffected, out of scope for this entire ticket set (spec 16
  inherits spec 14 § 3.5's decision unchanged).
- Deleting `~/.openclaw/user-sessions/*.json` / `server-sessions/*.json`
  legacy session files — that's T20, unrelated to this skill-directory
  move.
