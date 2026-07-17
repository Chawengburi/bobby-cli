# T06 — Update `schema/tools.json` for the extended envelope

**Type:** Task
**Priority:** Critical
**Complexity:** M (1 day)

> **Revised 2026-07-18:** the renderer (spec 13's `schema render`) was
> retired before implementation — the former checklist items 4
> (`x-skill-exclude` field) and 5 (`schema_render` entry) are **dropped**.
> The checklist is now 3 items.

## Summary

`bobby-cli/schema/tools.json` is the single source of truth other agents
read to know what bobby-cli's commands look like. It currently documents
the pre-spec-12 output shapes and a stale `0.1.0` version against a
`0.2.0` CLI. This ticket is the full manifest checklist for landing
spec 12. This is exactly **3 items** — do all 3 in one change, not partial.

## Background & Context

- Spec: `bobby-cli/specs/09-spec-agent-tool-schema.md` (manifest field
  definitions, "Manifest `version` tracks the CLI version" section — note
  its explicit statement that `x-skill-exclude` does NOT exist).
- Spec: `bobby-cli/specs/12-spec-agent-legible-output.md` § 5 ("Schema
  manifest").
- Session record finding **N1** (`docs/sessions/SESSION-2026-07-17.md`)
  originally listed 5 pending manifest edits; the 2026-07-18 architecture
  revision (spec 13, single-file skill, no renderer) removed two of them.
- Current manifest: `bobby-cli/schema/tools.json` (206 lines as of this
  writing — read it in full before editing, its `$comment` field at the top
  already documents invocation safety and must be preserved/extended, not
  removed).
- Current CLI version: `bobby-cli/package.json` → `"version": "0.2.0"`.

## The 3 checklist items (all required)

### 1. Bump manifest `version` to equal the CLI package version

`schema/tools.json`'s top-level `"version": "0.1.0"` → `"0.2.0"` (or
whatever `bobby-cli/package.json`'s `version` field is at the time this
ticket is implemented — read it fresh, don't hardcode `0.2.0` if it has
since bumped). Per spec 09: "`schema/tools.json`'s `version` always equals
the npm package version and is bumped in the same change" — going forward
this is a standing rule (add a one-line reminder to
`bobby-cli/DEVELOPMENT.md`'s existing "update the manifest" checklist note
if one exists, or create it if not, per spec 09's acceptance criteria).

### 2. Update `auth_show.output_schema` to the spec 12 § 2.1 normalized shape

Current (`schema/tools.json` lines ~52–78) uses a `oneOf` with
`loggedIn: { const: true }` / `loggedIn: { const: false }` and no `ok`/
`code`/`hint` fields. Replace with a `oneOf` matching what T04 implements:

```json
"output_schema": {
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "ok": { "const": true },
        "code": { "const": "status" },
        "loggedIn": { "const": true },
        "email": { "type": "string" },
        "tenantId": { "type": ["string", "null"] },
        "apiTokenLabel": { "type": "string" },
        "apiTokenId": { "type": "string" },
        "scopes": { "type": "array", "items": { "type": "string" } },
        "createdAt": { "type": "string" },
        "expiresAt": { "type": ["string", "null"] },
        "authCenterUrl": { "type": "string" },
        "sessionMemoryUrl": { "type": "string" }
      },
      "required": ["ok", "code", "loggedIn", "email"]
    },
    {
      "type": "object",
      "properties": {
        "ok": { "const": true },
        "code": { "const": "status" },
        "loggedIn": { "const": false },
        "hint": { "type": "string" }
      },
      "required": ["ok", "code", "loggedIn", "hint"]
    }
  ]
}
```

### 3. Add `code`/`hint`/structured fields to every tool's `output_schema`

Every one of the 8 tools (`auth_login`, `auth_show` — covered by item 2
above, `auth_forget`, `memory_show`, `memory_recall`, `memory_remember`,
`memory_append`, `memory_forget`) needs its `output_schema` updated to
reflect T01–T04's actual runtime shapes. For the `memory_*` tools, this
means the success branch of the `oneOf` gains `code` (one of the canonical
enum values relevant to that tool — subset per tool, e.g. `memory_remember`
can produce `stored`/`duplicate_candidate`/`duplicate_rejected`/
`unclassified`, while `memory_append` can produce
`appended`/`not_found`/`unclassified`) plus the structured fields
(`id`/`similarity`/`existingId`/`count` as applicable per T02's table), and
the failure branch gains `code` (one of `not_logged_in`/`permission_denied`/
`network`/`server`/`usage` — never `login_failed`, which is `auth_login`-only)
plus `hint`. `auth_login`'s failure branch specifically can also produce
`login_failed`. `auth_forget`'s `output_schema` gains `hint`-bearing failure
handling per T03's acceptance criterion 8, even though `auth_forget`
"doesn't fail" in the happy path per spec 03 — check T03's actual
implementation for whether `auth_forget` ever emits a failure envelope
before deciding whether to add a failure branch at all; document current
truth, don't invent one.

**Do not invent new codes** — every `code` value written into any
`output_schema` here must come from the canonical enum defined in
`bobby-cli/tickets/T02-memory-outcome-classifier.md`. If implementing this
ticket reveals a tool needs a code not in that enum, stop and flag it — the
enum is the spec, not a suggestion.

## Acceptance Criteria

1. Given `schema/tools.json`, when its top-level `version` field is read,
   then it equals `bobby-cli/package.json`'s `version` field exactly, at
   the time this ticket lands.
2. Given `schema/tools.json`'s `auth_show` entry's `output_schema`, then it
   matches the shape in checklist item 2 above (both `oneOf` branches
   present, `ok`/`code`/`loggedIn` in both).
3. Given every one of the 8 pre-existing tool entries, then each
   `output_schema` includes `code` in every branch of its `oneOf` (or
   equivalent single-shape schema) and every failure branch includes
   `hint`.
4. Given `schema/tools.json`, then NO `x-skill-exclude` field and NO
   `schema_render` entry exist anywhere in the file (retired 2026-07-18 —
   spec 13 § "Retired"; if either is present from an earlier partial edit,
   remove it).
5. Given `schema/tools.json`, when parsed as JSON (`JSON.parse` / `jq .`
   over the file), then it parses without error (basic JSON-validity sanity
   check after hand-editing).
6. Given the full list of `code` values appearing anywhere in the updated
   `schema/tools.json`, then every one is a member of the canonical enum in
   `bobby-cli/tickets/T02-memory-outcome-classifier.md` — grep for
   `"code"` occurrences and cross-check by hand.
7. Given `bobby-cli/DEVELOPMENT.md`, then it contains (or already contains
   and this ticket confirms it still does) a note that command/flag changes
   must update `schema/tools.json` in the same change, per spec 09's
   acceptance criteria — this may already exist from spec 09's original
   implementation; verify rather than assume, and add it if missing.

## Dependencies

Depends on T01, T02, T03, T04 landing first — this ticket documents their
actual shipped output shapes, so it cannot be written accurately before
they exist. Must land before T07 (skill rewrite), whose command tables must
agree with this manifest.

## Out of Scope

- Any change to `src/**` — this ticket is `schema/tools.json` (and possibly
  `DEVELOPMENT.md`) only.
- Building a manifest generator or validator — spec 09 explicitly keeps the
  manifest hand-maintained for v1; not revisited here.
