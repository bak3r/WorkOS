import { separator } from "./Ansi";
import type { State } from "./State";
import { renderHeader } from "./sections/Header";
import { renderPhone } from "./sections/Phone";
import { renderAttention, renderWorkQueue } from "./sections/WorkQueue";
import { renderDoctor } from "./sections/Doctor";
import { renderVersion } from "./sections/Version";
import { prepareUltracode } from "./sections/Ultracode";
import { renderContext } from "./sections/Context";
import { renderLadder } from "./sections/Ladder";
import { renderAccount } from "./sections/Account";

export interface Section {
  id: string;
  /** What the section reads: cache names, WorkOS-root paths, stdin fields. Documentation for the next reader, and the list a new input joins. */
  inputs: readonly string[];
  ttl: number | "mtime" | "session";
  kind?: "chip" | "row";
  render: (state: State) => string;
}

/** The rule that closes the ladder block; none when the ladder has nothing to draw. */
const renderRule = (state: State): string => renderLadder(state) ? separator(state.geometry.content, state.geometry.density) : "";

/**
 * The one table of rows, in frame order. A row removed here takes its section and producer with it.
 * Upstream also draws location, weather, tide, life ratings, Synapse inputs, Claude and Codex usage, money,
 * cosmos and a quote; WorkOS has no data behind any of them (Bedrock reports no plan usage, and the sandbox has no
 * egress for weather), so those rows were not ported.
 */
export const sections: readonly Section[] = [
  // The mode chips come from the transcript and stdin; they ride on the SESSION line, or the header when there is none.
  { id: "ultracode", kind: "chip", inputs: ["transcript", "ultracode-<session>.txt", "stdin.fast_mode"], ttl: "mtime", render: prepareUltracode },
  { id: "header", inputs: ["VERSION", "session-names", "session-labels", "ultracode", "clock", "geometry"], ttl: "mtime", render: renderHeader },
  { id: "phone", inputs: ["session-names", "session-labels"], ttl: "mtime", render: renderPhone },
  { id: "work", inputs: ["USER/WORK/ledger.jsonl", "MEMORY/STATE/work-context.json", "clock", "geometry"], ttl: 0, render: renderWorkQueue },
  { id: "attention", inputs: ["MEMORY/OBSERVABILITY/memory-health.jsonl", "geometry"], ttl: 0, render: renderAttention },
  { id: "doctor", inputs: ["MEMORY/STATE/capabilities-statusline.txt"], ttl: 0, render: renderDoctor },
  { id: "version", inputs: ["ALGORITHM/LATEST", "stdin.model", "density", "WORKOS_STATUSLINE_FULL"], ttl: 0, render: renderVersion },
  { id: "ladder", inputs: ["stdin.model", "TOOLS/models.ts", "model-labels.txt", "model-mix-<session>.txt"], ttl: 20, render: renderLadder },
  { id: "rule", inputs: ["geometry", "stdin.model", "TOOLS/models.ts", "model-labels.txt", "model-mix-<session>.txt"], ttl: 0, render: renderRule },
  { id: "context", inputs: ["stdin.context_window", "startup-estimate-<session>.sh", "model-mix-<session>.txt", "model-labels.txt", "ctx-sizes.txt", "CLAUDE.md", "WORKOS_SYSTEM_PROMPT.md", "skills-size-<session>.sh", "listing-size-<session>.sh", "listing-size-last.sh", "transcript", "geometry"], ttl: "session", render: renderContext },
  { id: "account", inputs: ["env.CLAUDE_CODE_USE_BEDROCK", "env.AWS_REGION", "~/.claude.json"], ttl: 0, render: renderAccount },
];
