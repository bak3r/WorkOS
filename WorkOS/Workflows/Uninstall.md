# Uninstall — clean, manifest-keyed removal

Removes what WorkOS installed, and ONLY what WorkOS installed. Leaves the user's data and any foreign hooks untouched.

## Steps

1. **DetectEnv** — `bun Tools/DetectEnv.ts`. If `isDevTree` → STOP. Uninstall never runs against the source repo.
2. **Confirm intent** — show exactly what will be removed (hook entries, system files, the WorkOS skill) and what will be KEPT (the user's config tree, their TELOS, their data). Wait for explicit confirmation.
3. **Manifest-keyed hook removal** — read `install/hooks/hooks.json`; remove ONLY settings.json entries whose command matches a shipped hook path. Leave every foreign entry in shared matcher buckets intact. Restore from the `settings.json` backup if one is present and the user prefers.
4. **Remove system files** — the WorkOS-owned system templates and copied hook files. Never the user config tree.
5. **Keep user data** — the config tree (identity, TELOS, memory) stays by default. Offer an explicit, separate, confirmed step to also remove it — opt-in only, never bundled.
6. **Report** — list what was removed and what was kept, with the backup path.

## What no tool does — manual, with the exact commands

There is no uninstall tool: every step above is carried out by hand (by you, with the user's yes). Four pieces are easy to miss because nothing records them in one place. Set `R="$CLAUDE_CONFIG_DIR"` (or the `configRoot` from `DetectEnv`) first.

1. **settings.json keys added by `InstallSettings`.** It only ever *adds* absent keys, so the before-state is its backup. If `InstallSettings` merged into an existing file, compare and restore by hand: `ls "$R"/settings.json.backup-*` then `diff <(jq -S . "$R"/settings.json.backup-<ts>) <(jq -S . "$R"/settings.json)` and remove only the keys that diff shows as added (restoring the backup wholesale also drops any later edits — ask). If there was no `settings.json` before install (no backup exists), every key in `install/settings.system.json` came from WorkOS; remove them, plus the enhancement keys `DeployComponents` sets, with:
   ```
   cp "$R/settings.json" "$R/settings.json.pre-uninstall" && jq 'del(.["$schema"], .agentPushNotifEnabled, .allowedHttpHookUrls, .autoMemoryEnabled, .autoMode, .awaySummaryEnabled, .cleanupPeriodDays, .dynamicContext, .editorMode, .enabledPlugins, .extraKnownMarketplaces, .fileCheckpointingEnabled, .httpHookAllowedEnvVars, .includeGitInstructions, .inputNeededNotifEnabled, .permissions, .principal, .remoteControlAtStartup, .skillListingBudgetFraction, .skipAutoPermissionPrompt, .skipDangerousModePermissionPrompt, .teammateMode, .theme, .tui, .worktree, .statusLine, .spinnerTipsOverride, .spinnerVerbs) | if .env then .env |= del(.API_TIMEOUT_MS, .BASH_DEFAULT_TIMEOUT_MS, .CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, .CLAUDE_CODE_FORK_SUBAGENT, .CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, .CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, .WORKOS_CONFIG_DIR, .WORKOS_DIR) else . end' "$R/settings.json.pre-uninstall" > "$R/settings.json"
   ```
   (Hook entries are step 3; `jq '.hooks'` should show only foreign entries afterwards.)
2. **The MEMORY tree** — `$R/WORKOS/MEMORY/` is per-install state (work ledger, learnings, observability), not shipped, so nothing removes it. It is user data: only on the separate opt-in of step 5, `rm -rf "$R/WORKOS/MEMORY"`. `$R/WORKOS/USER` is a symlink — `rm "$R/WORKOS/USER"` removes the link, never the data under `$WORKOS_CONFIG_DIR` (default `~/.config/WORKOS`), which is its own opt-in: `rm -rf "${WORKOS_CONFIG_DIR:-$HOME/.config/WORKOS}"`.
3. **The `workos` rc alias** (Setup step 8.5). Show it, then remove it: `grep -n "^alias workos=" ~/.zshrc ~/.bashrc 2>/dev/null` then `sed -i.workos-uninstall '/^alias workos=/d' ~/.bashrc` (same for `~/.zshrc`; the `-i.<suffix>` form works on GNU and BSD sed and keeps a backup). fish: `functions --erase workos; rm -f ~/.config/fish/functions/workos.fish`.
4. **sbx kit symlinks.** The `claude-home-link` kit belongs to the sandbox definition, not WorkOS — WorkOS never installed it, so it stays. After the config root is cleaned, list the links it left pointing at removed files with `find ~/.claude -maxdepth 1 -type l ! -exec test -e {} \; -print` and, with a yes, delete them by re-running with `-delete` appended. Never `rm -rf ~/.claude` in a sandbox: it is links into the workspace.

## Rule
Default-keep on anything the user authored. Uninstall is reversible up to the point of data deletion, which is always a separate explicit choice.
