/**
 * optional-dep — load an npm package that may not be installed.
 *
 * A deny-all-egress sandbox never ran `bun install`, so packages declared in a
 * package.json can be absent. Bun then tries to auto-install them, the egress
 * proxy answers 403, and the import fails with ERR_MODULE_NOT_FOUND. Every
 * npm-dependent tool goes through requireOptional() so that failure becomes one
 * clear line — what is missing, which feature is off, and the fix — and a
 * non-zero exit, instead of a stack trace.
 *
 * The caller passes the import as a thunk (`() => import("pkg")`) because a bare
 * specifier resolves from the file that calls import(): it must be the caller's
 * file, whose package.json declares the dependency, not this one.
 *
 * Only for CLIs. Hooks must never exit on a missing package — they use
 * Bun.YAML and other built-ins instead.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface OptionalDep {
  /** npm package name, e.g. "handlebars". */
  pkg: string;
  /** The feature that is unavailable without it, e.g. "Prompting template rendering". */
  feature: string;
  /** Absolute directory whose package.json declares the package (where `bun install` runs). */
  installDir: string;
}

/** The npm packages WorkOS tools use, by install dir relative to the config root. Doctor's `npm-deps` reads this. */
export const NPM_DEPS: ReadonlyArray<{ pkg: string; feature: string; dir: string }> = [
  { pkg: "yaml", feature: "Evals suite/case writers (SuiteManager, FailureToTask, GenerateCases, ProposeFromFailures)", dir: "." },
  { pkg: "handlebars", feature: "Prompting templates (RenderTemplate, ValidateTemplate)", dir: "skills/Prompting/Tools" },
  { pkg: "graphology", feature: "Memory graph (MemoryGraph.ts)", dir: "WORKOS/TOOLS" },
  { pkg: "graphology-communities-louvain", feature: "Memory graph (MemoryGraph.ts)", dir: "WORKOS/TOOLS" },
  { pkg: "graphology-metrics", feature: "Memory graph (MemoryGraph.ts)", dir: "WORKOS/TOOLS" },
  { pkg: "js-tiktoken", feature: "Token X-ray (TokenXray.ts)", dir: "WORKOS/TOOLS/TokenXray" },
  { pkg: "apify-client", feature: "Apify skill", dir: "skills/Apify" },
  { pkg: "@langwatch/scenario", feature: "Evals multi-turn scenarios (ScenarioRunner)", dir: "skills/Evals" },
  { pkg: "@ai-sdk/anthropic", feature: "Evals multi-turn scenarios (ScenarioRunner)", dir: "skills/Evals" },
];

/** True when `pkg` is installed in a node_modules at `dir` or any ancestor (Node/Bun resolution order). Never triggers an install. */
export function isInstalled(pkg: string, dir: string): boolean {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, "node_modules", pkg, "package.json"))) return true;
    if (dirname(d) === d) return false;
  }
}

export function missingDepMessage(d: OptionalDep): string {
  return (
    `${d.feature} is unavailable: npm package '${d.pkg}' is not installed.\n` +
    `  Fix: run \`bun install\` in ${d.installDir} where the npm registry is reachable` +
    ` (a deny-all-egress sandbox cannot; see GETTING-STARTED.md "Optional npm dependencies").`
  );
}

function isMissing(e: unknown, pkg: string): boolean {
  const err = e as { code?: string; message?: string } | null;
  const msg = String(err?.message ?? e);
  const notFound = err?.code === "ERR_MODULE_NOT_FOUND" || err?.code === "MODULE_NOT_FOUND" || /Cannot find (package|module)/.test(msg);
  return notFound && msg.includes(pkg);
}

/** Import an optional package, or print the unavailable message and exit 1. */
export async function requireOptional<T>(load: () => Promise<T>, d: OptionalDep): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (!isMissing(e, d.pkg)) throw e;
    console.error(missingDepMessage(d));
    process.exit(1);
  }
}
