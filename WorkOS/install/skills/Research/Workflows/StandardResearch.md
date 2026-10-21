# Standard Research Workflow

**Mode:** 3 ClaudeResearcher agents, 3 different angles, 1 query each | **Timeout:** 2 minutes

## 🚨 CRITICAL: URL Verification Required

**BEFORE delivering any research results with URLs:**
1. Verify EVERY URL using WebFetch or curl
2. Confirm the content matches what you're citing
3. NEVER include unverified URLs - research agents HALLUCINATE URLs
4. A single broken link is a CATASTROPHIC FAILURE

See `SKILL.md` for full URL Verification Protocol.

## When to Use

- Default mode for most research requests
- User says "do research" or "research this"
- Need multiple perspectives quickly

## Workflow

### Step 0: Source Routing Check (MANDATORY)

**READ:** `../SourceRoutingProtocol.md` if not already loaded.

Scan the user's request for sentiment signals: "fans thought", "ratings of", "best | worst | favorite", "reactions to", "consensus on", event + recent date.

- **Signal fires → sentiment-mode routing.** Walk the API-first cascade in `../SourceRoutingProtocol.md`. Add a fourth agent slot in Step 2: a general-purpose community-API subagent whose Tier-1 brief is: **(a)** Reddit JSON API call against 2-3 relevant subreddits via Bash + `curl -A "WorkOS-Research/1.0"`, **(b)** Apify `apidojo/tweet-scraper` for the X first-6-hour reaction cluster, **(c)** Apify reddit-scraper only as Tier-2 fallback if the Reddit JSON path fails. Return verbatim quotes with thread/post URLs and engagement scores. If ≥30s budget headroom remains, also spawn a YouTube agent that runs `fabric -y` on top reactor videos (Apify for comments).
- **No signal → Step 1 unchanged.** Three web-search agents as documented below.

### Step 1: Craft One Query Per Researcher

All three agents are ClaudeResearcher, so diversity must come from the query. Create ONE focused query per angle, deliberately different:
- **Depth**: Academic depth, detailed analysis, scholarly sources
- **Perspectives**: Multi-perspective synthesis, cross-domain connections
- **Current state**: Live-web retrieval with citations; freshest snapshot
- **Primary sources** (technical/code/API questions ONLY — add this fourth slot when the technical signal in `../SourceRoutingProtocol.md` fires): official docs, changelogs, source repos, release notes — never blog summaries.

### Step 2: Launch 3 Agents in Parallel (1 per angle)

**SINGLE message with 3 Task calls:**

```typescript
Agent({
  subagent_type: "ClaudeResearcher",
  description: "[topic] analysis",
  prompt: "Do ONE search for: [query optimized for depth/analysis]. Tag each finding with confidence: [HIGH], [MED], or [LOW]. Return findings immediately."
})

Agent({
  subagent_type: "ClaudeResearcher",
  description: "[topic] perspectives",
  prompt: "Do ONE search for: [query optimized for breadth/perspectives]. Tag each finding with confidence: [HIGH], [MED], or [LOW]. Return findings immediately."
})

Agent({
  subagent_type: "ClaudeResearcher",
  description: "[topic] current state",
  prompt: "Do ONE search for: [query optimized for live-web current state with citations]. Tag each finding with confidence: [HIGH], [MED], or [LOW]. Return findings immediately."
})
```

**Each agent:**
- Gets ONE query
- Does ONE search
- Returns immediately

### Step 3: Cross-Check Synthesis

Combine the three angles **with confidence scoring and conflict detection:**

1. **Cross-reference findings:** Where two or more agents report the same fact → tag `[HIGH]`
2. **Flag unique findings:** Findings from only one agent → tag `[MED]`
3. **Detect contradictions:** Where agents disagree → tag `[CONFLICT]` with both sides
4. **Quantitative check:** Any number cited by one agent — did another agent's sources confirm it?

This adds ~2-3 seconds to synthesis (reading all results with conflict lens) — well within the <5s budget.

### Step 4: Parallel URL Verification

Agents now self-verify URLs before returning. For any remaining unverified URLs, batch-verify in parallel:

```bash
# Parallel URL check (not sequential)
for url in "${urls[@]}"; do curl -s -o /dev/null -w "%{http_code} $url\n" -L "$url" & done; wait
```

**If URL fails:** Remove it. If the finding was `[HIGH]` based on cross-reference, downgrade to `[MED]`.

### Step 5: Return Results

```markdown
📋 SUMMARY: Research on [topic]
🔍 ANALYSIS: [Key findings with confidence tags: [HIGH] [MED] [LOW] [CONFLICT]]
⚡ ACTIONS: 3 researchers × 1 query each + cross-check synthesis
✅ RESULTS: [Synthesized answer]
📊 STATUS: Standard mode - 3 agents, cross-checked
📁 CAPTURE: [Key verified facts]
➡️ NEXT: [Suggest extensive if CONFLICT items need resolution]
📖 STORY EXPLANATION: [5-8 numbered points]
🎯 COMPLETED: Research on [topic] complete
```

## Speed Target

~15-30 seconds for results
