/**
 * GlanceQuestion — the shape of a glance question and of a staged-eval producer, for parsing only.
 *
 * WorkOS treats glance rows and the staged `## Evals` block as schema only (ISAFormat § WorkOS runtime
 * scope): an ISA may carry them so it moves between WorkOS and upstream unchanged, and nothing in
 * WorkOS runs a glance question or a rubric's subject producer. This module lets IsaTestStrategy.ts parse
 * those blocks and report a malformed one.
 *
 * NOT A SAFETY CHECK. Upstream 8.761.0's GlanceQuestion.ts also decides whether a producer command
 * is read-only (no writes, no secret paths, curl only to public hosts, pinned DNS) before its runner
 * executes it. That check needs the texting guard, the shell walker, SafeFetch and StateSources, and is
 * not ported because WorkOS has no runner. `validateProducer` here only tokenizes and `readOnlyRefusal`
 * refuses nothing. Any tool that would EXECUTE a producer must first port upstream's module in place of
 * this one; `PRODUCER_SAFETY_CHECKED` says which one is installed.
 * @version 1.0.0
 */

export const PRODUCER_SAFETY_CHECKED = false;

export interface GlanceQuestion {
  id: string;
  claim: string;
  kind: "noul" | "score" | "choice";
  instructions: string;
  criteria?: string[] | { true?: string; false?: string };
  options?: Record<string, string | null>;
  state: { producer: string };
  caller: string;
}

export type Producer = { argv: string[] };

const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;

/** Tokenizes a producer for display. Never a judgment that it is safe to run (see the header). */
export function validateProducer(producer: string, _isaPath?: string): Producer {
  if (!text(producer)) throw new Error("producer is empty");
  return { argv: producer.trim().split(/\s+/) };
}

/** Always null: WorkOS runs no producer, so there is nothing to refuse (see the header). */
export function readOnlyRefusal(_command: string, _isaDir: string): string | null {
  return null;
}

/** Upstream's structural checks on a question object, minus the producer safety check. */
export function validateGlanceQuestion(raw: unknown, _isaPath?: string): GlanceQuestion {
  if (!object(raw)) throw new Error("question file must contain an object");
  for (const key of ["id", "claim", "instructions", "caller"]) {
    if (!text(raw[key])) throw new Error(`question file requires ${key}`);
  }
  if (!object(raw.state) || !text(raw.state.producer)) throw new Error("question file requires state.producer");
  if (!["noul", "score", "choice"].includes(String(raw.kind))) throw new Error("question file kind must be noul, score or choice");
  if (raw.kind === "score" && (!Array.isArray(raw.criteria) || !raw.criteria.length || !raw.criteria.every(text))) {
    throw new Error("score question file requires ordered non-empty criteria");
  }
  if (raw.kind === "choice" && (!object(raw.options) || !Object.keys(raw.options).length ||
    !Object.entries(raw.options).every(([k, v]) => text(k) && (v === null || text(v))))) {
    throw new Error("choice question file requires options");
  }
  if (raw.kind === "noul" && raw.criteria !== undefined && (!object(raw.criteria) ||
    !Object.entries(raw.criteria).every(([k, v]) => ["true", "false"].includes(k) && text(v)))) {
    throw new Error("noul question file criteria must name true or false");
  }
  return raw as unknown as GlanceQuestion;
}
