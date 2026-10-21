# CompareModels Workflow

Compare multiple models on the same prompt to determine the best performer.

## Notification

Running the **CompareModels** workflow in the **Evals** skill to compare model performance...

---

## Prerequisites

- Existing use case with test cases and prompt
- API access to all models being compared
- Clear understanding of comparison criteria

## Execution

### Step 1: Identify Comparison

Ask the user:
1. Which use case?
2. Which models to compare? (the Claude tiers: opus, sonnet, haiku — always by alias)
3. What's the primary evaluation criterion?
4. Are there cost/latency constraints?

### Step 2: Update Use Case Config

Ensure models are listed in `config.yaml`:

```yaml
models:
  - opus
  - sonnet
  - haiku
```

### Step 3: Create Model Comparison Config

Create `~/.claude/skills/Evals/UseCases/<name>/model-comparisons/<comparison-name>.yaml`:

```yaml
model_comparison:
  name: "Opus vs Sonnet vs Haiku"
  hypothesis: |
    Testing which tier produces good-enough incident summaries at the lowest cost.
    Expect Opus to lead on accuracy, Haiku on latency.

  prompt: "prompts/v1.0.0.md"  # Same prompt for all models

  models:
    - id: "opus"
      name: "Opus"
      provider: "anthropic"

    - id: "sonnet"
      name: "Sonnet"
      provider: "anthropic"

    - id: "haiku"
      name: "Haiku"
      provider: "anthropic"

  # Test configuration
  test_cases: all

  # Evaluation settings
  judges:
    - name: "Primary Judge"
      model: "opus"  # Use a tier at least as strong as the strongest model under test
      criteria:
        - accuracy
        - style
        - format

  settings:
    runs_per_model: 1
    temperature: 0.7
    max_tokens: 2000

  # Cost tracking
  track_costs: true
  track_latency: true
```

### Step 4: Run Model Comparison

Run the same suite once per model via `EvalRunner.ts`, then collect the per-run `results.json` and compare. The suite config encodes the model under test, so vary it across runs:

```bash
# Sequential — three runs, one per model
bun run ~/.claude/skills/Evals/Tools/EvalRunner.ts -s <use-case>-opus
bun run ~/.claude/skills/Evals/Tools/EvalRunner.ts -s <use-case>-sonnet
bun run ~/.claude/skills/Evals/Tools/EvalRunner.ts -s <use-case>-haiku

# Parallel — same three runs in the background
bun run ~/.claude/skills/Evals/Tools/EvalRunner.ts -s <use-case>-opus &
bun run ~/.claude/skills/Evals/Tools/EvalRunner.ts -s <use-case>-sonnet &
bun run ~/.claude/skills/Evals/Tools/EvalRunner.ts -s <use-case>-haiku &
wait
```

Each run's `results.json` lands at `~/.claude/WORKOS/MEMORY/STATE/Evals-Results/<use-case>-<model>/<run-id>/results.json`. Side-by-side comparison is done by reading those JSONs (`jq`) — there is no built-in cross-model comparison CLI in this skill.
5. View side-by-side results

### Step 5: Collect Results

Results stored in:
- `WORKOS/MEMORY/STATE/Evals-Results/<use-case>/models/<run-id>/`
- `WORKOS/MEMORY/STATE/Evals-Results/<use-case>/models/<run-id>/comparison.json`

### Step 6: Generate Comparison Report

Use Report template:

```bash
bun run ~/.claude/skills/Prompting/Tools/RenderTemplate.ts \
  -t Evals/Report.hbs \
  -d ~/.claude/WORKOS/MEMORY/STATE/Evals-Results/<use-case>/models/<run-id>/summary.yaml \
  -o ~/.claude/WORKOS/MEMORY/STATE/Evals-Results/<use-case>/models/<run-id>/report.md
```

### Step 7: Analyze Results

**Multi-Model Summary Table:**

| Model | Pass Rate | Mean Score | Std Dev | Cost/1K | Latency |
|-------|-----------|------------|---------|---------|---------|
| Opus | 94% | 4.4 | 0.4 | $0.08 | 2.1s |
| Sonnet | 92% | 4.3 | 0.5 | $0.03 | 1.2s |
| Haiku | 78% | 3.7 | 0.8 | $0.01 | 0.5s |

**Per-Dimension Breakdown:**

| Model | Accuracy | Style | Format | Speed |
|-------|----------|-------|--------|-------|
| Opus | 4.6 | 4.5 | 4.1 | 2.1s |
| Sonnet | 4.5 | 4.6 | 4.0 | 1.2s |
| Haiku | 3.8 | 3.7 | 3.6 | 0.5s |

### Step 8: Statistical Analysis

For each model pair, calculate:
- **p-value**: Statistical significance of difference
- **Effect size**: Magnitude of difference
- **Confidence intervals**: Range of true performance

```markdown
### Pairwise Comparisons

| Comparison | Winner | p-value | Significant? |
|------------|--------|---------|--------------|
| Opus vs Sonnet | Opus | 0.31 | No |
| Opus vs Haiku | Opus | 0.01 | Yes |
| Sonnet vs Haiku | Sonnet | 0.02 | Yes |
```

### Step 9: Make Recommendation

Consider trade-offs:

| Factor | Weight | Best Model |
|--------|--------|------------|
| Quality | 50% | Sonnet |
| Cost | 25% | Haiku |
| Latency | 25% | Haiku |

**Decision Matrix:**

```markdown
## Recommendation

**Primary Use**: Sonnet
- Best quality (4.3 mean score)
- 92% pass rate
- Acceptable cost ($0.03/1K tokens)

**Budget Option**: Haiku
- Good quality (3.7 mean score)
- 78% pass rate
- Lowest cost ($0.01/1K tokens)
- Fastest (0.5s latency)

**Escalation**: Opus
- Marginally higher quality, not significant at this sample size
- Higher cost and latency
- Use for the hard cases Sonnet fails
```

### Step 10: Document Results

Update use case README:

```markdown
## Model Comparison History

### Opus vs Sonnet vs Haiku (YYYY-MM-DD)

**Purpose**: Determine the cheapest tier good enough for incident summaries.

**Results**:
1. Opus - 94% pass rate, 4.4 mean score
2. Sonnet - 92% pass rate, 4.3 mean score
3. Haiku - 78% pass rate, 3.7 mean score

**Decision**:
- Production: Sonnet
- Budget fallback: Haiku
```

## Best Practices

### Fair Comparison

1. **Same prompt** for all models
2. **Same temperature** (default 0.7)
3. **Same max_tokens** limit
4. **Multiple runs** to account for variance

### Judge Selection

**Problem**: A model judging its own output may be biased.

**Solutions**:
1. Judge with a tier at least as strong as the strongest model under test
2. Average across several judge runs or judge tiers
3. Prefer deterministic asserts wherever the criterion allows

### Cost-Quality Trade-offs

Use this framework:

| Scenario | Recommended |
|----------|-------------|
| Quality-critical, cost flexible | Best performing model |
| Quality-critical, cost-sensitive | Best quality-per-dollar |
| Latency-critical | Fastest with acceptable quality |
| High volume | Cheapest with acceptable quality |

### Model Selection Matrix

| Use Case | Recommended Model | Why |
|----------|-------------------|-----|
| Incident / PR summaries | Sonnet | Quality per dollar |
| Data extraction | Sonnet | Structured output strength |
| Fast classification | Haiku | Speed + cost |
| Complex reasoning | Opus | Reasoning quality |

## Output Template

```markdown
# Model Comparison Report: <Use Case>

## Executive Summary

**Best Overall**: <Model Name>
**Best Value**: <Model Name>
**Fastest**: <Model Name>

## Detailed Results

### Performance Metrics

[Table of metrics]

### Statistical Analysis

[Pairwise comparisons with p-values]

### Cost Analysis

[Cost per 1K tokens, total run cost]

### Latency Analysis

[Average response time, p95 latency]

## Recommendation

[Final recommendation with rationale]

## Raw Data

[Link to full results JSON]
```

## Done

Model comparison completed. Best model identified. Decision documented.
