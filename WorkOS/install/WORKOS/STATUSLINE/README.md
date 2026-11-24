# Statusline

The WorkOS status line, rendered by one Bun process. Ported from upstream 8.761.0 in WorkOS 2.0.0, it replaced a 2,469-line bash script that started about 53 processes per render. `WORKOS/WORKOS_StatusLine.sh` is now a thin shim that execs `Render.ts`, so settings and the installer keep their entry point.

## Shape

- `Render.ts`: reads Claude Code's statusline JSON on stdin, builds one typed `State` (`State.ts`), admits the render (`Admission.ts`), draws every registered section into a `Frame`, clips it to the pane and promotes the finished frame (`Frame.ts`), then exits.
- `Admission.ts`: most runs change nothing. While the transcript is older than a frame under 30 seconds old and the pane is the same size, the cached frame is replayed without drawing.
- `Registry.ts`: the one table of rows, in frame order. Each row declares what it reads.
- `sections/`: one module per row or chip. `producers/`: typed views over local files, plus the refresh job.
- Width: every row fits the pane on its own line. Rows list their forms fullest first and draw the first that fits (`fit()` in `Width.ts`), so a wide pane shows everything and a narrow one drops detail instead of wrapping. Content caps at 100 columns (`WORKOS_STATUSLINE_MAX_WIDTH`, 0 for the full pane) and is centered in a wider pane (`WORKOS_STATUSLINE_ALIGN=left` turns that off). A pane under 60 columns wide or under 30 lines tall gets the compact layout, the header and session rows only (`WORKOS_STATUSLINE_COMPACT=1` or `0` forces either).
- `Cache.ts`: the one cache API (parsed reads, atomic writes, TTLs from one clock), under `$XDG_CACHE_HOME/workos-statusline` (default `~/.cache`). `Ansi.ts`, `Width.ts`, `Glyphs.ts`, `ContextBar.ts`: shared helpers.

## Rows

| Row | Shows | Reads |
|-----|-------|-------|
| header | WorkOS version, clock, project folder; the mode chips when there is no session name | `VERSION`, stdin |
| session | the session name and tab title, with the ⚡ULTRACODE and ↯ FAST chips | `MEMORY/STATE/session-names.json`, `session-labels.json`, the transcript, stdin `fast_mode` |
| work | open ledger work (Active, Urgent P0/P1, Due, Open), then MRs, reviews waiting on you and Jira tickets, then the item to work next | `USER/WORK/ledger.jsonl`, `MEMORY/STATE/work-context.json` |
| memory | the memory health gate's first critical action or warning, only when there is one | last line of `MEMORY/OBSERVABILITY/memory-health.jsonl` |
| doctor | Doctor's capability delta line, only when there is one | `MEMORY/STATE/capabilities-statusline.txt` |
| version | Algorithm version and default model, in a narrower pane or with `WORKOS_STATUSLINE_FULL=1` | `ALGORITHM/LATEST`, stdin |
| models | the four Claude rungs from `TOOLS/models.ts`, each lit with its share of this session's output tokens | `TOOLS/ModelMix.ts` over the transcript |
| context | the context meter, coloured by model mix, and the startup load (LD) | stdin `context_window`, `CLAUDE.md` and its imports, `WORKOS_SYSTEM_PROMPT.md` |
| account | `AMAZON BEDROCK` and the AWS region on Bedrock, else the signed-in Claude Code address | env, `~/.claude.json` |

Not ported from upstream: location, weather and tide (no egress in a sandbox), life ratings, Synapse inputs, Claude and Codex plan usage and money (Bedrock bills per token through AWS and reports no plan meter), cosmos, the quote, the herdr sidebar report, and the `statusline-fast` Rust front end (the Bun path is fast enough for a 5-second refresh).

## Refresh

A render only reads files; with every cache fresh it starts no process and makes no fetch. The one shared cache it needs from outside stdin, the Claude Code version, is refreshed by `Refresh.ts`, which MaintenanceJobs runs at session start (job `statusline-refresh`, at most hourly) because a Docker Sandbox has no scheduler. The WORK row reads the ledger and the WorkContext cache directly; LoadContext keeps that cache fresh.

## Checks

- `bun test ./WORKOS/STATUSLINE` renders fixture trees in a subprocess, with an isolated `XDG_CACHE_HOME`.
- Run the renderer by hand only with an isolated `XDG_CACHE_HOME`, so a test frame never replaces the live one.
