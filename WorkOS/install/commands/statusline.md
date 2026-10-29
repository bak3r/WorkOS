---
name: statusline
description: Switch the statusline on or off. It is the one always-visible status display. Bare "statusline" reports which is on.
argument-hint: [on | off | status]
version: 1.0.1
---

# statusline — the always-visible status display, on or off

The principal typing `/statusline on` means: bring the statusline back. `/statusline off` means: take it away for now; nothing else replaces it, because the statusline is the one status display. Bare `/statusline` asks which is on. The tool is `WORKOS/TOOLS/StatusLine.ts`.

- `/statusline on` → `bun WORKOS/TOOLS/StatusLine.ts on`. Puts the kept block back into `USER/CONFIG/settings.user.json` (or the stock one) and regenerates `settings.json`.
- `/statusline off` → `bun WORKOS/TOOLS/StatusLine.ts off`. Backports any hand edit of `settings.json` first, moves the overlay's `statusLine` into `MEMORY/STATE/statusline-kept.json`, deletes it from the overlay, regenerates `settings.json`.
- `/statusline` or `/statusline status` → `bun WORKOS/TOOLS/StatusLine.ts status`.

`settings.json` is generated at every SessionStart (settings.system.json ⊕ the overlay), so the switch lives in the overlay; editing `settings.json` by hand is copied into the overlay by the next backport. Run it and say the change shows in new sessions; a running session keeps what it started with.
