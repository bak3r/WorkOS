/**
 * claude-md — the marked WorkOS block inside a CLAUDE.md that someone else owns.
 *
 * A developer's existing CLAUDE.md is never replaced. WorkOS inserts
 *
 *   <!-- WORKOS:BEGIN -->
 *   …what install/CLAUDE.template.md provides (imports + routing table)…
 *   <!-- WORKOS:END -->
 *   <blank line>
 *   …the developer's text, unchanged…
 *
 * at the top, and afterwards edits ONLY between the markers. The block is rebuilt from the
 * template plus a small state (which dormant imports are active, whether the system-prompt
 * import is on), so a re-run is idempotent and toggling the system prompt on then off gives
 * back byte-identical text. removeBlock() is the exact inverse of the insert.
 *
 * Pure string functions; the CLIs do the I/O (through the ledger).
 */

export const BLOCK_BEGIN = "<!-- WORKOS:BEGIN -->";
export const BLOCK_END = "<!-- WORKOS:END -->";
export const SYSTEM_PROMPT_LINE = "@WORKOS/WORKOS_SYSTEM_PROMPT.md";

const DORMANT = /^\s*#\s+(@[\w./-]+)\s*$|^\s*<!--\s*(@[\w./-]+)\s*-->\s*$/;

export interface BlockLoc { start: number; end: number; inner: string }

/** Locate the block: BEGIN and END each on their own line, BEGIN first. */
export function findBlock(text: string): BlockLoc | null {
  const b = text.startsWith(BLOCK_BEGIN + "\n") ? 0 : text.indexOf("\n" + BLOCK_BEGIN + "\n");
  if (b < 0) return null;
  const start = b === 0 ? 0 : b + 1;
  const innerStart = start + BLOCK_BEGIN.length + 1;
  const e = text.indexOf("\n" + BLOCK_END, innerStart - 1);
  if (e < 0) return null;
  let end = e + 1 + BLOCK_END.length;
  if (text[end] === "\n") end++;
  return { start, end, inner: text.slice(innerStart, e) };
}

export interface BlockState { active: Set<string>; systemPrompt: boolean }

/** Which imports are active inside an existing block (or a whole WorkOS CLAUDE.md). */
export function blockState(inner: string): BlockState {
  const active = new Set<string>();
  let systemPrompt = false;
  for (const l of inner.split("\n")) {
    const t = l.trim();
    if (t === SYSTEM_PROMPT_LINE) systemPrompt = true;
    else if (/^@[\w./-]+$/.test(t)) active.add(t);
  }
  return { active, systemPrompt };
}

/**
 * Build the block from the template. A dormant import is activated when it was active
 * before OR `canActivate(path)` says its target now resolves (never deactivated — same
 * rule as activateImports). The system-prompt import follows `state.systemPrompt` only.
 */
export function buildBlock(template: string, state: BlockState, canActivate: (importPath: string) => boolean): { block: string; activated: string[]; skipped: string[] } {
  const activated: string[] = [];
  const skipped: string[] = [];
  const body = template.replace(/\n+$/, "").split("\n").map((line) => {
    const m = line.match(DORMANT);
    if (!m) {
      if (line.trim() === SYSTEM_PROMPT_LINE && !state.systemPrompt) return `# ${SYSTEM_PROMPT_LINE}`;
      return line;
    }
    const imp = m[1] || m[2];
    if (imp === SYSTEM_PROMPT_LINE) return state.systemPrompt ? SYSTEM_PROMPT_LINE : line;
    if (state.active.has(imp) || canActivate(imp)) { activated.push(imp); return imp; }
    skipped.push(imp);
    return line;
  });
  return { block: `${BLOCK_BEGIN}\n${body.join("\n")}\n${BLOCK_END}\n`, activated, skipped };
}

/** Insert at the top (with one blank separator line) or replace the existing block in place. */
export function upsertBlock(text: string, block: string): { text: string; action: "inserted" | "updated" | "unchanged" } {
  const loc = findBlock(text);
  if (!loc) return { text: block + "\n" + text, action: "inserted" };
  const next = text.slice(0, loc.start) + block + text.slice(loc.end);
  return { text: next, action: next === text ? "unchanged" : "updated" };
}

/** Exact inverse of an insert: strips the block and the one blank line the insert added. */
export function removeBlock(text: string): string {
  const loc = findBlock(text);
  if (!loc) return text;
  let end = loc.end;
  if (loc.start === 0 && text[end] === "\n") end++;
  return text.slice(0, loc.start) + text.slice(end);
}

export interface PathFix { line: number; from: string; to: string }

/**
 * Rewrite `~/.claude/LIFEOS/…` and bare `LIFEOS/…` path references OUTSIDE the block to
 * their WORKOS equivalents — only where the WORKOS path exists (`exists(rel)` answers for
 * `WORKOS/<rest>`). A path cut short by a template character (`v<V>.md`, `*.md`) is
 * rewritten when its directory exists. Everything else is reported, not touched.
 */
export function fixLifeosPaths(text: string, exists: (workosRel: string) => boolean): { text: string; fixed: PathFix[]; unresolved: PathFix[] } {
  const loc = findBlock(text);
  const head = loc ? text.slice(0, loc.end) : "";
  const tail = loc ? text.slice(loc.end) : text;
  const lineOffset = head ? head.split("\n").length - 1 : 0;
  const fixed: PathFix[] = [];
  const unresolved: PathFix[] = [];
  const re = /(^|[^\w$])((?:~|\$HOME|\$\{HOME\})\/\.claude\/|@)?LIFEOS\/([\w.\-/]*)/g;
  const out = tail.split("\n").map((line, i) => line.replace(re, (all, pre: string, prefix: string | undefined, rest: string, off: number) => {
    const trimmed = rest.replace(/[.\-/]+$/, (s) => (s.endsWith("/") ? "/" : ""));
    const next = line[off + all.length] ?? "";
    const truncated = /[<*{[]/.test(next);
    const variants = [trimmed, trimmed.replace(/LIFEOS/g, "WORKOS").replace(/LifeOS/g, "WorkOS").replace(/Lifeos/g, "Workos")];
    const ok = (r: string) => {
      const clean = r.replace(/\/$/, "");
      if (clean === "" || exists(clean)) return true;
      if (truncated) {
        const dir = clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/")) : "";
        return dir === "" || exists(dir);
      }
      return false;
    };
    const pick = variants.find(ok);
    const from = `${prefix ?? ""}LIFEOS/${rest}`;
    if (pick === undefined) { unresolved.push({ line: lineOffset + i + 1, from, to: "" }); return all; }
    const newRest = pick + rest.slice(trimmed.length);
    const to = `${prefix ?? ""}WORKOS/${newRest}`;
    fixed.push({ line: lineOffset + i + 1, from, to });
    return `${pre}${to}`;
  }));
  return { text: head + out.join("\n"), fixed, unresolved };
}

/** Lines (1-based) outside the block that mention a LIFEOS/ path — for Inventory. */
export function lifeosRefs(text: string): Array<{ line: number; path: string }> {
  const loc = findBlock(text);
  const out: Array<{ line: number; path: string }> = [];
  const re = /(?:^|[^\w$])((?:(?:~|\$HOME|\$\{HOME\})\/\.claude\/|@)?LIFEOS\/[\w.\-/]*)/g;
  let offset = 0;
  text.split("\n").forEach((line, i) => {
    const inBlock = loc && offset >= loc.start && offset < loc.end;
    offset += line.length + 1;
    if (inBlock) return;
    for (const m of line.matchAll(re)) out.push({ line: i + 1, path: m[1] });
  });
  return out;
}

/** Minimal unified diff (LCS), for showing a CLAUDE.md change before it is written. */
export function unifiedDiff(a: string, b: string, nameA = "a", nameB = "b", context = 3): string {
  if (a === b) return "";
  const x = a.split("\n");
  const y = b.split("\n");
  const n = x.length;
  const m = y.length;
  if (n * m > 4_000_000) return `--- ${nameA}\n+++ ${nameB}\n@@ (files too large for an inline diff: ${n} vs ${m} lines) @@\n`;
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  type Op = { t: " " | "-" | "+"; s: string; i: number; j: number };
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { ops.push({ t: " ", s: x[i], i, j }); i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) { ops.push({ t: "+", s: y[j], i, j }); j++; }
    else { ops.push({ t: "-", s: x[i], i, j }); i++; }
  }
  const out = [`--- ${nameA}`, `+++ ${nameB}`];
  const changed = ops.map((o, idx) => (o.t === " " ? -1 : idx)).filter((idx) => idx >= 0);
  let g = 0;
  while (g < changed.length) {
    let last = g;
    while (last + 1 < changed.length && changed[last + 1] - changed[last] <= context * 2 + 1) last++;
    const hunk = ops.slice(Math.max(0, changed[g] - context), Math.min(ops.length, changed[last] + context + 1));
    const aLen = hunk.filter((o) => o.t !== "+").length, bLen = hunk.filter((o) => o.t !== "-").length;
    out.push(`@@ -${hunk[0].i + (aLen ? 1 : 0)},${aLen} +${hunk[0].j + (bLen ? 1 : 0)},${bLen} @@`, ...hunk.map((o) => o.t + o.s));
    g = last + 1;
  }
  return out.join("\n") + "\n";
}
