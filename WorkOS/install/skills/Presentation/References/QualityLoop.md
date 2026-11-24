# Quality loop

Nothing this skill makes reaches the speaker as a first draft. WorkOS has no ArtDirection critique panel (upstream judges slides with it), so the loop is the code checks plus my own look at the rendered slides.

- **Code checks, always.** `Build.ts --check` for a lecture script, `DeckCheck.ts <deck-dir>` for any HTML deck. Both exit 0 before hand-over.
- **Pixel review, where a browser is available.** Serve the deck, capture every slide with Interceptor `--pixel` into `<talk folder>/deck-png/`, and read each PNG. Judge each slide against `../DesignSystem.md` and the intent's Ideal State: balance, one claim, nothing crowding the title, no large empty band, real things shown as themselves. Fix the named defects and capture again until the slides pass or the shortfall is reported. Run `DeckCheck.ts --live` on the served deck in the same pass.
- **Headless sandbox.** With no browser, the code checks are the evidence and they are labelled as not a browser check. The visual pass is deferred and the hand-back says so, naming what the principal should look at when they open the deck.

An HTML deck is served, not copied, so its hand-over is the URL (or the deck directory, when the server runs where the principal cannot reach it) once the checks pass.
