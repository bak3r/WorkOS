# Uninstall — clean, manifest-keyed removal

Removes what WorkOS installed, and ONLY what WorkOS installed. Leaves the user's data and any foreign hooks untouched.

## Steps

1. **DetectEnv** — `bun Tools/DetectEnv.ts`. If `isDevTree` → STOP. Uninstall never runs against the source repo.
2. **Confirm intent** — `bun Tools/Rollback.ts --list`, then `bun Tools/Rollback.ts [--run <timestamp>]` (dry run) shows every step: what will be removed (files and dirs WorkOS added, its hook entries and settings keys via the restored `settings.json`, the WorkOS block via the restored `CLAUDE.md`, the WorkOS skill) and what comes back (anything WorkOS replaced or moved aside — LifeOS files, `LIFEOS/`). Show it and wait for explicit confirmation.
3. **Roll back** — from a shell outside the config root: `bun <configRoot>/skills/WorkOS/Tools/Rollback.ts [--run <timestamp>] --apply`. It replays `WORKOS/install-manifest.jsonl` in reverse from `.workos-backup/<run>/`, so the config root ends byte-identical to before that install run. Claude Code's own paths are never in the manifest and are never touched.
   - **User data:** the USER data home the install created (`$WORKOS_CONFIG_DIR`, default `~/.config/WORKOS`) is kept by default. Add `--remove-user-data` only when the user confirms they want their identity, TELOS and interview answers deleted too.
   - Work memory written since the install lives under `WORKOS/`, which the rollback removes. If the user wants it, copy `WORKOS/MEMORY/` somewhere first.
   - **Several runs** (an install, then an update): roll back newest first, one `--run` at a time.
4. **Report** — list what was removed and what was restored (the tool's JSON), and that the backup dir was cleaned up (or kept with `--keep-backup`).

## What the manifest does not cover — manual, with the exact commands

Set `R="$CLAUDE_CONFIG_DIR"` (or the `configRoot` from `DetectEnv`) first.

1. **Installs from before the install manifest existed.** If `Rollback.ts --list` shows no run, the install predates the ledger: remove hook entries whose command matches a shipped hook path in `install/hooks/hooks.json` (leave every foreign entry), the WorkOS-owned files, and restore `settings.json` from its `settings.json.backup-*` / `*.workos-backup-*` sibling if the user prefers.
2. **The MEMORY tree** on a pre-manifest install — `$R/WORKOS/MEMORY/` is per-install state (work ledger, learnings, observability), not shipped. It is user data: only on a separate opt-in, `rm -rf "$R/WORKOS/MEMORY"`. `$R/WORKOS/USER` is a symlink — `rm "$R/WORKOS/USER"` removes the link, never the data under `$WORKOS_CONFIG_DIR` (default `~/.config/WORKOS`), which is its own opt-in: `rm -rf "${WORKOS_CONFIG_DIR:-$HOME/.config/WORKOS}"`.
3. **The `workos` rc alias** (Setup step 8.5) — a shell rc file is outside the config root, so the manifest does not record it. Show it, then remove it: `grep -n "^alias workos=" ~/.zshrc ~/.bashrc 2>/dev/null` then `sed -i.workos-uninstall '/^alias workos=/d' ~/.bashrc` (same for `~/.zshrc`; the `-i.<suffix>` form works on GNU and BSD sed and keeps a backup). fish: `functions --erase workos; rm -f ~/.config/fish/functions/workos.fish`.
4. **sbx kit symlinks.** The `claude-home-link` kit belongs to the sandbox definition, not WorkOS — WorkOS never installed it, so it stays. After the config root is cleaned, list the links it left pointing at removed files with `find ~/.claude -maxdepth 1 -type l ! -exec test -e {} \; -print` and, with a yes, delete them by re-running with `-delete` appended. Never `rm -rf ~/.claude` in a sandbox: it is links into the workspace.

## Rule
Default-keep on anything the user authored. Uninstall is reversible up to the point of data deletion, which is always a separate explicit choice.
