# Source Routing Protocol

**Read this before spawning agents.** The right source has the answer; the right agent only fetches it. Mismatched source-to-question is the #1 cause of research failures in this skill.

## The Core Rule

**Web search answers "what was published about X." Community APIs answer "what people said about X."** Press articles invent consensus, fabricate timestamps, and miss the loudest fan reactions. If the question is about sentiment, ratings, reactions, opinions, or what real people thought — you do not want web search alone. You want the platforms where those people actually posted, queried via the most-direct path available.

## Cascade Priority (NEVER INVERT)

For every platform you reach, walk the cascade in order. Move down only when the upper tier is unavailable or fails:

**Tier 1 — Official API.** Highest signal, stable schema, terms-of-service compliant, often free at research volume. Always check first.

**Tier 2 — Scraper (Apify / BrightData).** Use only when no API key is configured, when API rate-limits exhaust, when the platform offers no public API (TikTok), or when API doesn't expose the data shape needed (e.g., full comment threads on some platforms).

**Tier 3 — Web search (ClaudeResearcher / WebSearch).** Last resort for sentiment. Useful only to scaffold context — dates, lineup, version numbers — never to answer "what did fans think." Web search reads press coverage; press coverage is not the community.

**The inversion is the failure mode.** Reaching for Apify before checking for an official API key, or reaching for web search before either, wastes budget and degrades signal.

## Per-Platform Cascade

| Platform | Tier 1 (API) | Tier 2 (Scraper) | Tier 3 (Web search) |
|----------|--------------|------------------|---------------------|
| **Reddit** | JSON API (free, unauth, public — append `.json` to any URL) | Apify `trudax/reddit-scraper-lite` or `apify/reddit-scraper` | `site:reddit.com` via WebSearch |
| **X / Twitter** | (no API tier in this fork) | Apify `apidojo/tweet-scraper` | `site:x.com` via WebSearch |
| **YouTube** | (no API tier) | `fabric -y URL` for transcripts; Apify `streamers/youtube-scraper` for comments | `site:youtube.com` |
| **TikTok** | (no public API) | Apify `clockworks/tiktok-scraper` | `site:tiktok.com` |
| **Bluesky** | AT Protocol public API (`api.bsky.app/xrpc/app.bsky.feed.searchPosts`) — no auth required for reads | Apify Bluesky scrapers | `site:bsky.app` |

## Technical Signal Detection (run at Step 0, alongside the sentiment check)

The question is a **technical question** if it is about code, APIs, frameworks, libraries, runtimes, protocols, tooling, versions, migration paths, or "how does <system> actually work under the hood."

If it fires → **add a primary-sources ClaudeResearcher slot.** A wrong API contract or a hallucinated flag is exactly the failure mode several same-model passes agree on, so this slot reads only primary sources and quotes them.

```typescript
Agent({
  subagent_type: "ClaudeResearcher",
  description: "[topic] technical",
  prompt: "Do ONE technical search for: [query]. Use primary sources ONLY — official docs, source, changelogs, RFCs; quote the exact line for every version number, flag, or API contract. Tag each finding [HIGH]/[MED]/[LOW]. Return findings immediately."
})
```

Non-technical questions do not spawn this slot — it is not a fourth generalist.

## Sentiment Signal Detection (run at Step 0 of every workflow)

The question is a **community-sentiment question** if it contains any of:

- "what did fans / people / the community / users / viewers / listeners / players / attendees think (of|about)"
- "ratings of" / "rated" / "fan ratings" / "user ratings"
- "best / worst / favorite / most disappointing / standout (sets|episodes|moments|games|features|takes)"
- "reactions to" / "reaction to" / "reaction videos"
- "what people are saying about"
- "is X any good" / "is X worth it" — purchase / consumption decision driven by social proof
- "consensus on" / "popular opinion of"
- Event name + ("last night" | "last weekend" | "yesterday" | recent date) — recent-event recap with implied "how was it"

If any signal fires → **sentiment-mode routing.** Otherwise → standard routing.

## Sentiment-Mode Routing — Platform Priority

Spend agent slots across platforms in this order, walking the Tier-1 → Tier-3 cascade *inside each platform*:

1. **Reddit (always first).** Where most English-language fandoms post raw reactions. Tier-1 path is the free JSON API.
2. **X / Twitter.** Fastest reaction window (first 6 hours post-event). No API tier here: Apify `apidojo/tweet-scraper` is the primary path.
3. **YouTube** — reactor channels and comment sections, especially for events / launches. No API tier: `fabric -y` for transcripts + Apify for comments.
4. **TikTok** — viral-moment signal (which clips got reshared most). No public API → Apify is the primary path here.
5. **Platform-native communities** — Steam reviews, subject-specific forums. Hit when relevant.
6. **Web search (last, context only)** — dates, lineup, version numbers. Never for sentiment.

The order is hierarchy *and* fallback. Inside each platform, walk Tier 1 → 2 → 3 before moving to the next platform.

## Reddit — Tier 1: JSON API (default path)

Reddit's JSON API is free, unauthenticated, public, and stable. It is the official Tier-1 path even though "API" colloquially implies OAuth — Reddit explicitly publishes the `.json` suffix for unauth reads at research volume.

**Endpoints:**
- Subreddit Top this week: `https://www.reddit.com/r/{sub}/top.json?t=week&limit=50`
- Subreddit Top this month: `https://www.reddit.com/r/{sub}/top.json?t=month&limit=50`
- Subreddit search: `https://www.reddit.com/r/{sub}/search.json?q={query}&restrict_sr=1&sort=top&t=month`
- Site-wide search: `https://www.reddit.com/search.json?q={query}&sort=top&t=month`
- Thread + comments: `https://www.reddit.com/r/{sub}/comments/{id}.json`

**Headers:** Set `User-Agent: WorkOS-Research/1.0` (Reddit rate-limits the default). Use `curl -A "WorkOS-Research/1.0" -s` or pass via WebFetch / Bash subagent.

**Subreddit discovery:** if you don't know which sub has the conversation, run a site-wide search first and read the `subreddit` field on returned posts. Common subs cluster by domain — `r/{topic}`, `r/{topic}news`, `r/{topic}circlejerk` for contrarian signal.

**What to pull:**
- Megathreads first (high comment count, broad sample).
- Top posts by upvote count (the upvote is the rating).
- Top comments in each thread (sort by score, not chronological).
- Look for dedicated single-subject threads ("ARTIST_NAME was incredible" → 21 score is a meaningful signal).

**Quoting rule:** Quote verbatim from comments with attribution to the thread URL. Fan quotes are the evidence; paraphrasing them launders the signal.

## Reddit — Tier 2: Apify Scraper (fallback only)

Use this **only** when JSON API rate-limits, returns 403, or you need authenticated reads (private subs, NSFW with auth wall):

```typescript
mcp__Apify__search-actors({ search: "reddit scraper", limit: 5 })
// Typical hit: trudax/reddit-scraper-lite or apify/reddit-scraper
mcp__Apify__call-actor({
  actor: "trudax/reddit-scraper-lite",
  step: "call",
  input: { startUrls: ["https://www.reddit.com/r/{sub}/top/?t=week"], maxItems: 50 }
})
mcp__Apify__get-actor-output({ datasetId: "{from previous response}" })
```

## YouTube

No API tier — the YouTube Data API is not configured in this install.

**Tier 2 — Scraper.**
- **Transcripts:** `fabric -y https://www.youtube.com/watch?v={id}` pulls captions to stdin.
- **Comments:** Apify `streamers/youtube-scraper`.

**Tier 3 — Web search.** `site:youtube.com {event} reaction` via WebSearch for discovery only.

## X / Twitter

No API tier in this fork (no X credentials).

**Primary — Apify `apidojo/tweet-scraper`.** Reactions in the first 6 hours after an event are the highest-signal cluster.

**Fallback — `site:x.com` web search.** Discovery-only.

## TikTok

Apify `clockworks/tiktok-scraper` for hashtag pulls. Useful when the event spawned a viral clip moment that didn't trend on Reddit.

## Output Format When Sentiment-Routed

When the workflow returns, organize fan signal by **tier of agreement**, not by source:

```markdown
## Tier S — Multiple fans called this their #1
| # | Subject | Evidence |
|---|---------|----------|
| 1 | [name] | [verbatim quote] — [thread URL, score] / [verbatim quote] — [thread URL, score] |

## Tier A — Repeated standouts
...

## Tier C — Disappointments (the inverse signal — equally valuable)
...

## Sources
- Reddit threads pulled (count) — list URLs + scores
- YouTube videos transcribed (count)
- X posts referenced (count)
```

**Always include the inverse signal.** What fans hated is as informative as what they loved, sometimes more.

## Anti-Patterns (do not do these)

- **Cascade inversion.** Reaching for Apify before checking the official API path, or reaching for web search before either. Always API → scraper → search. A documented failure of this skill (a festival-sentiment question, 2026-05) was exactly the inverted cascade — web search ran first, Reddit JSON was never called, Apify wasn't even considered. The corrected second pass pulled Reddit JSON directly; that should have been the first call.
- **Recap-journalism-only on a sentiment question.** Press articles invent timestamps ("Charlotte de Witte closed at 04:14"), fabricate surprise guests ("Garrix × Armin B2B"), and parrot promoter copy. They are wrong about consensus. If a recap-article claim has zero corroboration in the community corpus, drop it.
- **Spawning web-search agents for "what fans thought of X"** when Reddit JSON would have returned the answer in a single curl. Reddit's structure (upvotes, top comments, single-subject threads) is purpose-built for this exact question.
- **Pulling only one sub** when the event has a community footprint across several. EDC has r/electricdaisycarnival, r/EDM, r/aves. Game launches have r/{game}, r/games, r/patientgamers. Always check 2-3 subs.
- **Reporting upvote counts without quoting the comments.** The number means nothing without the text it endorses.
- **Filtering out negative reactions to "balance the review."** Report the actual signal. Tier C exists precisely because it's the truest part.

## Quick Reference

| Question shape | First call (always Tier 1) |
|----------------|-----------------------------|
| "what did fans think of X" | Reddit JSON: `r/{topic}/top.json?t=week` |
| "best sets at {festival}" | Reddit JSON site-wide search: `q={festival}&sort=top` |
| "is {product} any good" | Reddit JSON: `r/{product}/top.json?t=month` |
| "reactions to {event}" | `fabric -y` on top reactor videos, plus Reddit JSON |
| "what's the consensus on X" | Reddit JSON + Apify `apidojo/tweet-scraper` |
| "what are people saying right now" | Reddit JSON + Apify `apidojo/tweet-scraper` (real-time signal) |
