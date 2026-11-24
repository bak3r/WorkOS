---
name: Presentation
metadata:
  short-description: "Makes talks and slide decks, either a read-aloud HTML lecture or a cue-card HTML deck served with speaker view, and sales pitches from product docs."
version: 1.3.1
description: "Makes talks, slide decks and sales pitches: a read-aloud HTML lecture, a cue-card HTML deck, or a pitch from product docs (value story, talking points, elevator pitch). USE WHEN presentation, make me a deck, slides, slide deck, present on, give a talk on, speaker notes, present this, serve the deck, presenter mode, lecture, read-aloud talk, script for a talk, turn this essay or dictation into a talk, rebuild the deck, I edited the script, real book cover, real screenshot, too much white space, image too small, sales pitch, sales narrative, sales deck, pitch deck, sales package, sales script, sales materials, product pitch, create a sales story, elevator pitch, value proposition, turn this into a pitch. NOT FOR standalone diagrams or charts (Art), web UI design (Webdesign), Keynote or PPTX files (not in WorkOS)."
evals:
  deterministic:
    - command: "bun skills/Presentation/Tools/Build.ts --self-test"
      falsifier: "exits nonzero when a slide with 0 or 6+ sentences, two sentences on one line, a sentence over 20 words, or an unknown TYPE passes validation, or when notes stop rendering one spaced paragraph per sentence, or when an art slide's CITE stops rendering as the bottom-left source line or pictures lose their 12 px rounded corners"
    - command: "bun skills/Presentation/Tools/RealThings.ts --self-test"
      falsifier: "exits nonzero when a slide whose sentences name a registered real thing keeps generated art instead of the registered picture, when a stage note in parentheses triggers it, or when a second pass changes anything"
    - command: "bun skills/Presentation/Tools/DeckCheck.ts --self-test"
      falsifier: "exits nonzero when a deck slide naming a registered real thing without its picture, a fragment build, a video without data-autoplay, a missing image, a thumbnail picture, a picture over text, overflow or a large empty band passes, or when a clean balanced slide is flagged"
  manual:
    reason: "whether the talk sounds like the speaker and the visuals support it needs the speaker presenting the rendered deck; the speaker view needs a real S keypress"
    falsifier: "the speaker stumbles reading a slide's notes aloud, a visual pulls attention away from what is being said, or a deck-mode slide carries more than one claim"
---

# Presentation

**Contents:** Ideal State · Intent Routing · Data & Config · Gotchas · Examples

Talks, the slides behind them, and sales pitches, in three modes. Ported from upstream 8.761.0 with the HTML path only: WorkOS runs in a Linux sandbox with no Keynote, no image generation and no web egress, so upstream's Keynote, generated-art and media-sourcing lanes are left out.

- **Lecture mode** is a talk the speaker reads aloud from start to finish. The text is the content and the slides are there for pacing: a new slide every 15 to 30 seconds keeps the room watching, and each visual either supports the sentence being read or stays quiet. The source is a talk file (`SCRIPT.md`); the HTML deck is regenerated from it.
- **Deck mode** is a deck where the slides carry the argument and the speaker glances at short cues. One claim per slide, the archetype chosen from the content, built as an HTML deck on the install's template and served with speaker view.
- **Pitch mode** turns product documentation into a sales pitch: a first-person value story a buyer can retell, talking points and an elevator pitch (`Intents/Pitch.md`, which absorbed the retired Sales skill).

Pick lecture mode when the speaker says they will read it, or hands over a talk file or dictation to turn into a talk. Pick deck mode for "make me a deck on X". Pick pitch mode for a sales pitch, narrative or package. When it is unclear, ask once.

## Ideal State

- Every talk has an ISA before its slides do. Its L3 names what the audience believes or does by the end, its criteria hold the time budget (spoken words at about 135 per minute, slide count) and the arc, and every cut, move or added slide traces to L3. A change of thesis updates the ISA first, then the order and the script.
- The speaker gets a deck they can present from: in lecture mode the notes are the talk file word for word, in deck mode every slide carries one claim and glanceable notes, and the talk file or script stays the one source the deck is rebuilt from.
- Everything real the talk names is on screen as itself: the speaker's registered things (`RealThings.json`) with their registered picture, anything else from a picture the speaker supplied. Every outside picture has 12 px rounded corners and its credit (site, publisher, owner) in the small bottom-left source line, never the subtitle.
- A visual appears only where it carries something words cannot, and every number on a chart was verified this session or its source line says "illustrative". In lecture mode, on-slide text is a few words that echo the line being read, and where a visual adds nothing a plain text slide is right.
- Every slide passes the checks in code (`Build.ts --check`, `DeckCheck.ts`) and, where a browser is available, was looked at as rendered pixels; where none is, the hand-back says the visual pass is still owed.
- A pitch tells one value story a buyer can retell, every product claim traced to a line in the source docs, with no feature-list sentence (`Intents/Pitch.md`).
- No deck reaches the speaker as a first draft: it went through `References/QualityLoop.md` and arrives as a served URL with the human-only keys stated.

## Intent Routing

| Mode | Intent | Trigger | File |
|------|----------|---------|------|
| Lecture | **Write** | "write a lecture on X", "turn this dictation/essay/talk into a lecture", "convert my deck to a lecture" | `Intents/Write.md` |
| Lecture | **Build** | "sync the lecture", "rebuild the deck", "I edited the script", "present the lecture" | `Intents/Build.md` |
| Deck | **CreateDeck** | "make me a deck on X", "slides for my talk" | `Intents/CreateDeck.md` |
| Both | **Present** | "serve the deck", "present it", "presenter mode" | `Intents/Present.md` |
| Pitch | **Pitch** | "sales pitch", "sales narrative", "elevator pitch", "value proposition", "turn this into a pitch", "create a sales package", "sales script", "sales materials", "product pitch", "create a sales story", "sales deck" or "pitch deck" (the pitch first, then CreateDeck when slides are wanted) | `Intents/Pitch.md` |

| File | Read when |
|------|-----------|
| `References/TalkFiles.md` | reading, writing or rebuilding from a talk file (SCRIPT.md, a speaker's Markdown): how its lines become talking points, titles and notes |
| `References/QualityLoop.md` | before any deck goes to the speaker: the code checks and the pixel review |
| `References/HtmlDecks.md` | building, capturing or serving an HTML deck (Build, CreateDeck, Present) |
| `References/Tools.md` | which tool checks what, or a tool no intent shows |
| `ScriptFormat.md` | writing or validating a lecture SCRIPT.md: its fields and slide types |
| `DesignSystem.md` | authoring a deck-mode slide: the default tokens and type, the nine archetypes and how to choose; an install's own `DesignSystem.md` in the customization dir overrides its brand sections |
| `Setup.md` | first-time setup: the deck template, the real-things registry, and serving from a sandbox |

## Data & Config

Before running, check `<configRoot>/WORKOS/USER/CUSTOMIZATIONS/SKILLS/Presentation/` (`configRoot` is `$CLAUDE_CONFIG_DIR`, else `~/.claude`). What can live there:

- `PREFERENCES.md`: template, theme, where talks live, where the speaker's own material is, and the quality gates this install requires. It overrides the defaults here.
- `DesignSystem.md`: the install's own slide register (tokens, type roles, footer band, signature elements), read in place of those sections of the skill's default `DesignSystem.md`.
- `Config.md`: the presenter's byline, site, handle and organisation for deck credits, and paths to their own written material.
- `Template/`: the HTML deck template (`deck.html` exemplar, `theme.css`, fonts, a vendored reveal.js with the notes plugin and `editor.js`, brand images). Fonts in a template are often licensed for one person, which is why the template lives here and never in the skill.
- `RealThings.json`: the speaker's own real things (a book, a product, a site) with the one true picture of each; see `Tools/RealThings.ts`.

First-time setup for these files is in [Setup.md](Setup.md).

## Gotchas

- **A sentence that names a real product, site or person is a picture ask even without a `>` direction.** With no registered or supplied picture, the slide says what is missing rather than drawing a stand-in.
- **A reference deck put a drawn book where the real cover belonged** (upstream, 2026-10-02): the slide naming the speaker's own book carried an illustration of an open book. Registered real things are enforced in code on every build.
- **A deck served inside a Docker sandbox is not reachable from the host by default.** `Present.ts` binds the sandbox's own `127.0.0.1`; publish the port or copy the deck out (`Setup.md`).
- Mode-specific gotchas: HTML decks in `References/HtmlDecks.md`, lecture writing in `Intents/Write.md` § Gotchas.

## Examples

**Example 1: Dictation to lecture**
```
User: "Turn these notes from yesterday's design review into a 20-minute talk"
→ Write: drafts SCRIPT.md in the speaker's own words,
  ~60 slides, each with READ lines, visuals chosen where they help
→ Build.ts --check passes; deck built; quality loop run
→ Returns the deck URL, word count and minutes, and which slides have diagrams
```

**Example 2: A cue-card deck from an idea**
```
User: "Make me a deck on why prompt injection is the new SQL injection"
→ CreateDeck: pulls the speaker's prior lines, drafts the arc, picks an archetype
  per slide, writes glance notes, assembles from the install Template/, runs DeckCheck,
  serves it with Present
→ Returns the URL and the keys (F fullscreen, S speaker view, ?print-pdf)
```

**Example 3: A pitch from product docs**
```
User: "turn this feature spec into a sales pitch"
→ Pitch: 24-point story, then the first-person narrative, talking points, elevator pitch
```
