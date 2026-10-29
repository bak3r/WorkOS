/**
 * Glyphs.ts — the status line's symbols: Nerd Font glyphs, each in a colour that means something.
 *
 * Upstream LifeOS keeps this table in hooks/lib/glyph-core.ts so its plugin mods can carry byte-identical copies.
 * WorkOS has no mods, so the table lives here, beside the only code that draws it, and the statusline directory is
 * self-contained. Two ways in:
 * - `icon(name)` for a section that draws a symbol itself.
 * - `glyphify(frame)`, run once by Frame.finish, for emoji that arrive as text (the ⚡ in the ULTRACODE chip).
 *
 * Width parity is the whole contract. An emoji takes two cells; a glyph plus a space takes two, and terminals draw a
 * private-use glyph followed by a space across both cells. Every glyph sits below U+1F000, because `pictographCells`
 * counts everything from U+1F000 as two cells.
 */
const RESET = "\x1b[0m";

interface Glyph { glyph: string; color: string }

const hex = (h: string): string => {
  const n = Number.parseInt(h.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
};
const g = (cp: number, color: string): Glyph => ({ glyph: String.fromCodePoint(cp), color: hex(color) });

/** Name → symbol and colour. Codes are nf-fa (U+F0xx–F2xx), present in every Nerd Font build. */
export const GLYPHS = {
  session: g(0xf120, "#7dcfff"), state: g(0xf21e, "#73daca"), models: g(0xf2db, "#bb9af7"), context: g(0xf1c0, "#7aa2f7"),
  // The WORK row: tasks list, fire for P0/P1, play for active work.
  work: g(0xf0ae, "#ff9e64"), hot: g(0xf06d, "#ef4444"), active: g(0xf04b, "#9ece6a"),
  bolt: g(0xf0e7, "#e0af68"),
} as const satisfies Record<string, Glyph>;

export type GlyphName = keyof typeof GLYPHS;

/** A symbol in its colour with the space that gives it its second cell. The caller's own colour follows. */
export function icon(name: GlyphName): string {
  const { glyph, color } = GLYPHS[name];
  return `${color}${glyph}${RESET} `;
}

/** Emoji the line receives as text, by the symbol that replaces each. */
const EMOJI: Record<string, GlyphName> = { "⚡": "bolt" };

// One token at a time: an SGR sequence, a flag (two regional indicators), or one character with an optional U+FE0F.
const TOKEN = /\x1b\[[0-9;]*m|[\u{1F1E6}-\u{1F1FF}]{2}|[\s\S]️?/gu;
const SGR = /^\x1b\[[0-9;]*m$/;
const isReset = (sgr: string): boolean => sgr === RESET || sgr === "\x1b[m";

/** The symbol for one token, or null to leave it alone. A text-presentation character counts only with U+FE0F. */
function glyphFor(token: string): GlyphName | null {
  if (/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(token)) return null;
  const base = token.replace("️", "");
  const name = EMOJI[base];
  if (!name) return null;
  return token.endsWith("️") || /\p{Emoji_Presentation}/u.test(base) ? name : null;
}

/**
 * Replace every mapped emoji in `text` with its coloured symbol and a space, then put back the colours that were
 * active at that point on the line (everything since its last reset), so a band's tint and the text's colour carry on.
 * Width-neutral by construction. Pure.
 */
export function glyphify(text: string): string {
  return text.split("\n").map((line) => {
    let active: string[] = [];
    let out = "";
    for (const [token] of line.matchAll(TOKEN)) {
      if (SGR.test(token)) {
        active = isReset(token) ? [] : [...active, token];
        out += token;
        continue;
      }
      const name = glyphFor(token);
      if (!name) { out += token; continue; }
      const { glyph, color } = GLYPHS[name];
      out += `${color}${glyph}${RESET}${active.join("")} `;
    }
    return out;
  }).join("\n");
}
