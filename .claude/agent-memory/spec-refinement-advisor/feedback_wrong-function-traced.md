---
name: wrong-function-traced
description: Verifying a technical claim by citing a real, existing function isn't enough — confirm it's actually on the call path, not just plausibly named
metadata:
  type: feedback
---

Spec 16 § 3 claimed openClaw's workspace skill discovery scans exactly
one directory level deep, citing `loadSkillsFromDirSafe`/
`listCandidateSkillDirs` (`workspace-P8p68RCT.js`) as proof. That
function is real and does exactly what was described — but it is **not**
the function `workspaceSkillsDir` discovery actually calls. The real path
is a separate, recursive "grouped skill scan" inside `loadSkillEntries`'s
`loadSkills` closure, same file, going up to `MAX_GROUPED_SKILL_SCAN_DEPTH
= 6` levels deep. This claim passed all 3 audit rounds (each one
"re-derived every technical claim from source" per this project's own
standard) because every round re-confirmed the *same* function without
checking whether it was the one on the actual call path for the specific
case (`source: "openclaw-workspace"`) the spec relied on.

**Why this slipped through:** the file has multiple superficially similar
loader functions (`loadSkillsFromDirSafe`, `loadContainedSkillRecords`,
the `loadSkills` closure inside `loadSkillEntries`) serving different
callers/sources. Grepping for a plausible function name and reading it in
isolation confirms the function does what it looks like it does — it does
not confirm that function is reachable from the specific code path the
spec's claim depends on.

**How to apply:** when a spec claims "X scans/does Y" and cites a
function name as proof, trace **backward** from the actual runtime call
site for the specific case in question (e.g., what does
`buildWorkspaceSkillCommandSpecs`/`listSkillCommandsForWorkspace`
actually call, for `source: "openclaw-workspace"` specifically), not just
forward from a function that matches the claim's description. Where
possible, prefer a live/empirical check over a pure code trace for
consequential claims — this specific error was caught by running
`openclaw skills info login` against a real archived skill, not by
re-reading the source more carefully. If a spec's acceptance criteria
already include a live check for a claim like this (T19's original AC6
did), don't let ticket sequencing skip past it before the claim gets
relied on elsewhere (T17's live AC8 ran into this exact gap before T19
was even executed).
