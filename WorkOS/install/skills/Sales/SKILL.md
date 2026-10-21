---
name: Sales
version: 1.0.28
description: "Transforms product documentation into sales-ready packages — a story explanation, talking points and a short script — via a narrative-arc pipeline. USE WHEN sales, proposal, pitch deck, value proposition, sales narrative, sales deck, sales package, turn this into a pitch, create a sales story, sales materials, product pitch, transform docs to sales, sales script. NOT FOR Hormozi $100M frameworks, value equation, irresistible offer, or VOC mining, standalone diagrams or illustrations (use Art), or platform social posts."
---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/WORKOS/USER/CUSTOMIZATIONS/SKILLS/Sales/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

## 🚨 MANDATORY: Notification (REQUIRED BEFORE ANY ACTION)

**You MUST send this notification BEFORE doing anything else when this skill is invoked.**

1. **Output text notification**:
   ```
   Running the **WorkflowName** workflow in the **Sales** skill to ACTION...
   ```

**This is not optional. Output this notification immediately upon skill invocation.**

# Sales Skill

## What It Does

Turns product documentation into a sales-ready package: a story narrative that captures the value proposition, clear talking points, and a short script. Output is text only (no image generation in this fork). It reads the real value out of technical docs and reframes it as something a sales team can actually use in a pitch.

## The Problem

Product docs explain what a thing does. Sales needs to explain why it matters — and the gap between the two is where most pitches die. Hand a sales team a feature list and they read off bullet points; the buyer feels nothing and forgets it. The translation from "here's what it does" to "here's the story you'll remember" usually takes a writer and a designer and a few days, so it doesn't happen, and the product gets sold flat. This skill does that translation: it pulls the narrative arc out of the docs, finds the emotional register, and writes the narrative and talking points tied directly to what's being sold.

## How It Works

The pipeline runs in three steps, from raw docs to a finished package:

```
PRODUCT DOCUMENTATION
        ↓
[1] STORY EXPLANATION — Extract the narrative arc (what's the real value?)
        ↓
[2] EMOTIONAL REGISTER — What feeling should this evoke? (wonder, determination, hope, etc.)
        ↓
[3] COMPILE — Narrative + talking points + script
        ↓
SALES-READY OUTPUT
```

It produces three things: sales narratives (story explanations that capture the value proposition), talking points, and scripts (clear, succinct messaging tied to what you're selling). Internally it leans on the story-explanation narrative engine.

---

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **CreateSalesPackage** | Full sales package — "create a sales package", product docs in, narrative + key talking points + script out | `Workflows/CreateSalesPackage.md` |
| **CreateNarrative** | Sales narrative only — "turn this into a pitch", "create a sales story", technical docs to compelling narrative | `Workflows/CreateNarrative.md` |

---

## Output Format

### Sales Narrative
- 8-24 point story explanation
- First person, conversational
- Captures the "why this matters" not just "what it does"
- Ready for sales scripts, presentations, pitches

---

## Example

**Input:** Technical documentation about AI code review tool

**Output:**
- **Narrative:** "This tool doesn't just find bugs—it understands your codebase like a senior engineer who's been there for years. It catches the subtle issues that slip through PR reviews..."
- **Talking Points:**
  1. Senior engineer understanding, not just pattern matching
  2. Catches what humans miss in PR reviews
  3. Learns your specific codebase patterns

---

## Integration

This skill combines:
- **A story-explanation skill** - For narrative extraction
- **Sales-specific framing** - Value proposition focus

---

**The goal:** Sales teams get materials that are highly tied to what they're selling, clear, succinct, and effective.

---

## Examples

**Example 1: Full sales package from docs**
```
User: "create a sales package for this product" [provides docs]
→ Extracts narrative arc using storyexplanation
→ Determines emotional register (wonder, determination, hope)
→ Writes narrative + talking points + script
```

**Example 2: Sales narrative only**
```
User: "turn this technical doc into a sales pitch"
→ Reads documentation and extracts value proposition
→ Creates 8-24 point story explanation in first person
→ Returns conversational narrative ready for sales scripts
```

## Gotchas

- **No image generation.** If a diagram helps the pitch, use the Art skill's Mermaid workflow; otherwise stay text-only.
- **Pitch decks must tell a STORY, not list features.** Narrative arc matters more than bullet points.
- **NOT for Hormozi frameworks** — use a dedicated Hormozi $100M Offers/Leads skill for that methodology.

## Execution Log

After completing any workflow, append a single JSONL entry:

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","skill":"Sales","workflow":"WORKFLOW_USED","input":"8_WORD_SUMMARY","status":"ok|error","duration_s":SECONDS}' >> ~/.claude/WORKOS/MEMORY/SKILLS/execution.jsonl
```

Replace `WORKFLOW_USED` with the workflow executed, `8_WORD_SUMMARY` with a brief input description, and `SECONDS` with approximate wall-clock time. Log `status: "error"` if the workflow failed.
