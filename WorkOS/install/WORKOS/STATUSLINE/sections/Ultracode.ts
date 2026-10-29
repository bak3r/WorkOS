import { invariant } from "../../TOOLS/Invariant";
import { RESET } from "../Ansi";
import { mtime, readText } from "../Cache";
import type { State } from "../State";

/**
 * Every mode chip is its own tag: a solid background in a hue no other chip and no SESSION text uses. Each tag pads its
 * text with one space a side; the short form keeps the colour but drops the padding, so a narrow pane still fits every chip.
 */
const tag = (bg: [number, number, number], fg: [number, number, number], text: string, short = false): string =>
  ` \x1b[48;2;${bg.join(";")}m\x1b[1;38;2;${fg.join(";")}m${short ? text : ` ${text} `}${RESET}`;
type Tone = { bg: [number, number, number]; fg: [number, number, number] };
const UC: Tone = { bg: [91, 33, 182], fg: [237, 233, 254] };
const FAST: Tone = { bg: [180, 83, 9], fg: [254, 243, 199] };

/** One transcript row's verdict on ultracode: true (on), false (off), null (says nothing). */
export function rowVerdict(row: unknown): boolean | null {
  if (!row || typeof row !== "object") return null;
  const r = row as { type?: string; attachment?: { type?: string }; message?: { role?: string; content?: unknown } };
  const at = r.attachment?.type;
  if (at === "ultra_effort_enter") return true;
  if (at === "ultra_effort_exit") return false;
  if (r.type === "user" && typeof r.message?.content === "string") {
    const c = r.message.content;
    if (!c.startsWith("<local-command-stdout>")) return null;
    const body = c.slice("<local-command-stdout>".length);
    if (/^(Ultracode on\b|Set effort level to ultracode\b)/.test(body)) return true;
    if (/^Ultracode off\b/.test(body)) return false;
  }
  return null;
}

/** Folds transcript JSONL onto a starting state; the last decisive row wins. */
export function ultracodeFromRows(text: string, start = false): boolean {
  let on = start;
  for (const line of text.split("\n")) {
    // Cheap prefilter: only lines that could be decisive are parsed.
    if (!line.includes("ultra_effort_") && !line.includes("<local-command-stdout>")) continue;
    let row: unknown;
    try { row = JSON.parse(line); } catch { continue; }
    const v = rowVerdict(row);
    if (v !== null) on = v;
  }
  return on;
}

/** The engine's own `/effort ultracode` rows say ultracode is on, cached per session until the transcript changes. */
export function engineUltracode(state: State): boolean {
  if (!state.transcript || !mtime(state.transcript)) return false;
  const key = `ultracode-${state.session}.txt`;
  const cached = state.cache.text(key)?.trimEnd().split("\t");
  if (cached && cached[1] === state.transcript && mtime(state.transcript) <= mtime(state.cache.path(key)) && /^(on|off)$/.test(cached[0])) return cached[0] === "on";
  const rows = readText(state.transcript);
  if (rows === null) return false;
  const on = ultracodeFromRows(rows.slice(0, rows.lastIndexOf("\n") + 1));
  state.cache.put(key, `${on ? "on" : "off"}\t${state.transcript}\n`);
  return on;
}

export type ChipModes = { ultracode: boolean; fast?: boolean };

/** The mode chips, each with its leading space: `⚡ULTRACODE ↯ FAST`, or `⚡UC ↯` in the short form. FAST is Claude Code's per-session fast mode. */
export function modeChips(m: ChipModes, short: boolean): string {
  const uc = m.ultracode ? tag(UC.bg, UC.fg, `⚡${short ? "UC" : "ULTRACODE"}`, short) : "";
  const fast = m.fast ? tag(FAST.bg, FAST.fg, `↯${short ? "" : " FAST"}`, short) : "";
  return uc + fast;
}

/** Fills the chip text the header and SESSION rows draw. */
export function prepareUltracode(state: State): string {
  invariant(typeof state.ultracode === "string" && typeof state.ultracodeShort === "string", "ultracode chips must be text");
  const chips: ChipModes = { ultracode: engineUltracode(state), fast: state.fastMode === true };
  state.ultracode = modeChips(chips, false);
  state.ultracodeShort = modeChips(chips, true);
  return "";
}
