---
name: Art
version: 1.6.0
description: "Vendor-free static visuals — Mermaid diagrams (flowchart, sequence, state, class, ER, Gantt, git graph), D3.js interactive charts and dashboards, and local background removal (rembg). USE WHEN diagram, mermaid, flowchart, sequence diagram, state diagram, ER diagram, architecture diagram, D3 chart, dashboard visualization, visualize data, remove background, transparent PNG. NOT FOR AI image generation (removed — no image-model vendor in this fork), hand-drawn whiteboard canvases (use Tldraw), video or animation, or web UI design and integrated frontend layout (use Webdesign)."
---

# Art Skill

## Customization

**Before executing, check for user customizations at:**
`~/.claude/WORKOS/USER/CUSTOMIZATIONS/SKILLS/Art/`

If this directory exists, load and apply `PREFERENCES.md` (palette, output location, diagram conventions). These override default behavior. If the directory does not exist, proceed with skill defaults.

## 🚨 MANDATORY: Notification (REQUIRED BEFORE ANY ACTION)

**You MUST send this notification BEFORE doing anything else when this skill is invoked.**

```
Running the **WorkflowName** workflow in the **Art** skill to ACTION...
```

## What It Does

Produces static technical visuals without any external image model: Mermaid source for diagrams that render natively in GitLab/GitHub/Markdown, self-contained D3.js HTML for interactive charts and dashboards, and transparent PNGs via local `rembg`. AI image generation (the former Gemini/Replicate `Generate.ts` path and its illustration workflows) is not part of this fork.

## Workflow Routing

Pick a workflow FIRST, then follow it.

| Workflow | Trigger | File |
|----------|---------|------|
| Mermaid | Flowchart, sequence, state, class/ER, Gantt, git graph, architecture diagram | `Workflows/Mermaid.md` |
| D3Dashboards | D3.js interactive chart or dashboard | `Workflows/D3Dashboards.md` |
| RemoveBackground | Remove background from an existing image | `Workflows/RemoveBackground.md` |

If no workflow fits (e.g. a request for an illustration or photo-style image), say so and offer the closest fit — a Mermaid diagram, a D3 chart, or a Tldraw canvas — rather than improvising.

## Output Location

Files this skill writes (D3 `.html`, `.mmd`, processed PNGs) go to `$WORKOS_DOWNLOADS_DIR` (default `~/Downloads/` when unset) first for review, never straight into a project directory. Mermaid meant for an MR, doc or README is returned inline as a fenced block.

## Examples

**Example 1: Sequence diagram for a service call**
```
User: "diagram how the payout request flows through the API, queue and worker"
→ Invokes MERMAID workflow
→ Picks sequenceDiagram, uses real service/queue names from the code
→ Returns a ```mermaid block ready for the MR description
```

**Example 2: Incident metrics chart**
```
User: "chart error rate per endpoint for the last 7 days from this CSV"
→ Invokes D3DASHBOARDS workflow
→ Writes a self-contained HTML file to Downloads for review
```

## Gotchas

- **Every node and edge must exist in the source.** A diagram that invents a component is worse than no diagram.
- **Verify Mermaid renders in the target viewer before claiming done** — GitLab and GitHub support slightly different Mermaid versions.
- **D3 output must be self-contained** (inline data, pinned library version) so it opens offline.
- **`rembg` strips thin linework on light backgrounds.** Skip background removal when the destination background already matches.

## Execution Log

After completing any workflow, append a single JSONL entry:

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","skill":"Art","workflow":"WORKFLOW_USED","input":"8_WORD_SUMMARY","status":"ok|error","duration_s":SECONDS}' >> ~/.claude/WORKOS/MEMORY/SKILLS/execution.jsonl
```

Replace `WORKFLOW_USED` with the workflow executed, `8_WORD_SUMMARY` with a brief input description, and `SECONDS` with approximate wall-clock time. Log `status: "error"` if the workflow failed.
