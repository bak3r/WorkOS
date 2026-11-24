# Presentation

Status: bun ~/.claude/skills/Presentation/Tools/RealThings.ts --list · optional

## What it does

The presentation skill makes talks, decks and sales pitches. In lecture mode it turns a talk file (`SCRIPT.md`, or your Markdown turned into one) into HTML slides whose speaker notes are the talk word for word. In deck mode it builds a cue-card HTML deck on your own template and serves it with speaker view. In pitch mode it turns product docs into a value story and talking points. A lecture rendered to a plain HTML deck and all of pitch mode need nothing. The pieces below unlock deck mode and the real-picture rule.

## Fill in

Everything lives under `WORKOS/USER/CUSTOMIZATIONS/SKILLS/Presentation/` in your config root (`$CLAUDE_CONFIG_DIR`, else `~/.claude`). All of it is optional, and each piece unlocks one lane.

**1. Template/** for deck mode. A folder holding your deck markup and assets: `deck.html` (the canonical markup for the nine slide types, with the `<!-- SLIDES:START -->` and `<!-- SLIDES:END -->` markers the editor saves between), `theme.css`, `fonts/`, `images/`, and `vendor/` with your own copy of reveal.js, its notes plugin and `editor.js`, so the deck works offline. Fonts in a template are often licensed to one person, which is why the template lives here and never in the skill. Without a template, lecture mode still renders a plain deck that loads reveal.js from a CDN when it is opened in a browser that can reach one.

**2. RealThings.json** for things you name in a talk that should always show their real picture. A made-up example:

```json
{
  "things": [
    { "name": "Example Handbook",
      "aliases": ["the handbook"],
      "image": "real/example-handbook-cover.png",
      "what": "book cover" }
  ]
}
```

`image` is relative to the JSON file and the file must exist, or loading fails with a clear error. A missing registry is just an empty one.

**3. PREFERENCES.md and Config.md**, plain markdown. Preferences hold your template, theme, the browser that opens a served deck (the system default when unset), where talks live and which quality gates you require. Config holds the identity printed in deck credits and the paths to your own written material. Its keys:

- `SPEAKER.NAME`: your name, the byline on the title slide and the name/date line.
- `SPEAKER.SITE`: a site without the scheme, shown on the title and closing slides.
- `SPEAKER.HANDLE`: a handle on the closing slide.
- `SPEAKER.ORG`: the organisation name on the closing slide.
- `SPEAKER.ORG_URL`: the link target for that organisation name.
- `BLOG.POSTS_DIR`: a directory of your own written posts as markdown, so a deck quotes them from disk.
- `BLOG.ART_DIR`: a directory of images that go with those posts, reused before anything new is drawn.

A BLOG key that points at a directory that does not exist means there is none; the deck intent skips that lookup. A made-up example:

```markdown
# Presentation config

- `SPEAKER.NAME`: Alex Example
- `SPEAKER.SITE`: example.com
- `SPEAKER.ORG`: Example Labs
- `SPEAKER.ORG_URL`: https://example.com
```

## Accounts and secrets

No keys go in `~/.claude/.env` for this skill.

- Diagrams on slides come from the Art skill (Mermaid). WorkOS has no image generation; pictures are ones you supply.
- Deck-mode live layout checks (`DeckCheck.ts --live`) measure slides in a real browser through the Interceptor skill, which needs Google Chrome. In a headless sandbox the static check runs and the visual pass is left to you.
- Serving a deck is local only: `Tools/Present.ts` binds `127.0.0.1` on port 7345. Inside a Docker sandbox that address is the sandbox's own, so open the deck from the host through a published port, or copy the deck directory to the host and run the same command there.

## Prove it works

```bash
bun ~/.claude/skills/Presentation/Tools/RealThings.ts --list
bun ~/.claude/skills/Presentation/Tools/Build.ts --self-test
ls ~/.claude/WORKOS/USER/CUSTOMIZATIONS/SKILLS/Presentation/Template
```

`RealThings.ts --list` prints each registered thing with the path of its picture, or `no real things registered` followed by the registry path when you have none, and exits 0 either way; a registered picture that is missing is an error naming the file. `Build.ts --self-test` is read-only and should end with `all passed`. The `ls` should show `deck.html`, `theme.css`, `fonts`, `images` and `vendor` if you set up deck mode. Then hand your assistant a short script and ask for a deck; success is a deck whose speaker notes are your sentences unchanged.
