---
name: DetectAI
version: 1.1.2
description: "Detects AI-generated writing three ways — a heuristic audit against a catalog of known AI patterns, deterministic statistical signals (n-gram entropy, burstiness, repetition, stylometry — features never verdicts), and a keyless scan for watermark and steganography signatures (invisible characters, homoglyphs, bidi, odd whitespace) in the bytes. USE WHEN detect AI writing, is this AI, AI detection, AI detector, did an AI write this, does this sound like AI, scan for AI tells, flag AI patterns, AI-isms, statistical AI signals, burstiness, text entropy, is this watermarked, detect watermark, steganography, zero-width chars, hidden characters, invisible unicode, compare drafts for AI-ness. NOT FOR rewriting prose to strip AI patterns (use a voice/authoring skill), plagiarism detection, detecting AI-generated images/video/code, or judging whether writing is any good."
---

# DetectAI

## What It Does

Answers two questions — *how much does this read as machine-generated?* and *does it carry an embedded mark?* — with three independent measures:

- **Heuristic audit.** Flags known AI tells (inflated vocabulary, the "not X, it's Y" tic, recycled transitions, uniform rhythm) against a severity-tiered pattern catalog. Free, instant, and it explains *why* each flag fired.
- **Statistical signals.** A deterministic pass (`WORKOS/TOOLS/StatSignals.ts`) measuring the keyless distributional tells the research literature rates real: n-gram entropy, type-token ratio, repetition structure — plus the weak-alone folklore tier (burstiness, paragraph uniformity, function-word stylometry), each labeled with its reliability. Features, never verdicts (arXiv:2310.15264: paraphrase degrades every keyless statistic). Free, no key.
- **Watermark scan.** A keyless, deterministic pass for character-level covert channels — invisible chars, variation-selector/Tags-block steganography, homoglyphs, bidi, odd whitespace. Catches embedded marks that live in the bytes; by design it *cannot* read sampling-time statistical watermarks (SynthID, Kirchenbauer, Anthropic's announced mark), which are key-gated. Free, no key.

The measures disagree often, and that disagreement is the useful part. Text can clear every pattern on the list and still show flat rhythm and low entropy, which tells you the tells are structural, not lexical — and a watermark hit is bytes-level proof regardless of what the other two say.

## The Problem

"Does this sound like AI?" gets answered by vibes, and vibes are wrong in both directions. Heuristic word-lists flag legitimate writing and miss AI text that avoided the obvious words. Distributional statistics catch structure the word list misses, but no keyless statistic is a verdict on its own.

This skill runs the measures side by side, and compares against known-human writing so the numbers have something to be read against.

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **Detect** | "scan for AI tells", "flag AI patterns", "does this sound like AI", "audit this for AI-isms", "statistical signals", "burstiness", "entropy" — heuristic + deterministic statistical pass, no key needed | `Workflows/Detect.md` |
| **Watermark** | "is this watermarked", "detect a watermark", "scan for hidden/invisible characters", "steganography", "zero-width chars" — keyless byte-level signature scan, no key needed | `Workflows/Watermark.md` |

Asked simply "is this AI?", run Detect and report the heuristic flags and statistical signals side by side. "Is this watermarked?" routes to Watermark, which answers a different question: whether a covert channel is embedded in the bytes, not whether the prose reads as AI.

## Gotchas

- **Short samples are unreliable.** Every measure is weakest under ~5 sentences; StatSignals flags itself unreliable under ~100 words. Audit passages of a few hundred words or don't bother.
- **A signal without a baseline says little.** Run known-human writing of the same genre and length through the same pass. The A-vs-B comparison is the trustworthy part.
- **It measures detectability, not quality.** Reading human does not mean reading well.
- **No keyless measure is ground truth.** Report findings as signals, never a verdict — and never accuse a person of AI authorship on them.
- **Never degrade writing to beat a detector.** Injected typos, broken sentences, and "humanizer" laundering damage the prose and don't fix the underlying problem. If text must read human, the fix is a human in the loop.

## Examples

- "Scan this post for AI tells, don't change it" → **Detect**: tiered P0/P1/P2 flag report, each marked clear-problem vs judgment-call, no edits.
- "Is this AI generated?" → **Detect**: heuristic flags plus statistical signals, with the length caveat stated if the sample is short.
- "Which of these three drafts reads most human?" → **Detect** on each draft, ranked side by side, relative comparison foregrounded over absolute numbers.
- "Did my rewrite actually help?" → **Detect** before and after, with known-human passages run through the same pass as calibration.

## Execution Log

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","skill":"DetectAI","workflow":"WORKFLOW_USED","input":"8_WORD_SUMMARY","status":"ok|error","duration_s":SECONDS}' >> ~/.claude/WORKOS/MEMORY/SKILLS/execution.jsonl
```
