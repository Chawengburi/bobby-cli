---
name: feedback-openclaw-secrets
description: Never dump ~/.openclaw/openclaw.json or ~/.openclaw/.env wholesale — they contain live plaintext secrets (Discord bot token, gateway auth token)
metadata:
  type: feedback
---

When researching openClaw's live sandbox config (`~/.openclaw/openclaw.json`,
`~/.openclaw/.env`) to write accurate specs/tickets, never `cat`/`grep`
these files without restricting output to key names. `openclaw.json` has
`channels.discord.token` (the live Discord bot token) and
`gateway.auth.token` in plaintext at the top level of the JSON — a broad
`cat` or `sed -n` range print puts them straight into the tool-call
transcript.

**Why:** during spec-16 ticket-writing research this happened by accident
(`sed -n '75,100p;340,390p' openclaw.json` printed the raw Discord bot
token into the conversation) while trying to locate the Discord-bot-
credential pre-flight-check mechanism carried forward from retired ticket
T10. No credential was written into a committed file, but it was exposed
in-session.

**How to apply:** when this kind of research is needed again (openClaw
config discovery, credential-related pre-flight checks, etc.), use
targeted greps that print only keys, not values — e.g.
`grep -n -i "discord" openclaw.json` to find line numbers, then
`sed -E 's/("token": *").*(")/\1<redacted>\2/'` or manually inspect only
the key path (e.g. `channels.discord.token` exists) rather than piping the
whole surrounding JSON block through. Same caution for `~/.openclaw/.env`
— `cat` it through `sed -E 's/=.*/=.../ '` to see which keys are set
without ever printing values. If a ticket or spec needs to reference "the
Discord bot token," reference it by config key path
(`openclaw.json` → `channels.discord.token`), never by value, and describe
verification via hash-comparison or an out-of-band owner check instead of
printing/pasting the literal token anywhere.
