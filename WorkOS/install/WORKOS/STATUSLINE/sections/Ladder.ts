import { RESET } from "../Ansi";
import { icon } from "../Glyphs";
import { modelLabels, type ModelLabels } from "../producers/ModelLabels";
import { readMix, type Mix } from "../producers/ModelMix";
import type { State } from "../State";
import { cellWidth, fit } from "../Width";
import { shrinkToFit } from "../../TOOLS/StatusLineAbbrev";

type Rung = "low" | "medium" | "high" | "max";

const MODELS_LABEL = "\x1b[38;2;148;163;184m";
const esc = (r: number, g: number, b: number, dim = false): string => `\x1b[${dim ? "2;" : ""}38;2;${r};${g};${b}m`;
/** USED is the plain hue, dim the muted tint. */
const RUNG_COLORS: Record<Rung, [string, string]> = {
  low: [esc(60, 190, 110), esc(86, 164, 110, true)],
  medium: [esc(70, 140, 225), esc(90, 130, 185, true)],
  high: [esc(215, 80, 80), esc(180, 95, 95, true)],
  max: [esc(155, 95, 225), esc(150, 110, 195, true)],
};
const ORDER: readonly Rung[] = ["low", "medium", "high", "max"];

/** Carrier rung from the harness model name; an unknown carrier has no rung. */
export function carrierRung(model: string): Rung | "" {
  if (/[Hh]aiku/.test(model)) return "low";
  if (/[Ss]onnet/.test(model)) return "medium";
  if (/[Ff]able/.test(model)) return "max";
  if (/[Oo]pus/.test(model)) return "high";
  return "";
}

export interface LadderModel {
  labels: ModelLabels;
  /** Mix after duplicate-rung share folding; the context bar reads the same numbers. */
  mix: Mix;
  draw: Record<Rung, boolean>;
  used: Record<Rung, boolean>;
}

const memo = new WeakMap<State, LadderModel>();

/** Labels, folded mix and used-flags, computed once per render. */
export function ladderModel(state: State): LadderModel {
  const hit = memo.get(state);
  if (hit) return hit;
  const labels = modelLabels(state);
  const mix = readMix(state);
  const used: Record<Rung, boolean> = { low: false, medium: false, high: false, max: false };
  const carrier = carrierRung(state.model);
  if (carrier) used[carrier] = true;
  // One label per model: a level whose label repeats a higher level's is not drawn and its share moves up. On a Bedrock
  // lineup without Fable, max resolves to Opus, so max folds into high.
  const draw: Record<Rung, boolean> = { low: true, medium: true, high: true, max: true };
  if (labels.max === labels.high) { draw.max = false; mix.high += mix.max; mix.max = 0; if (used.max) used.high = true; used.max = false; }
  if (labels.med === labels.high || labels.med === labels.max) {
    draw.medium = false;
    if (labels.med === labels.high) mix.high += mix.medium; else mix.max += mix.medium;
    mix.medium = 0;
  }
  for (const r of ORDER) if (mix[r] > 0) used[r] = true;
  const model = { labels, mix, draw, used };
  memo.set(state, model);
  return model;
}

/** Every Claude model, lit with its share of output tokens once this session uses it (direct calls and agents alike), dim until then. */
export function renderLadder(state: State): string {
  if (state.geometry.phone) return "";
  const { labels, mix, draw, used } = ladderModel(state);
  const token = (rung: Rung, name: string): string => {
    const share = mix[rung];
    return `${RUNG_COLORS[rung][used[rung] ? 0 : 1]}${name}${RESET}${share > 0 ? `${RUNG_COLORS[rung][0]} ${share}%${RESET}` : ""}`;
  };
  const name: Record<Rung, string> = { low: "HAIKU", medium: labels.med, high: labels.high, max: labels.max };
  const drawn = ORDER.filter((r) => draw[r] && name[r]);
  if (!drawn.length) return "";
  // Full names when they fit; then the longest names shorten first, vowels before consonants (StatusLineAbbrev).
  const ladder = (rungs: readonly Rung[], names: string[]): string => rungs.map((r, i) => token(r, names[i]!)).join(" ");
  const full = drawn.map((r) => name[r]);
  const room = state.geometry.content - cellWidth(ladder(drawn, full.map(() => "")));
  const tag = `${icon("models")}${MODELS_LABEL}${state.geometry.density === 3 ? "MODELS:" : "MODELS"}${RESET} `;
  // Narrower still, the models this session has not used drop out (they carry no share), then the used ones shorten.
  const lit = drawn.filter((r) => used[r]);
  const litFull = lit.map((r) => name[r]);
  const litRoom = state.geometry.content - cellWidth(ladder(lit, litFull.map(() => "")));
  const narrow = lit.length ? [ladder(lit, litFull), ladder(lit, shrinkToFit(litFull, litRoom, 3))] : [];
  const best = fit(state.geometry.content, tag + ladder(drawn, full), ladder(drawn, full), ladder(drawn, shrinkToFit(full, room, 3)), ...narrow);
  return best + "\n";
}
