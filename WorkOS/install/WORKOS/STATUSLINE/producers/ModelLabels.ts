import { EFFORT_MODEL } from "../../TOOLS/models";
import type { State } from "../State";

export interface ModelLabels { max: string; high: string; med: string }

/**
 * Ladder labels straight from the model registry (TOOLS/models.ts EFFORT_MODEL), imported rather than parsed: in WorkOS
 * the max rung is an expression (Fable where the provider offers it, Opus on a Bedrock lineup without it), which a text
 * parse cannot read. A max label equal to the high label means the provider has no Fable; the ladder then folds it.
 */
export function modelLabels(_state: State): ModelLabels {
  return { max: EFFORT_MODEL.max.toUpperCase(), high: EFFORT_MODEL.high.toUpperCase(), med: EFFORT_MODEL.medium.toUpperCase() };
}
