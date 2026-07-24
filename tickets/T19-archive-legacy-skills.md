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

- Source: spec 16 § 3, "Archival: `old_skills/`" — **corrected 2026-07-24
  (amendment 3) after this exact mechanism was tested live and found not
  to work.** The section below reflects the corrected version; do not
  trust any earlier description of this ticket you may have cached or
  seen referenced elsewhere.
- **Decided** (spec 16, this conversation): archive rather than delete.
  `~/.openclaw/workspace/skills/` is its own git repo, confirmed clean on
  `main`, so `git mv` preserves file history rather than losing it to a
  delete-and-recreate.
- **What was originally claimed, and why it was wrong:** the original
  version of this ticket (and spec 16 § 3) said moving a skill directory
  two levels deep (`skills/old_skills/login/`) was enough on its own,
  citing `loadSkillsFromDirSafe`/`listCandidateSkillDirs` as scanning only
  one directory level. That function is real, but it is **not** the one
  workspace skill discovery uses. Found live during T17's implementation:
  after archiving `login`/`setup` into `old_skills/` exactly as originally
  specified, `openclaw skills info login` still reported `Source:
  openclaw-workspace`, `Available as command: yes` — the old skill was
  still fully live. The actual discovery path is a separate, recursive
  "grouped skill scan" (`loadSkillEntries`'s `loadSkills` closure,
  `workspace-P8p68RCT.js`) that treats any directory lacking its own
  `SKILL.md` as a grouping folder and recurses into its children up to
  `MAX_GROUPED_SKILL_SCAN_DEPTH = 6` levels deep — `old_skills/login/` at
  depth 2 was easily within range.
- **Corrected mechanism, verified live:** the loader's discovery requires
  a file literally named `SKILL.md`
  (`fs.existsSync(path.join(candidateDir, "SKILL.md"))`), independent of
  directory depth. Renaming the file to `SKILL.md.bak` on archival makes
  it genuinely inert at any nesting level — confirmed live: after
  renaming, `openclaw skills list` no longer shows `login`/`setup` at all
  (previously it showed both as `✓ ready` even post-archival-move). This
  also matches this project's own existing convention for disabled files
  (`~/.openclaw/workspace/AGENTS.md.bak.*`). The `old_skills/` directory
  move is kept for human organization/rollback convenience, not because
  it provides deactivation on its own — that guarantee now comes entirely
  from the `.bak` rename.
- `forget/` is **not** moved — unchanged, still active, no part of this
  migration touches it (spec 16 § 3, spec 14 § 3.5 unchanged).

## Exact changes required

Run from `~/.openclaw/workspace/skills/`:
```bash
mkdir -p old_skills
git mv login old_skills/login
git mv setup old_skills/setup
git mv setup-memory old_skills/setup-memory
git mv old_skills/login/SKILL.md old_skills/login/SKILL.md.bak
git mv old_skills/setup/SKILL.md old_skills/setup/SKILL.md.bak
git mv old_skills/setup-memory/SKILL.md old_skills/setup-memory/SKILL.md.bak
```
Resulting layout:
```
~/.openclaw/workspace/skills/old_skills/login/SKILL.md.bak          (was skills/login/SKILL.md)
~/.openclaw/workspace/skills/old_skills/setup/SKILL.md.bak           (was skills/setup/SKILL.md)
~/.openclaw/workspace/skills/old_skills/setup-memory/SKILL.md.bak    (was skills/setup-memory/SKILL.md)
```
No content changes to the files themselves — only path and filename
change (rename, not edit). `bobby-cli/SKILL.md`, `setup-chawengburi/
SKILL.md`, and `forget/` (all outside `old_skills/`) are untouched by
this ticket.

**Note for whoever executes this ticket:** `login/`, `setup/` were
already archived (including the `.bak` rename) live during T17's own
debugging, ahead of this ticket formally running — commits `9b07f7a`
(move) and `ed094f5` (rename) in the `openclaw-skills` repo. If those are
already applied, this ticket only needs to do the `setup-memory/` half
(gated on T18 existing) and verify AC1–7 against the combined state.

## Acceptance Criteria

1. Given `~/.openclaw/workspace/skills/`, then `login/`, `setup/`, and
   `setup-memory/` no longer exist at that top level.
2. Given `~/.openclaw/workspace/skills/old_skills/`, then it contains
   `login/SKILL.md.bak`, `setup/SKILL.md.bak`, and
   `setup-memory/SKILL.md.bak`, each byte-identical in content to the
   pre-move `SKILL.md` (only the path and filename changed — `git show
   <commit>:old_skills/login/SKILL.md.bak` diffed against the pre-move
   blob shows zero content difference).
3. Given `~/.openclaw/workspace/skills/old_skills/`, then none of its three
   subdirectories contain a file literally named `SKILL.md` (only
   `SKILL.md.bak`) — this, not the directory nesting, is what makes them
   inert; do not accept a layout that skipped the rename.
4. Given `~/.openclaw/workspace/skills/forget/`, then it is unchanged and
   still present at the top level (not moved).
5. `git log --follow -- skills/old_skills/login/SKILL.md.bak` (and the
   setup/setup-memory equivalents) shows the pre-move/pre-rename commit
   history, confirming `git mv` preserved history rather than a
   delete+recreate.
6. **Live, not assumed:** run `openclaw gateway restart` (use the binary
   that matches the running gateway's version — check
   `ps -o command -p <gateway pid>` against `openclaw --version` and
   `which -a openclaw` first if there's more than one install on `PATH`;
   a stale/older binary on `PATH` can silently target the wrong install or
   get blocked by the gateway's own version-mismatch guard). Then run
   `openclaw skills list` and confirm `login`, `setup`, and `setup-memory`
   no longer appear at all (not just "not ready" — genuinely absent from
   the list), and `openclaw skills info login` (etc.) reports the skill as
   not found.

## Dependencies

Depends on T17 and T18 having landed first — archiving the old skills
before their replacements exist would leave a window with no working
login/setup/logout path at all. Must land before T21 (verification),
since T21's success-criterion-1 check (§ below) confirms this exact final
layout.

## Out of Scope

- Any content change to the three archived files — pure move + rename,
  verified by AC2/AC5.
- `forget/` — unaffected, out of scope for this entire ticket set (spec 16
  inherits spec 14 § 3.5's decision unchanged).
- Deleting `~/.openclaw/user-sessions/*.json` / `server-sessions/*.json`
  legacy session files — that's T20, unrelated to this skill-directory
  move.
