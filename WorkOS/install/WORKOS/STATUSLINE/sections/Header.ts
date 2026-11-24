import { BAND, BOLD, C, WORKOS_LOGO, RESET, band, separator } from "../Ansi";
import { icon } from "../Glyphs";
import type { State } from "../State";
import { cellWidth, fit } from "../Width";

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Words of `text` that fit `width` cells, closed with an ellipsis when any were dropped; a cut mid-word only when the
 * first word alone is too wide, and then by terminal cells and whole graphemes, so a double-width label never runs
 * past `width` (the ellipsis alone when not even one grapheme fits).
 */
export function wordsToFit(text: string, width: number): string {
  if (cellWidth(text) <= width) return text;
  let out = "";
  for (const word of text.split(" ")) {
    const next = out ? `${out} ${word}` : word;
    if (cellWidth(next) + 1 > width) break;
    out = next;
  }
  if (out) return `${out}…`;
  let cut = "";
  for (const { segment } of GRAPHEMES.segment(text)) {
    if (cellWidth(cut + segment) + 1 > width) break;
    cut += segment;
  }
  return `${cut}…`;
}

/** Visible cells of a chip string. */
const chipCells = (ansi: string): number => cellWidth(ansi.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""));

/**
 * The SESSION band, fullest first: tab title and session name, then the session name alone (the tab title is dropped
 * outright when the session name already says it), then the shorter of the two, then the session name cut at a word.
 * The session-mode chips ride at the end of every form: the full chips on every uncut form first, then the short chips,
 * then the name cut at a word to leave room for them.
 */
export function sessionForms(state: State, width: number): string[] {
  if (!state.sessionLabel) return [];
  const upper = state.sessionLabel.toUpperCase();
  const tab = state.tabLabel && !upper.includes(state.tabLabel.toUpperCase()) ? state.tabLabel : "";
  const s = (text: string): string => `${C.session}${text}${RESET}`;
  const base = tab ? [`${BOLD}${C.session}${tab}${RESET}${C.session} · ${upper}${RESET}`, s(upper)] : [s(upper)];
  if (tab && cellWidth(tab) < cellWidth(upper)) base.push(`${BOLD}${C.session}${tab}${RESET}`);
  const full = state.ultracode, short = state.ultracodeShort || full;
  const forms = full
    ? [...base.map(f => f + full), ...base.map(f => f + short), ...(width - chipCells(full) >= 12 ? [s(wordsToFit(upper, width - chipCells(full))) + full] : []), s(wordsToFit(upper, Math.max(2, width - chipCells(short)))) + short]
    : [...base, s(wordsToFit(upper, width))];
  const label = `${icon("session")}${C.slate400}SESSION:${RESET} `;
  return [label + forms[0], ...forms];
}

/** The name with the staircase mark in front. */
const NAME = `${WORKOS_LOGO} ${BOLD}${C.blue}WorkOS${RESET}`;
/** The name alone, for a pane too narrow to carry the mark. */
const BARE = `${BOLD}${C.blue}WorkOS${RESET}`;

/** The top row: the name, the version, the mode chips when there is no SESSION line, the clock and the project folder. */
export function renderHeader(state: State): string {
  const { geometry: g, clock, versions } = state;
  // The mode chips sit on the SESSION line when there is one, and on this row otherwise.
  const onHeader = !state.sessionLabel;
  const uc = { ansi: onHeader ? state.ultracode : "", short: onHeader ? state.ultracodeShort || state.ultracode : "" };
  // Last resort with chips on: the bare name and the short chips, no clock, so the chips still show in a tiny pane.
  const chipsOnly = uc.short ? [`${BARE}${uc.short}`, uc.short.trimStart()] : [];
  const version = versions.workos && versions.workos !== "—" ? ` ${C.blue}${versions.workos}${RESET}` : "";
  const dir = state.dirName && state.dirName !== "." ? `${C.region}${state.dirName}${RESET}` : "";
  const line = (o: { version: boolean; dir: boolean; mark?: boolean; chips?: string }): string => {
    const parts = [`${C.time}${clock}${RESET}`, o.dir ? dir : ""].filter(Boolean);
    return `${o.mark === false ? BARE : NAME}${o.version ? version : ""}${o.chips ?? uc.ansi} ${C.slate600}│${RESET} ${parts.join("  ")}`;
  };
  if (g.phone) {
    const forms = [line({ version: true, dir: false }), line({ version: false, dir: false }), line({ version: false, dir: false, mark: false })];
    const shortForms = uc.short ? [line({ version: false, dir: false, chips: uc.short }), line({ version: false, dir: false, mark: false, chips: uc.short })] : [];
    return `${fit(g.content, ...forms, ...shortForms, ...chipsOnly)}\n`;
  }
  // Fullest form first; a narrower pane drops the folder, then the version, then the mark.
  const left = fit(g.content,
    line({ version: true, dir: true }),
    line({ version: true, dir: false }),
    line({ version: false, dir: false }),
    line({ version: false, dir: false, mark: false }),
    ...(uc.short ? [line({ version: false, dir: false, chips: uc.short }), line({ version: false, dir: false, mark: false, chips: uc.short })] : []),
    ...chipsOnly);
  const fill = g.content - cellWidth(left) - 1;
  const rule = (n: number): string => `${C.slate600}${"─".repeat(n)}${RESET}`;
  // Centered, the rule splits around the text so the name sits in the middle; left-aligned, it trails the text.
  const sides = fill - 1;
  let out = g.density < 2 || fill < 3 ? `${left}\n`
    : g.centered && sides >= 4 ? `${rule(Math.trunc(sides / 2))} ${left} ${rule(sides - Math.trunc(sides / 2))}\n`
    : `${left} ${rule(fill)}\n`;
  const session = sessionForms(state, g.content);
  // A faint dotted rule, dimmer than every other rule on the bar, sets the session band off from the top line.
  if (session.length && g.density >= 2) out += `${C.slate700}${"┈".repeat(g.content)}${RESET}\n`;
  if (session.length) out += band(fit(g.content, ...session), g.content, BAND.session) + "\n";
  return out + separator(g.content, g.density, "┄");
}
