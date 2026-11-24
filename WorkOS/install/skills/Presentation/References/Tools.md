# Tools

Which tool checks what. Each intent's Tool contract shows the flags that intent uses.

- Lecture script: `Tools/Build.ts`. Run `--check` to validate, `--text` to print the read-through as Markdown (one sentence per paragraph, `---` between slides), `--serve` to serve the deck locally, and `--self-test` to check the tool itself.
- Deck-mode gate: `Tools/DeckCheck.ts <deck-dir>` (real things, one press per slide, video autoplay, missing images), plus `--live <url>` for live layout where Interceptor and a browser are available.
- Real-things registry: `Tools/RealThings.ts --list` (every registered thing and whether its picture exists).
- Server: `Tools/Present.ts --dir <deck-dir>` (F fullscreen, S speaker view, E in-place edit, `?print-pdf`)

Upstream also ships a Keynote builder and its art, media, layout and autoplay tools; WorkOS leaves them out because they need macOS Keynote, ImageMagick, ffmpeg and web egress.
