# Getting Started — after the install

You installed WorkOS. This page covers the part `INSTALL.md` couldn't: the **external tools** WorkOS's doctrine uses when they're available. Almost all of them are optional and degrade honestly when absent — each just unlocks a real capability. For each: what it powers, how to set it up, and how to prove it's live.

The Work System needs none of them: its system of record is a local ledger in your config tree. GitLab and Jira only add **read-only** context, and both are cleanly off when absent.

**The one command to remember:**

```
bun <configRoot>/WORKOS/TOOLS/Doctor.ts
```

Run it whenever anything feels off. Every ❌ line carries its own fix command. `--network` adds end-to-end auth checks (only for tools you've configured). `decline <name>` turns a capability off permanently and silently — declining is a supported way to run WorkOS, not a defect.

The one hard requirement is **bun ≥ 1.2.21**: hooks and tools parse YAML with Bun's built-in `Bun.YAML`, which older bun lacks. Doctor's `bun` line checks it; `bun upgrade` (in sbx: a newer `bun` kit) fixes it.

---

## Interceptor — real-browser verification

**Powers:** verification of anything web-facing through a real Chrome — screenshots, console logs, actual page loads. Doctrine treats "curl returned 200" as *not* verification; this is the tool that does it right.

- **Install:** the skill ships with WorkOS; it needs a real browser binary — Google Chrome or Brave. **The sbx sandbox has no browser**, so inside it Interceptor is unavailable: say so plainly when web verification would need it, and verify UI work from the host instead.
- **Auth:** none.
- **Verify:** `Doctor.ts` → interceptor ✅ (skill present + browser found). In the sandbox: `Doctor.ts decline interceptor`.

## glab — GitLab context (read-only)

**Powers:** your open merge requests and review requests in the session-start Work context block, the Atlas `gitlab` collector, and GitLab visibility checks in `PublicPushGate`. Every call is `glab api --method GET`; WorkOS never writes to GitLab.

- **Install:** see [gitlab.com/gitlab-org/cli](https://gitlab.com/gitlab-org/cli). In Docker Sandboxes it is preinstalled and authenticated through the proxy.
- **Auth:** `glab auth login` (sandbox: already done). `GITLAB_HOST` names the instance.
- **Verify:** `Doctor.ts` → glab ✅, then `bun <configRoot>/WORKOS/TOOLS/WorkContext.ts refresh` → `gitlab=ok`.
- **Absent:** off ⏸ — the GitLab part of the work context is skipped.

## Jira — sprint context (read-only)

**Powers:** your open-sprint tickets in the session-start Work context block, and the branch → ticket key link. The only request is `GET $JIRA_URL/rest/api/3/search/jql`; WorkOS never creates, edits, transitions or comments on tickets.

- **Install:** nothing — plain REST.
- **Auth:** set `JIRA_URL` (the api.atlassian.com gateway base), `JIRA_USERNAME` and `JIRA_API_TOKEN`. In Docker Sandboxes the proxy swaps the placeholders.
- **Verify:** `Doctor.ts --network` → jira ✅ (`GET /rest/api/3/myself`), then `WorkContext.ts refresh` → `jira=ok`.
- **Absent:** off ⏸. Keys differ per team; if the generic `KEY-123` pattern catches false positives, list your prefixes in `USER/WORK/config.yaml` → `jira.project_keys`.

## ripgrep — fast filesystem search

**Powers:** ContextSearch queries, the work sweep, and the model-drift scan. WorkOS treats the filesystem as its index instead of a vector store, so shipped tools shell out to `rg` directly.

- **Install:** `brew install ripgrep` (Linux: `sudo apt-get install ripgrep`)
- **Auth:** none.
- **Verify:** `Doctor.ts` → ripgrep ✅
- **Note:** the built-in `Grep` tool is already ripgrep-backed and works regardless; this is for the tools that spawn `rg` themselves.

## ImageMagick — image inspection

**Powers:** Interceptor's blank-frame guard, its measured zoom (`skills/Interceptor/Tools/Zoom.ts`), and Art's composition steps.

- **Install:** `brew install imagemagick` (Linux: `sudo apt-get install imagemagick`)
- **Auth:** none.
- **Verify:** `Doctor.ts` → imagemagick ✅
- **Note:** without it, `Capture.sh` still returns a screenshot but prints `BLANK-FRAME GUARD SKIPPED` — the capture is then unchecked for a black or blank frame, so don't cite it as pixel-verified without looking at it yourself.

## ffmpeg — audio and video

**Powers:** Interceptor's zoom fallback when ImageMagick is absent, and FrameScrub video-frame extraction.

- **Install:** `brew install ffmpeg` (Linux: `sudo apt-get install ffmpeg`)
- **Auth:** none.
- **Verify:** `Doctor.ts` → ffmpeg ✅

## yt-dlp — YouTube ingestion

**Powers:** the Upgrade skill's channel scan.

- **Install:** `brew install yt-dlp` (Linux: `sudo apt-get install yt-dlp`)
- **Auth:** none.
- **Verify:** `Doctor.ts` → ytdlp ✅

## fabric — prompt patterns

**Powers:** the Fabric skill's pattern library and its YouTube transcript fetch.

- **Install:** see the fabric project.
- **Auth:** per fabric's own setup.
- **Verify:** `Doctor.ts` → fabric ✅

## jq — JSON in shell hooks

**Powers:** the shell hooks that parse JSON, including the command-compression rewrite.

- **Install:** `brew install jq` (Linux: `sudo apt-get install jq`)
- **Auth:** none.
- **Verify:** `Doctor.ts` → jq ✅
- **Note:** hooks that need it check first and skip silently when it's missing, so absence costs the feature, never the tool call.

## Smaller optional tools

These are narrower — tied to one terminal, one platform, or one opt-in workflow — so the Doctor doesn't check them. Each is skipped cleanly when absent.

| Tool | Powers | Install |
|------|--------|---------|
| `rtk` | Transparent command compression on the Bash pre-tool hook — compresses what the model *watches* (git status, test and build runs), never what it *reads*. Skips silently without it (also needs `jq`). | `brew install rtk`, or take the release binary. **Do not run `rtk init -g`**: that installs rtk's own global hook alongside WorkOS's `ContextReduction.hook.sh` and you get two rewriters on the same command. rtk also keeps a local `history.db` of proxied commands, and its telemetry is opt-in — `rtk telemetry disable` makes that explicit. |
| `kitten` | Terminal tab naming and the retro banner, on the kitty terminal only. | ships with kitty |

## Optional npm dependencies

A few tools use npm packages. `DeployCore` runs `bun install` for them, which fails under deny-all egress, so in a sandbox they are normally absent. Each such tool then prints one line (what is missing, which feature is off, where to run `bun install`) and exits 1; nothing crashes and no hook depends on them. YAML parsing everywhere else uses Bun's built-in `Bun.YAML`.

| Feature | Package(s) | `bun install` in |
|---------|------------|------------------|
| Prompting templates (`RenderTemplate`, `ValidateTemplate`) | `handlebars` | `<configRoot>/skills/Prompting/Tools` |
| Evals suite/case writers (`SuiteManager`, `FailureToTask`, `GenerateCases`, `ProposeFromFailures`) | `yaml` | `<configRoot>` |
| Evals multi-turn scenarios (`ScenarioRunner`, legacy path) | `@langwatch/scenario`, `@ai-sdk/anthropic` | `<configRoot>/skills/Evals` |
| Memory graph (`MemoryGraph.ts`) | `graphology`, `graphology-communities-louvain`, `graphology-metrics` | `<configRoot>/WORKOS/TOOLS` |
| Token X-ray (`TokenXray.ts`) | `js-tiktoken` | `<configRoot>/WORKOS/TOOLS/TokenXray` |
| Apify skill | `apify-client` | `<configRoot>/skills/Apify` |

- **Verify:** `Doctor.ts` → npm-deps. ⏸ off = none installed; ✅ live lists any that are still missing. It is never ❌.
- **Bun auto-install:** with no `node_modules`, bun tries to fetch a missing package at import time. In the sandbox the egress proxy answers 403 and bun reports the package as not found; the tools turn that into the message above. There is no install-wide switch to stop the attempt: env vars and a global `~/.bunfig.toml` are ignored, `bunfig.toml` `[install] auto = "disable"` only applies when it is in the current directory, and `bun --no-install` has to be passed on every call. So the 403 is the expected failure, not a fault.
- **Docker Sandboxes: the docker-sbx `workos` kit.** It installs `yaml`, `handlebars`, `graphology` (+ `-communities-louvain`, `-metrics`) and `js-tiktoken` into the sandbox image at `/opt/workos/deps`, pinned by a committed lockfile, and sets `NODE_PATH` to its `node_modules`. Bun falls back to `NODE_PATH` after every `node_modules` up the tree misses, so these tools work with no `node_modules` in the workspace, and Doctor's `npm-deps` line counts them. Compose it after the `bun` kit. Price: the kit's `registry.npmjs.org:443` rule stays open for the sandbox's life (sbx cannot scope a rule to install time). It deliberately leaves out `apify-client` (no Apify egress) and the Evals scenario packages (they call the Anthropic API directly). Without the kit, the features above stay off.

---

## How degradation works (so you can trust it)

- The Doctor writes an **advisory manifest** (`WORKOS/MEMORY/STATE/capabilities.json`). It's a cache with TTLs, not truth — the runtime re-checks cheaply at the moment a capability is actually used.
- A **broken** capability warns once at the moment you'd have used it, with its fix command. Cooldowns prevent nagging.
- A **declined** capability is silent forever, everywhere.
- Output produced without a doctrine-relevant capability is **labeled** (e.g. "not browser-verified") — absence is never hidden inside a confident result.
- The manifest is tamper-evident: `Doctor.ts --verify` flags any edit made outside the Doctor.

That's the contract: nothing here scores you, nothing nags, and nothing pretends.
