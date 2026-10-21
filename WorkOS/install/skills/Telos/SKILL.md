---
name: Telos
version: 1.0.46
description: "Dual-context skill: Work TELOS reads and updates the principal's work goals, problems, strategies, projects, narratives, and lessons with timestamped backups; Project TELOS analyzes .md/.csv directories for dependency chains, bottlenecks, and alignment, generating reports, narrative points, or dashboards. USE WHEN Telos, work goals, career goals, projects, dependencies, update TELOS, narrative points, McKinsey report, dashboard, what am I wrong about, mental models. NOT FOR conversational constitutional review (use Interview)."
---

## 🚨 MANDATORY: Notification (REQUIRED BEFORE ANY ACTION)

**You MUST send this notification BEFORE doing anything else when this skill is invoked.**

1. **Output text notification**:
   ```
   Running the **WorkflowName** workflow in the **Telos** skill to ACTION...
   ```

**This is not optional. Output this notification immediately upon skill invocation.**

# Telos

## What It Does

Reads and updates two kinds of context. Work TELOS: the principal's work context — current and ideal state at work, mission, problems, goals, challenges, strategies, projects, narratives, models, wisdom, wrong-beliefs — in `~/.claude/WORKOS/USER/TELOS/TELOS.md`, updated through the Update workflow with timestamped backups. Project TELOS: analyzes a directory of .md/.csv files to extract dependency chains (PROBLEMS→GOALS→STRATEGIES→PROJECTS), bottlenecks, alignment, and progress, then produces a McKinsey-style report, n=24 narrative points, or a Next.js dashboard built by parallel engineers.

## The Problem

Work context and project state both sprawl, and acting on them by hand is error-prone. Work goals, problems, and lessons drift out of date, and hand-editing them risks losing history or corrupting structure. Project documentation hides the dependency chains, bottlenecks, and misalignments that decide whether the work is on track — you can read every file and still not see how PROBLEMS connect to GOALS connect to PROJECTS. This skill gives both a single safe way in: structured updates with backups for the work-context side, and automated relationship analysis plus rendered outputs for the project side.

## How It Works

**TELOS** is a context-gathering system with two applications:

1. **Work TELOS** - {PRINCIPAL.NAME}'s work context (role, goals, problems, strategies, lessons) at `~/.claude/WORKOS/USER/TELOS/TELOS.md`
2. **Project TELOS** - Analysis framework for organizations/projects (relationships, dependencies, goals, progress)

The skill detects which context a request means (see Context Detection below), then routes to the right workflow. Work TELOS updates always go through the Update workflow so backups and changelog entries happen automatically. Project analysis scans the target directory, builds a relationship graph, and renders the output format you asked for.

## Workflow Routing

**When executing a workflow, output this notification directly:**

```
Running the **WorkflowName** workflow in the **Telos** skill to ACTION...
```

| Workflow | Trigger | File |
|----------|---------|------|
| **Update** | "add to TELOS", "update my goals", "add a lesson to TELOS" | `Workflows/Update.md` |
| **InterviewExtraction** | "extract content", "extract interviews", "analyze interviews" | `Workflows/InterviewExtraction.md` |
| **CreateNarrativePoints** | "create narrative", "narrative points", "TELOS report", "n=24" | `Workflows/CreateNarrativePoints.md` |
| **WriteReport** | "write report", "McKinsey report", "create TELOS report", "professional report" | `Workflows/WriteReport.md` |

**Note:** For general project analysis, dashboards, dependency mapping, and executive summaries, the skill handles these directly without a separate workflow file.

## Examples

**Example 1: Update the work TELOS**
```
User: "add a Q3 goal to my TELOS: ship the payments retry service"
--> Invokes Update workflow
--> Creates timestamped backup of TELOS.md
--> Adds the entry at the end of the Goals section with the next G-ID
--> Logs change in updates.md with timestamp
```

**Example 2: Analyze project with TELOS**
```
User: "analyze ~/Projects/MyApp with TELOS"
--> Scans all .md and .csv files in directory
--> Extracts entities, relationships, dependencies
--> Returns analysis with dependency chains and progress metrics
```

**Example 3: Build project dashboard**
```
User: "build a dashboard for ~/Projects/AcmeOrg"
--> Launches up to 16 parallel engineers
--> Creates Next.js dashboard with shadcn/ui + Aceternity
--> Returns interactive dashboard with dependency graphs, metrics cards, progress tables
```

**Example 4: Generate narrative points**
```
User: "create TELOS narrative for Acme Corp, n=24"
--> Invokes CreateNarrativePoints workflow
--> Analyzes TELOS context (situation, problems, recommendations)
--> Returns 24 crisp bullet points (8-12 words each)
--> Output is slide-ready for presentations or customer briefings
```

**Example 5: Generate McKinsey-style report**
```
User: "write a TELOS report for Acme Corp"
--> Invokes WriteReport workflow
--> First runs CreateNarrativePoints to generate story content
--> Maps narrative to McKinsey report structure
--> Generates web-based report with professional styling
--> Output at {project_dir}/report - run `bun dev` to view
--> White background, subtle Tokyo Night Storm accents
--> Includes: cover page, executive summary, findings, recommendations, roadmap
```

---

## Context Detection

**How {DA_IDENTITY.NAME} determines which TELOS context:**

| User Request | Context | Location |
|--------------|---------|----------|
| "my TELOS", "my goals", "my work goals", "add to TELOS" | Work TELOS | `~/.claude/WORKOS/USER/TELOS/TELOS.md` |
| "analyze [project]", "dashboard for [org]" | Project TELOS | User-specified directory |
| "analyze ~/path/to/project" | Project TELOS | Specified path |

---

# Part 1: Work TELOS ({PRINCIPAL.NAME}'s work context)

## Location

**CRITICAL PATH:** The work TELOS is one file:
```
~/.claude/WORKOS/USER/TELOS/TELOS.md
```

It lives in the CORE USER directory, NOT under the Telos skill directory. `PRINCIPAL_TELOS.md` next to it is generated from TELOS.md (`WORKOS/TOOLS/GenerateTelosSummary.ts`) — never edit it directly.

## Work TELOS Sections

TELOS.md is structured as H2 sections:

- **Current State** — role, team, systems owned, career position now
- **Ideal State** — where the principal wants to be at work
- **Mission** (M0+) — the professional mission
- **Problems** (P0+) — problems the work is solving
- **Goals** (G0+) — sprint, quarter and career goals
- **Challenges** (C0+) — what is stopping the goals
- **Strategies** (S0+) — how the challenges get overcome
- **Projects** (PR0+) — what is being worked on
- **Narratives** (N0+) — talking points for reviews, demos and 1:1s
- **Models** (MO0+) — mental models used for engineering decisions
- **Wrong** — things the principal was wrong about
- **Wisdom** — engineering lessons
- Optional: **Beliefs** (B0+), **Frames** (FR0+), **Predictions** — professional

### Change Tracking
- **updates.md** - changelog of all TELOS updates
- **Backups/** - timestamped backups

## Working with the Work TELOS

### Read

```bash
read ~/.claude/WORKOS/USER/TELOS/TELOS.md
read ~/.claude/WORKOS/USER/TELOS/updates.md
```

### Update

**CRITICAL:** Never manually edit. Use the Update workflow.

**Workflow:** `Workflows/Update.md`

The workflow provides:
- Automatic timestamped backups
- Change logging in updates.md
- Section-targeted inserts (`--section "<heading>"`), so an entry never lands under the wrong heading

---

# Part 2: Project TELOS (Organizational Analysis)

## Capabilities

For any project directory, TELOS provides:

1. **Relationship Discovery** - Find how files/entities connect
2. **Dependency Mapping** - Identify what depends on what
3. **Goal Extraction** - Discover stated and implied objectives
4. **Progress Analysis** - Track advancement and metrics
5. **Narrative Generation** - Create executive summaries
6. **Visual Dashboards** - Build beautiful UIs with data

## Target Directory Detection

**Flexible file discovery - no required structure:**

```bash
# User specifies directory
"Analyze ~/Projects/<your-org-tree>"
--> {DA_IDENTITY.NAME} scans for .md and .csv files anywhere in tree

# {DA_IDENTITY.NAME} automatically finds all .md and .csv files regardless of structure
```

## Analysis

Point the skill at a project directory (named project, explicit path, or common location). A good analysis surfaces the dependency chains PROBLEMS→GOALS→STRATEGIES→PROJECTS, the bottlenecks blocking progress, whether projects align with stated objectives, progress/completion metrics, and risk areas (overdue or blocked work) — grounded in what the files actually say, never cached assumptions.

Discover the source files:
```bash
find $TARGET_DIR -type f \( -name "*.md" -o -name "*.csv" \)
```

Deliver in whatever format was asked: markdown report (Mermaid diagrams), interactive web dashboard, JSON export, or executive summary.

## Building Dashboards

The deliverable is an interactive Next.js dashboard that renders the analysis against the stack and design tokens below. **Start from the shipped scaffold at `DashboardTemplate/`** (working Next.js app: file browser, markdown/CSV rendering, dependency views — see its README for the copy-and-run steps) rather than from scratch, then adapt pages to the analysis. Fan the build out across parallel agents however the work splits cleanly — data-parsing lib, shared components, per-page views, theme, integration — running independent pieces at once. (Wired per public issue #1555, @tzioup — the template previously shipped unreferenced.)

**Tech Stack:**
- Next.js 14 + TypeScript
- shadcn/ui for UI components
- Aceternity UI for layouts
- Tailwind CSS
- Tokyo Night Day theme (professional light)

**Features:**
- Dependency graphs (Mermaid or D3.js)
- Progress tables (sortable, filterable)
- Metrics cards (KPIs, stats)
- Timeline visualizations
- Relationship networks

**Design tokens:**
```css
--background: #ffffff
--foreground: #1a1b26
--primary: #2e7de9
--accent: #9854f1
--destructive: #f52a65
--success: #33b579
--warning: #f0a020
```

## Common TELOS Files

**Standard Project TELOS Structure** (auto-detected):

### Context Files
- **OVERVIEW.md** - Project overview
- **COMPANY.md** - Organization context
- **PROBLEMS.md** - Issues to solve
- **GOALS.md** - Objectives
- **MISSION.md** - Mission statement
- **STRATEGIES.md** - Strategic approaches
- **PROJECTS.md** - Active initiatives

### Operational Files
- **EMPLOYEES.md** - Team members
- **ENGINEERING_TEAMS.md** - Team structure
- **BUDGET.md** - Financial tracking
- **KPI_TRACKING.md** - Metrics
- **APPLICATIONS.md** - App inventory
- **TOOLS.md** - Tooling
- **VENDORS.md** - Third parties

### Security Files
- **VULNERABILITIES.md** - Security issues
- **SECURITY_POSTURE.md** - Security state
- **THREAT_MODEL.md** - Threats

### Data Files (CSV)
- **data/VULNERABILITIES.csv** - Vuln tracking
- **data/INCIDENTS.csv** - Incident log
- **data/VENDORS.csv** - Vendor data

**Note:** Files are optional. TELOS adapts to whatever exists.

## Visualization Types

**Available Visualizations:**

- **Dependency Graphs** - Mermaid or D3.js network
- **Progress Tables** - shadcn/ui tables with filters
- **Metrics Cards** - Aceternity card layouts
- **Timeline Charts** - Progress over time
- **Status Dashboards** - KPI overviews
- **Relationship Networks** - Force-directed graphs
- **Bar Charts** - Recharts for comparisons
- **Line Charts** - Trend analysis

---

## Security & Privacy

**Work TELOS:**
- NEVER commit to public repos
- NEVER share outside the company
- Always backup before changes
- Use Update workflow only

**Project TELOS:**
- May contain sensitive data
- Ask before sharing externally
- Redact sensitive info in examples
- Follow WorkOS security protocols

---

## Gotchas

- **Telos data is private work context.** Never include in public repos, skills, or outputs.
- **Goals and dependencies change — always read current state before advising.** Don't rely on cached knowledge.
- **Project dashboards pull from multiple sources.** Verify data freshness before presenting.

## Execution Log

After completing any workflow, append a single JSONL entry:

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","skill":"Telos","workflow":"WORKFLOW_USED","input":"8_WORD_SUMMARY","status":"ok|error","duration_s":SECONDS}' >> ~/.claude/WORKOS/MEMORY/SKILLS/execution.jsonl
```

Replace `WORKFLOW_USED` with the workflow executed, `8_WORD_SUMMARY` with a brief input description, and `SECONDS` with approximate wall-clock time. Log `status: "error"` if the workflow failed.
