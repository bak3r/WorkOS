# Update — idempotent re-overlay after a version bump

Brings an existing install up to the current WorkOS version without touching the user's data. Safe to run repeatedly.

> **`--apply` is not optional on any of these.** All three tools default to a
> dry-run that prints a JSON plan and writes nothing. Documented without the flag
> (2026-07-08 → 2026-07-31), the entire update path was a silent no-op: a user
> following these steps saw success-shaped output and got no changes.

## Steps

1. **DetectEnv** — `bun Tools/DetectEnv.ts`. If `isDevTree` → STOP (the source repo updates itself via git, not this workflow).
2. **Release check** (reworked per public PR #1519, @erf1nd0r — the old "version diff" compared the payload's version against the marker that same payload wrote, so it always said "already current" and never fetched) — the skill carries no version field and there is no plugin manifest; versioning lives at the distribution layer, so BOTH sides of the diff must come from it:
   - **Installed version**: read `<configRoot>/WORKOS/VERSION` (the install marker, shipped since 7.1.1). Absent → the install predates the marker; treat it as behind and continue.
   - **Latest version**: read `tag_name` from `https://api.github.com/repos/<WORKOS_REPO>/releases/latest` — the same endpoint the bootstrap resolves against (`WORKOS_REPO` defaults in `install/install.sh`).
   - **Equal** → report "already current" and exit.
   - **Behind** → fetch the newer payload FIRST: run the shipped bootstrap, `bash <skillRoot>/install/install.sh`. It is additive — it replaces only the WorkOS skill dir and backs up the prior one. Then re-read the NEW skill's `Workflows/Update.md` and continue from its step 3 (steps may have changed between versions).
   - **Network unreachable** (the normal case in an sbx sandbox) → if the user has a newer local release directory, run `WORKOS_SRC=<release dir> bash <skillRoot>/install/install.sh` and continue as in "Behind". Otherwise say so and stop after re-running the additive legs that work from the on-disk skill (steps 4–6). Step 3's overlay needs a full fetched payload: on an installed system `<skillRoot>/install/` holds only the bootstrap files, so `OverlaySystem.ts` will refuse with a `bootstrap-only` blocker until the fetch in the "Behind" branch has run. That refusal is expected, not a failure.

   Never diff the on-disk payload's version against the install marker — the payload is what wrote the marker, so that comparison always says "already current" and the update never fetches anything.
3. **Re-overlay system** — refresh every system-owned file that changed (which `copyMissing` cannot do — it only writes files that are absent, so an update otherwise leaves most of the machinery stale while `VERSION` bumps). Run `bun Tools/OverlaySystem.ts --config-root <configRoot>` first to preview, then `--apply`. Scope: hooks, skills (not `skills/WorkOS`, which the bootstrap replaced), agents, commands, every `WORKOS/` entry the payload ships except `USER/`, `MEMORY/` and `VERSION`, plus CLAUDE.md and the system prompt; `settings.json` is never touched and symlinks are skipped. Each existing file is checked against the files every past release shipped (`Tools/data/workos-<version>.sha256`):
   - an untouched copy of a past release is replaced, with the identity names it carried filled into the new version;
   - a file the user edited is kept, and the new version is written beside it as `<file>.new` — show the user `edited` from the dry run and merge each by hand;
   - a file a past release shipped that this one does not (a retired skill or hook) moves to the backup if untouched (`retired`), and is kept and reported if edited (`retiredKept`);
   - anything WorkOS never shipped is not touched.
   `VERSION` is written last, only on a fully successful apply, so a partial update can't claim the new version. WorkOS's own CLAUDE.md is replaced and backed up (step 6 re-activates its imports); someone else's CLAUDE.md only gets its WorkOS block rebuilt. If `unfilled` lists placeholders, run `Tools/Substitute.ts --apply` with the names. Every change is in the install ledger, so `Tools/Rollback.ts` undoes the run. Run step 4 straight after: a retired hook's file is gone, but its settings registration stays until InstallHooks removes it.
4. **Re-merge hooks** — `bun Tools/InstallHooks.ts --apply` (idempotent): adds new hook entries, leaves existing ones, never duplicates (normalized-command dedup), and removes the registrations of hooks listed in `install/hooks/retired.json`. Backs up `settings.json` first.
4a. **Re-merge settings** — `bun Tools/InstallSettings.ts --config-root <configRoot>` first (dry run), then `--apply`. It adds new permission rules and absent keys, and removes the permission rules listed in `install/settings.retired.json`. Before `--apply`, show the user `securityRelevantSettingsToAdd` and `permissionRulesToRetire` from the dry run: the removal of a rule they may rely on (for example a no-prompt `git push`) needs their yes. Without this step a new release's deny rules never reach an existing install, and retired allow rules stay forever.
4b. **Refresh the spinner tips and verbs** — `bun Tools/DeployComponents.ts --config-root <configRoot> --components tooltips,spinnerverbs` (dry run), then add `--apply`. The settings merge in 4a only adds absent keys, so without this an updated install keeps tips that name retired skills. It replaces both keys whole (backed up first): if the user wrote their own tips into `settings.json`, ask before applying.
5. **Scaffold new USER templates only** — `bun Tools/ScaffoldUser.ts --apply` copyMissing: adds any NEW template files introduced by the version, never overwrites the user's existing files.
6. **Re-activate imports** — `bun Tools/ActivateImports.ts --apply` for any newly-shipped identity import lines.
7. **Verify** — two evidence classes (hooks fire + imports resolve), same as Setup step 9.

## Rule
Update never overwrites user data or a file the user edited, and never removes anything WorkOS did not ship. The only files it overwrites are untouched copies of past WorkOS releases; the only files it removes are untouched copies of files a release retired, and those go to the backup.
