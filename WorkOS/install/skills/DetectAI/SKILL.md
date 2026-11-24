---
name: DetectAI
evals:
  deterministic:
    - command: "printf 'ab\\342\\200\\213cd' | bun WORKOS/TOOLS/WatermarkScan.ts --json | bun -e 'const j = JSON.parse(await Bun.stdin.text()); const hit = j.classes.flatMap(c => c.sample).some(x => x.codepoint === \"U+200B\" && x.index === 2); process.exit(hit ? 0 : 1)'"
      falsifier: "WatermarkScan.ts --json, given a fixture with U+200B at offset 2, reports no hit with that codepoint and offset"
  manual:
    reason: "an AI-writing assessment requires a reviewer to judge whether reported signals support the conclusion for the supplied prose"
    falsifier: "the reviewer finds the verdict overstates the evidence or fails to distinguish heuristic signals from proof"
metadata:
  short-description: "Detect AI writing patterns, statistical signals and hidden watermark characters, all offline. Excludes rewriting, plagiarism, and image detection."
version: 1.2.1
description: "Detects AI-generated writing offline: heuristic audit against known AI patterns, statistical signals (entropy, burstiness), and a keyless scan for watermark or steganography signatures (invisible characters, homoglyphs, bidi). USE WHEN detect AI writing, is this AI, AI detection, AI detector, did an AI write this, does this sound like AI, scan for AI tells, AI-isms, burstiness, text entropy, is this watermarked, hidden characters, zero-width chars. NOT FOR rewriting prose (a writing skill), plagiarism, judging quality, detecting AI images or code."
---

# DetectAI

Answers two questions, *how much does this read as machine-generated?* and *does it carry an embedded mark?*, with three independent measures: a heuristic audit against a severity-tiered pattern catalog, which explains why each flag fired; deterministic statistical signals (`WORKOS/TOOLS/StatSignals.ts`), each labeled with its reliability; and a keyless watermark scan (`WORKOS/TOOLS/WatermarkScan.ts`) for covert channels in the bytes. All three are free, offline and need no key. Upstream adds a fourth, the paid Pangram API score; WorkOS leaves it out because the sandbox has no web egress. The measures disagree often, and the disagreement is the useful part: text can clear every pattern on the list and still show flat rhythm and low entropy, which means the tells are structural rather than lexical, and a watermark hit is bytes-level proof whatever the other measures say.

## Ideal State

- Every answer rests on measures that actually ran (the pattern catalog, `StatSignals.ts`, `WatermarkScan.ts`), and the report names which ran and which did not.
- A plain "is this AI?" gets the heuristic audit and the statistical signals side by side, and where they disagree the report says what the gap means.
- No report treats one signal as proof of authorship: signals carry their length and baseline caveats, and a clean watermark scan is never read as "human-written".
- The text under review is reported on, never rewritten.

## Intent Routing

| Intent | Trigger | File |
|--------|---------|------|
| **Detect** | "is this AI", "scan for AI tells", "flag AI patterns", "does this sound like AI", "audit this for AI-isms", "statistical signals", "burstiness", "entropy", "compare these drafts" | `Intents/Detect.md` |
| **Watermark** | "is this watermarked", "detect a watermark", "scan for hidden/invisible characters", "steganography", "zero-width chars" | `Intents/Watermark.md` |

"Is this watermarked?" routes to Watermark, which answers a different question: whether a covert channel is embedded in the bytes, not whether the prose reads as AI. For "is this AI and is it marked?", run Detect plus Watermark.

## Data & Config

No setup and no key. Both tools ship in `WORKOS/TOOLS/`.

## Gotchas

- **Short samples are unreliable.** Every measure is weakest under about 5 sentences; StatSignals flags itself unreliable under about 100 words. Audit passages of a few hundred words or say the sample is too short.
- **A signal without a baseline says little.** Run known-human writing of the same genre and length through the same pass. The A-vs-B comparison is the trustworthy part.
- **No keyless measure is ground truth.** Report findings as signals, never a verdict, and never accuse a person of AI authorship on them.
- **Never degrade writing to beat a detector.** Injected typos, broken sentences, and "humanizer" laundering damage the prose and don't fix the underlying problem. If text must read human, the fix is a human in the loop.

## Examples

- "Scan this post for AI tells, don't change it" → **Detect**: tiered P0/P1/P2 flag report, each marked clear-problem vs judgment-call, plus the StatSignals features, no edits.
- "Which of these three drafts reads most human?" → **Detect** on each draft and on a known-human passage of the same length, compared side by side.
- "Is there anything hidden in this pasted text?" → **Watermark**: byte-level classes found, with codepoints and offsets.
