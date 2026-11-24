# Pitch

**Contents:** Ideal State · Anti-criteria · Inputs · Tool contract · Output format · Examples

Product documentation turned into a sales pitch a buyer can retell: a first-person value story, talking points, an elevator pitch and a problem/solution/outcome summary. Two modes, carried from the retired Sales skill: CreateNarrative (the pitch alone) and CreateSalesPackage (the pitch plus an emotional hook and a script snippet). WorkOS ships no image generation lane, so upstream's charcoal-sketch mode (CreateVisual) is not here; a picture for the pitch is the principal's to supply.

## Ideal State

- A 24-point story explanation of the input existed before the narrative, framed around the PROBLEM the product solves, the TRANSFORMATION (before → after), why the customer should CARE, and the FEELING of using it.
- The story is an 8-24 point narrative, first person and conversational, about VALUE rather than features and centered on the customer's problem and outcome.
- The buyer can retell it after one hearing: it has a before, a shift and an after that survive being repeated by someone who heard it once.
- Every claim traces to a source line: each thing the narrative asserts about the product maps to a specific line in the docs, and the narrative states only what those lines support.
- Features appear only in service of why they matter to the buyer.
- The arc leads with the pain point, introduces the transformation, proves the value with concrete benefits, creates urgency (why now, the cost of waiting), and ends with the outcome.
- 3-5 key talking points, each a standalone, quotable value statement tied to a specific customer outcome.
- A 2-3 sentence elevator pitch a salesperson would actually say aloud, capturing the core value in 30 seconds.
- A Problem / Solution / Outcome summary, one sentence each.
- The whole is specific (concrete problems, outcomes and benefits from the docs), reads naturally aloud, and the sales team can use it immediately without edits.
- In CreateSalesPackage, the Emotional Hook names one register (wonder, relief, confidence, belonging, urgency, pride) chosen from the narrative's emotional core, and the core message, talking points and script all point at that one idea.

## Anti-criteria

- No invented capability and no rounded-up number: the pitch is only as strong as it is true.
- Not one sentence reads "it does X, and Y, and Z"; a sentence that reads like a spec sheet is rewritten as consequence.
- No generic marketing speak.
- No confidential employer material (customer names, internal figures, unreleased plans) in a pitch meant for an outside audience unless the principal said it may go there.

## Inputs

- Any of: product documentation, feature specifications, technical descriptions, marketing copy to improve, a file or pasted text. A URL is read only if the sandbox can reach it; otherwise ask for the text.
- Customizations at `<configRoot>/WORKOS/USER/CUSTOMIZATIONS/SKILLS/Presentation/` (PREFERENCES.md, configurations, resources) override these defaults when the directory exists.

## Tool contract

CreateSalesPackage pipeline order:

```
PRODUCT DOCUMENTATION
        ↓
[1] STORY EXPLANATION — 24-point narrative arc of the input
        ↓
[2] EMOTIONAL REGISTER — the one feeling the story should leave
        ↓
[3] COMPILE OUTPUT — Narrative + talking points + hook + script
```

A sales deck built from this pitch goes to CreateDeck.

## Output format

CreateNarrative:

```markdown
# Sales Narrative: [Product/Feature Name]

## The Story

[8-24 point narrative, first person, conversational]

## Key Talking Points

1. [First value statement]
2. [Second value statement]
3. [Third value statement]

## Elevator Pitch

"[2-3 sentence script]"

## Pain Point Summary

**Problem:** [One sentence describing the pain]
**Solution:** [One sentence describing the transformation]
**Outcome:** [One sentence describing success]
```

CreateSalesPackage:

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

## Examples

```
User: "turn this technical doc into a sales pitch" [AI code review tool docs]
→ CreateNarrative: 24-point story first, then an 8-point first-person story
  (1. Code review is broken, PRs get rubber-stamped … 8. Result: fewer production bugs, faster reviews, happier teams)
→ Talking points: senior-engineer understanding, not just pattern matching; catches what humans miss in PR reviews; learns your codebase patterns
```

```
User: "create a sales package for this product" [docs]
→ CreateSalesPackage: narrative → register CONFIDENCE → narrative, talking points, Emotional Hook and Script Snippet
```
