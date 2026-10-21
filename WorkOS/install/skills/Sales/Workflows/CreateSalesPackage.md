# Create Sales Package

**Full pipeline: Transform product documentation into a text sales package — narrative, talking points, script.**

---

## 🚨 MANDATORY STEPS — EXECUTE IN ORDER

```
PRODUCT DOCUMENTATION
        ↓
[1] STORY EXPLANATION — Extract narrative arc with StoryExplanation Skill
        ↓
[2] EMOTIONAL REGISTER — Match to emotion from aesthetic vocabulary
        ↓
[3] COMPILE OUTPUT — Narrative + talking points + script
```

---

## Step 1: Extract Narrative with Story Explanation

**Use the StoryExplanation Skill to extract the narrative arc.**

```
Invoke StoryExplanation Skill with 24-item length for [product documentation]
```

**Focus on:**
- What's the REAL value proposition?
- Why does this MATTER to the customer?
- What problem does this SOLVE?
- What's the transformation (before → after)?

**Output:** 8-24 point story explanation capturing the value proposition.

---

## Step 2: Identify Emotional Register

**Match the product/value proposition to an emotional register.**


| Value Proposition Type | Emotional Register | Warm:Cool |
|------------------------|-------------------|-----------|
| **Solves painful problem** | HOPE / POSSIBILITY | 80:20 |
| **Prevents disaster/risk** | URGENCY / WARNING | 60:40 |
| **Enables new capabilities** | WONDER / DISCOVERY | 40:60 |
| **Saves time/effort** | DETERMINATION / EFFORT | 70:30 |
| **Deep expertise/insight** | CONTEMPLATION | 50:50 |
| **Team/collaboration** | CONNECTION | 90:10 |
| **Replaces legacy/old way** | MELANCHOLY (for old) + HOPE (for new) | 60:40 |

**Output:** Selected emotional register with specific vocabulary.

---

## Step 3: Compile Sales Package

**Assemble the complete output.**

### Output Format

```markdown
# Sales Package: [Product/Feature Name]

## Sales Narrative

[8-24 point story explanation from Step 1]

## Key Talking Points

1. [First major value point]
2. [Second major value point]
3. [Third major value point]

## Emotional Hook

**Register:** [Emotional register used]
**Core Message:** [One sentence that captures the feeling]

## Script Snippet

"[2-3 sentence elevator pitch version of the narrative]"
```

---

## Validation Checklist

Before delivering:

- [ ] **Narrative captures VALUE** — not just features, but why it matters
- [ ] **Emotional register consistent** — narrative, hook and script aligned
- [ ] **Talking points actionable** — sales team can use immediately
- [ ] **Script is natural** — sounds like something you'd actually say

---

## Example Execution

**Input:** Documentation for AI code review tool

**Step 1 Output (Narrative):**
1. Code review is broken — PRs get rubber-stamped
2. Junior devs miss subtle bugs, seniors don't have time
3. This tool understands your codebase like a 10-year veteran
4. It catches the issues that slip through human review
5. Not pattern matching — actual understanding of your patterns
6. Learns your specific conventions and flags deviations
7. Integrates into existing workflow — no context switching
8. Result: fewer production bugs, faster reviews, happier teams

**Step 2 Output:** WONDER / DISCOVERY (40:60 warm:cool) — "it actually understands"

**Step 3 Output:** Complete sales package with narrative, talking points, emotional hook, and script

---

**The workflow: Story Explanation → Emotion → Compile**
