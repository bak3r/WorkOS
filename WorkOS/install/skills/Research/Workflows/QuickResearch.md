# Quick Research Workflow

**Mode:** Single ClaudeResearcher, 1 query | **Timeout:** 30 seconds

## When to Use

- User says "quick research" or "minor research"
- Simple, straightforward queries
- Time-sensitive requests
- Just need a fast answer

## Workflow

### Step 0: Source Routing Check (MANDATORY)

**READ:** `../SourceRoutingProtocol.md` if not already loaded.

Scan the user's request for sentiment signals: "fans thought", "ratings of", "best | worst | favorite", "reactions to", "what people are saying", "consensus on", event + recent date.

- **Signal fires → sentiment-mode.** Skip Step 1 (web search). Instead, single-call to Reddit JSON API at the most relevant subreddit + sort: `curl -A "WorkOS-Research/1.0" -s "https://www.reddit.com/r/{sub}/top.json?t=week&limit=25"` (or site-wide search if sub is unknown). Parse top 10 posts, pull comments on the highest-signal thread, return verbatim fan quotes with thread URLs and scores. Use Apify Reddit actor as fallback only if JSON fails.
- **No signal → Step 1 (web search).** Standard quick lookup.

### Step 1: Launch Single Researcher Agent

**ONE Task call - ClaudeResearcher with a single focused query:**

```typescript
Agent({
  subagent_type: "ClaudeResearcher",
  description: "[topic] quick lookup",
  prompt: "Do ONE web search for: [query]. Tag each finding with confidence: [HIGH], [MED], or [LOW]. Return the key findings immediately. Keep it brief and factual."
})
```

**Prompt requirements:**
- Single, well-crafted query
- Instruct to return immediately after first search
- No multi-query exploration

**Why one agent:** a single focused WebSearch is the fastest path for "just tell me what's current"; the URL-verification rule still applies to every link it returns.

### Step 2: Return Results

Report findings using standard format:

```markdown
📋 SUMMARY: Quick research on [topic]
🔍 ANALYSIS: [Key findings from the researcher]
⚡ ACTIONS: 1 ClaudeResearcher query
✅ RESULTS: [Answer]
📊 STATUS: Quick mode - 1 agent, 1 query
📁 CAPTURE: [Key facts]
➡️ NEXT: [Suggest standard research if more depth needed]
📖 STORY EXPLANATION: [3-5 numbered points - keep brief]
🎯 COMPLETED: Quick answer on [topic]
```

## Speed Target

~10-15 seconds for results
