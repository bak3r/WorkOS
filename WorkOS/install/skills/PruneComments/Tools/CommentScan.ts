#!/usr/bin/env bun
// CommentScan — lists the comments a branch or commit added, and verifies that a prune changed comments only.
// Built for C# first (verbatim, raw and interpolated strings; XML doc comments; csproj doc policy); other
// languages get a simpler line scanner.
// Usage:
//   bun CommentScan.ts scan   [--branch <name> | --commit <sha>] [--base <remote/branch>] [--include-generated] [--repo <path>] [--json]
//   bun CommentScan.ts verify [--against <ref>] [--repo <path>] [--json]
// Read-only: runs git diff/log/show/merge-base/rev-parse and reads files. Never writes, fetches, checks out or commits.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

interface Syntax { line: string[]; block: [string, string][]; quotes: string[]; blockAtLineStart?: boolean; lang?: "cs" }
type Kind = "comment" | "doc" | "directive" | "inline";
interface Block { file: string; start: number; end: number; kind: Kind; lines: string[]; looksLikeCode: boolean; present: boolean; hints: string[] }
interface LineInfo { code: string; comment: string; doc: boolean }

const USAGE = `bun CommentScan.ts scan   [--branch <name> | --commit <sha>] [--base <remote/branch>] [--include-generated] [--repo <path>] [--json]
bun CommentScan.ts verify [--against <ref>] [--repo <path>] [--json]`;

const args = process.argv.slice(2);
const mode = args[0];
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!mode || args.includes("--help") || !["scan", "verify"].includes(mode)) {
  console.log(USAGE);
  process.exit(mode && mode !== "--help" && !args.includes("--help") ? 2 : 0);
}
const asJson = args.includes("--json");
const repo = flag("repo") ?? process.cwd();
const git = (...a: string[]) => {
  const r = spawnSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? "").replace(/\s+$/, ""), err: (r.stderr ?? "").trim() };
};
const die = (msg: string): never => { console.error(msg); process.exit(2); };
if (!git("rev-parse", "--git-dir").ok) die(`Not a git repository: ${repo}`);
const root = git("rev-parse", "--show-toplevel").out;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const showAt = (ref: string, path: string) => { const r = git("show", `${ref}:${path}`); return r.ok ? r.out : null; };

// ---- comment syntax per file type ----

const C_LIKE: Syntax = { line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'", "`"] };
const HASH: Syntax = { line: ["#"], block: [], quotes: ['"', "'"] };
const CSHARP: Syntax = { line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'"], lang: "cs" };
const RAZOR: Syntax = { line: [], block: [["@*", "*@"], ["<!--", "-->"]], quotes: [] };
const SYNTAX: Record<string, Syntax> = {
  cs: CSHARP, csx: CSHARP, cshtml: RAZOR, razor: RAZOR,
  ...Object.fromEntries(["java", "kt", "kts", "go", "swift", "c", "h", "cpp", "hpp", "cc", "cxx", "scala", "dart", "php", "groovy", "gradle", "proto", "fs", "fsx", "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "vue", "svelte", "jsonc", "json5"].map((e) => [e, C_LIKE])),
  rs: { line: ["//"], block: [["/*", "*/"]], quotes: ['"'] }, // ' starts lifetimes, not strings
  css: { line: [], block: [["/*", "*/"]], quotes: ['"', "'"] },
  scss: { line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'"] },
  less: { line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'"] },
  py: { line: ["#"], block: [['"""', '"""'], ["'''", "'''"]], quotes: ['"', "'"], blockAtLineStart: true },
  ...Object.fromEntries(["rb", "sh", "bash", "zsh", "fish", "yml", "yaml", "toml", "pl", "r", "tf", "tfvars", "hcl", "conf", "cfg", "nix", "cmake", "dockerfile", "makefile", "mk", "env", "gitignore", "dockerignore", "editorconfig"].map((e) => [e, HASH])),
  ps1: { line: ["#"], block: [["<#", "#>"]], quotes: ['"', "'"] },
  psm1: { line: ["#"], block: [["<#", "#>"]], quotes: ['"', "'"] },
  ini: { line: [";", "#"], block: [], quotes: [] },
  sql: { line: ["--"], block: [["/*", "*/"]], quotes: ["'"] },
  hs: { line: ["--"], block: [["{-", "-}"]], quotes: ['"'] },
  lua: { line: ["--"], block: [["--[[", "]]"]], quotes: ['"', "'"] },
  ...Object.fromEntries(["html", "htm", "xml", "xaml", "csproj", "fsproj", "vbproj", "props", "targets", "config", "resx", "svg", "md"].map((e) => [e, { line: [], block: [["<!--", "-->"]], quotes: [] } as Syntax])),
};
const syntaxFor = (path: string): Syntax | undefined => {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile" || name === "makefile" || name.startsWith(".env")) return HASH;
  return SYNTAX[(extname(name).slice(1) || name.replace(/^\./, ""))];
};

// Generic scanner. `open` is the end token of a block comment still open from the previous line.
function split(line: string, s: Syntax, open: string | null) {
  let code = "", comment = "", i = 0, quote: string | null = null;
  while (i < line.length) {
    if (open) {
      const end = line.indexOf(open, i);
      if (end < 0) { comment += line.slice(i); return { code, comment, open }; }
      comment += line.slice(i, end + open.length);
      i = end + open.length;
      open = null;
      continue;
    }
    const ch = line[i];
    if (quote) {
      code += ch;
      if (ch === "\\" && i + 1 < line.length) { code += line[i + 1]; i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    const blk = s.block.find(([b]) => line.startsWith(b, i) && (!s.blockAtLineStart || line.slice(0, i).trim() === ""));
    if (blk) { comment += blk[0]; i += blk[0].length; open = blk[1]; continue; }
    // '#' only starts a comment at line start or after whitespace, so ${#var} and url#anchor stay code.
    const ln = s.line.find((m) => line.startsWith(m, i) && (m !== "#" || i === 0 || /\s/.test(line[i - 1])));
    if (ln) { comment += line.slice(i); return { code, comment, open: null }; }
    if (s.quotes.includes(ch)) quote = ch;
    code += ch;
    i++;
  }
  return { code, comment, open };
}

// C# scanner: verbatim strings (@"C:\dir\") have no backslash escapes, raw strings ("""…""") span lines and may
// contain // or /*, and interpolation holes ($"{(a ? "x" : "y")}") nest quotes.
// `open` is what is still open at end of line: "*/" a block comment, '@"' a verbatim string, '"""…' a raw string.
function splitCs(line: string, open: string | null) {
  let code = "", comment = "", i = 0;
  const toCode = (end: number) => { code += line.slice(i, end); i = end; };
  const endOfQuoted = (q: number, interp: boolean): number => {
    const quote = line[q];
    let j = q + 1;
    while (j < line.length) {
      const ch = line[j];
      if (ch === "\\") { j += 2; continue; }
      if (ch === quote) return j + 1;
      if (interp && ch === "{") {
        if (line[j + 1] === "{") { j += 2; continue; }
        let depth = 1;
        j++;
        while (j < line.length && depth) {
          if (line[j] === '"' || line[j] === "'") { j = endOfQuoted(j, false); continue; }
          if (line[j] === "{") depth++;
          else if (line[j] === "}") depth--;
          j++;
        }
        continue;
      }
      j++;
    }
    return line.length;
  };
  while (i < line.length) {
    if (open === "*/") {
      const e = line.indexOf("*/", i);
      if (e < 0) { comment += line.slice(i); return { code, comment, open }; }
      comment += line.slice(i, e + 2); i = e + 2; open = null;
      continue;
    }
    if (open === '@"') {
      let j = i;
      while (j < line.length && !(line[j] === '"' && line[j + 1] !== '"')) j += line[j] === '"' ? 2 : 1;
      if (j >= line.length) { toCode(line.length); return { code, comment, open }; }
      toCode(j + 1); open = null;
      continue;
    }
    if (open) {
      const e = line.indexOf(open, i);
      if (e < 0) { toCode(line.length); return { code, comment, open }; }
      toCode(e + open.length); open = null;
      continue;
    }
    const rest = line.slice(i);
    if (rest.startsWith("//")) { comment += rest; return { code, comment, open: null }; }
    if (rest.startsWith("/*")) { comment += "/*"; i += 2; open = "*/"; continue; }
    const raw = /^\$*("{3,})/.exec(rest);
    if (raw) { toCode(i + raw[0].length); open = raw[1]; continue; }
    const verbatim = /^(\$@|@\$|@)"/.exec(rest);
    if (verbatim) { toCode(i + verbatim[0].length); open = '@"'; continue; }
    const regular = /^(\$?)["']/.exec(rest);
    if (regular) { toCode(endOfQuoted(i + regular[1].length, regular[1] === "$")); continue; }
    code += line[i++];
  }
  return { code, comment, open };
}

const isDoc = (c: string) => /^(\/\/\/|\/\/!|\/\*\*|"""|''')/.test(c);

// Classifies every line of a whole file, so a line inside a multi-line string or comment is never judged out of context.
function analyze(text: string, s: Syntax): LineInfo[] {
  let open: string | null = null, docOpen = false;
  return text.split("\n").map((line) => {
    const inBlock = open === "*/" || (open !== null && s.lang !== "cs");
    const r = s.lang === "cs" ? splitCs(line, open) : split(line, s, open);
    const c = r.comment.trim();
    const doc = c !== "" && (isDoc(c) || (inBlock && docOpen));
    open = r.open;
    docOpen = open !== null && doc;
    return { code: r.code, comment: r.comment, doc };
  });
}

const DIRECTIVE = new RegExp([
  String.raw`^#!`, String.raw`^#\s*-\*-`, String.raw`#\s*(type:\s*ignore|noqa|pylint:|pyright:|mypy:|fmt:\s*(off|on|skip)|pragma|shellcheck|yaml-language-server|rubocop:|frozen_string_literal|nosec|isort:|ruff:)`,
  String.raw`//\s*(eslint|@ts-|prettier-ignore|biome-ignore|istanbul\s|c8\s|NOLINT|ReSharper|swiftlint:|tslint:|jshint|global\s|csharpier-ignore|dotcover\s|noinspection|lang(uage)?\s*=)`,
  String.raw`/\*\s*(eslint|istanbul|c8|webpack\w*|@vite-ignore|#__PURE__|@__PURE__|prettier-ignore|lang(uage)?\s*=)`,
  String.raw`^//go:`, String.raw`^//\s*\+build`, String.raw`^//\s*<(auto-generated|copyright)`, String.raw`^///\s*<reference`, String.raw`^//\s*#(region|endregion)`, String.raw`^//\s*(#|@)\s*sourceMappingURL`,
  String.raw`^\s*--\s*(liquibase|flyway|changeset|rollback|migrate:)`,
  String.raw`(SPDX-License-Identifier|Copyright\s|\(c\)\s*\d{4}|Licensed under)`,
].join("|"), "i");
// Arrange/Act/Assert markers are a test-suite convention, not narration.
const TEST_MARKER = /^\/\/\s*(arrange|act|assert)\b/i;
const LOOKS_LIKE_CODE = /(;\s*$|^[{}]\s*$|\)\s*\{?\s*$|^\s*(return|if|for|foreach|while|var|let|const|await|public|private|import|using|def|class)\b|=\s*new\b|\w+\(.*\)\s*;?$)/;
const commentBody = (c: string) => c.replace(/^(\/\/\/?|\/\/!|\/\*\*?|\*\/?|#|--|<!--|"""|''')\s?/, "").replace(/(\*\/|-->|"""|''')\s*$/, "").trim();

// Generated code is rewritten by its generator, so hand-pruning its comments is lost on the next build.
const GENERATED = /(\.g\.cs|\.g\.i\.cs|\.designer\.cs|ModelSnapshot\.cs|\.pb\.go|_pb2\.pyi?|\.min\.(js|css)|\.lock)$|\.generated\.|(^|\/)(generated|gen|dist|build|node_modules|vendor|obj|bin)\/|lock\.json$/i;

// ---- C# XML doc comment hints ----

const STOP = new Set(("a an the of for to and or in on at by with from as this that which is are be will its it gets sets get set returns return " +
  "value instance class method property new creates create initializes initialize constructor object specified given current provided " +
  "async asynchronously asynchronous task represents represent type").split(" "));
const words = (s: string) => s
  .replace(/<see\s+(?:cref|langword|href)="(?:[^"]*[.:])?([^".:]+)"\s*\/>/g, " $1 ")
  .replace(/<[^>]+>/g, " ")
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const stem = (w: string) => w.replace(/(ies|s)$/, (m) => (m === "ies" ? "y" : ""));
// True when every meaningful word of the text already appears in the identifier: "Gets the user." on GetUser.
const echoes = (text: string, name: string) => {
  const nameWords = new Set(words(name).map(stem));
  const textWords = words(text).filter((w) => !STOP.has(w));
  return textWords.length > 0 && textWords.every((w) => nameWords.has(stem(w)));
};

function declaration(line: string) {
  const t = line.trim();
  const typeDecl = /\b(class|record|struct|interface|enum|delegate)\s+(?:class\s+|struct\s+)?(\w+)/.exec(t);
  const head = t.split(/[{=;]/)[0];
  const name = typeDecl?.[2] ?? /(\w+)\s*(<[^>]*>)?\s*\(/.exec(head)?.[1] ?? /(\w+)\s*$/.exec(head)?.[1];
  const visibility = /\bprivate\s+protected\b/.test(t) ? "non-public"
    : /\b(public|protected)\b/.test(t) ? "public-api"
    : /\b(private|internal|file)\b/.test(t) ? "non-public" : "no-modifier";
  return { name, visibility };
}

function docHints(lines: string[], declLine: string | undefined): { hints: string[]; visibility?: string } {
  const hints: string[] = [];
  const doc = lines.map((l) => l.trim().replace(/^\/\/\/\s?|^\/\*\*|^\*\/?|\*\/$/g, "")).join(" ");
  const decl = declLine ? declaration(declLine) : undefined;
  if (/<inheritdoc\b/.test(doc)) hints.push("inheritdoc");
  for (const m of doc.matchAll(/<(summary|remarks|returns|value|param|typeparam)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g)) {
    const tag = m[1], attr = /name="([^"]*)"/.exec(m[2])?.[1], body = m[4] ?? "";
    const label = attr ? `${tag}(${attr})` : tag;
    if (!words(body).length) hints.push(`empty:${label}`);
    else if (tag === "summary" && decl?.name && echoes(body, decl.name)) hints.push("echoes-name");
    else if ((tag === "param" || tag === "typeparam") && attr && echoes(body, attr)) hints.push(`echoes:${label}`);
  }
  if (decl) hints.push(decl.visibility);
  return { hints, visibility: decl?.visibility };
}

// Whether the owning project makes XML docs load-bearing: CS1591 as an error breaks the build when a public member
// loses its docs, and a generated XML doc file in a web project usually feeds OpenAPI/Swagger.
interface DocPolicy { project: string; xmlDocs: boolean; cs1591Error: boolean; styleCop: boolean; web: boolean; docsRequired: boolean }
const policyCache = new Map<string, DocPolicy | null>();
function docPolicy(file: string): DocPolicy | null {
  let dir = dirname(file);
  const props: string[] = [];
  let project: string | undefined;
  while (true) {
    const abs = join(root, dir);
    if (existsSync(abs)) {
      const entries = readdirSync(abs);
      if (!project) { const p = entries.find((e) => e.endsWith(".csproj")); if (p) project = join(dir, p); }
      if (entries.includes("Directory.Build.props")) props.push(readFileSync(join(abs, "Directory.Build.props"), "utf8"));
    }
    if (dir === "." || dir === "" || dir === "/") break;
    dir = dirname(dir);
  }
  if (!project) return null;
  if (policyCache.has(project)) return policyCache.get(project)!;
  const text = [readFileSync(join(root, project), "utf8"), ...props].join("\n");
  const editorconfig = existsSync(join(root, ".editorconfig")) ? readFileSync(join(root, ".editorconfig"), "utf8") : "";
  const xmlDocs = /<GenerateDocumentationFile>\s*true/i.test(text) || /<DocumentationFile>\s*\S/i.test(text);
  const suppressed = /<NoWarn>[^<]*\b(CS)?1591\b/i.test(text) || /dotnet_diagnostic\.CS1591\.severity\s*=\s*(none|silent|suggestion)/i.test(editorconfig);
  const cs1591Error = !suppressed && (/<TreatWarningsAsErrors>\s*true/i.test(text) || /<WarningsAsErrors>[^<]*\b(CS)?1591\b/i.test(text) || /dotnet_diagnostic\.CS1591\.severity\s*=\s*error/i.test(editorconfig));
  const policy: DocPolicy = {
    project, xmlDocs, cs1591Error,
    styleCop: /StyleCop\.Analyzers/i.test(text),
    web: /Sdk="Microsoft\.NET\.Sdk\.Web"|Swashbuckle|NSwag|Microsoft\.AspNetCore\.OpenApi/i.test(text),
    docsRequired: xmlDocs && cs1591Error,
  };
  policyCache.set(project, policy);
  return policy;
}

// ---- diff parsing ----

interface Hunk { file: string; newStart: number; header: string; added: string[] }
function parseDiff(text: string): Hunk[] {
  const hunks: Hunk[] = [];
  let file: string | null = null, cur: Hunk | null = null;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) { file = null; cur = null; continue; }
    if (!cur && raw.startsWith("+++ ")) { file = raw === "+++ /dev/null" ? null : raw.slice(6); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) { cur = file ? { file, newStart: Number(h[1]), header: raw, added: [] } : null; if (cur) hunks.push(cur); continue; }
    if (cur && raw.startsWith("+")) cur.added.push(raw.slice(1));
  }
  return hunks;
}

// ---- scan ----

function resolveRange() {
  const commit = flag("commit");
  if (commit) {
    const sha = git("rev-parse", "--verify", `${commit}^{commit}`).out || die(`Commit not found: ${commit}`);
    const parent = git("rev-parse", "--verify", "--quiet", `${sha}^`);
    return { label: `commit ${sha.slice(0, 10)}`, from: parent.ok ? parent.out : EMPTY_TREE, to: sha, commits: [git("log", "-1", "--format=%h %s", sha).out] };
  }
  const branch = flag("branch") ?? git("branch", "--show-current").out;
  if (!branch) die("No --branch or --commit given and HEAD is detached.");
  const tip = git("rev-parse", "--verify", "--quiet", branch).ok ? branch : `origin/${branch}`;
  if (!git("rev-parse", "--verify", "--quiet", tip).ok) die(`Branch not found: ${branch}`);
  // origin/HEAD is often stale, so pick the candidate base with the fewest commits on the branch.
  let base = flag("base");
  if (!base) {
    const tipSha = git("rev-parse", tip).out;
    let best: { name: string; count: number } | undefined;
    for (const c of ["origin/dev", "origin/develop", "origin/main", "origin/master", "dev", "develop", "main", "master"]) {
      if (!git("rev-parse", "--verify", "--quiet", c).ok || git("rev-parse", c).out === tipSha) continue;
      const n = Number(git("rev-list", "--count", `${c}..${tip}`).out);
      if (!best || n < best.count) best = { name: c, count: n };
    }
    base = best?.name;
  }
  if (!base) die("No base branch found; pass --base.");
  const mergeBase = git("merge-base", base, tip).out || die(`No merge-base between ${base} and ${tip}.`);
  return { label: `branch ${branch} vs ${base} (merge-base ${mergeBase.slice(0, 10)})`, from: mergeBase, to: tip, commits: git("log", "--format=%h %s", `${mergeBase}..${tip}`).out.split("\n").filter(Boolean) };
}

function scan() {
  const range = resolveRange();
  const hunks = parseDiff(git("diff", "-U0", "--no-color", "--no-ext-diff", "-M", range.from, range.to).out);
  const blocks: Block[] = [];
  const skipped = new Set<string>(), generated = new Set<string>();
  const includeGenerated = args.includes("--include-generated");
  const infoCache = new Map<string, LineInfo[] | null>();
  const infoAt = (f: string, s: Syntax) => {
    if (!infoCache.has(f)) { const t = showAt(range.to, f); infoCache.set(f, t === null ? null : analyze(t, s)); }
    return infoCache.get(f)!;
  };

  for (const h of hunks) {
    if (!includeGenerated && GENERATED.test(h.file)) { if (h.added.length) generated.add(h.file); continue; }
    const s = syntaxFor(h.file);
    if (!s) { if (h.added.length) skipped.add(h.file); continue; }
    const info = infoAt(h.file, s);
    if (!info) continue;
    let cur: Block | null = null;
    h.added.forEach((text, idx) => {
      const lineNo = h.newStart + idx;
      const li = info[lineNo - 1];
      const comment = li?.comment.trim() ?? "", code = li?.code.trim() ?? "";
      if (!comment) { cur = null; return; }
      const kind: Kind = DIRECTIVE.test(comment) ? "directive" : code ? "inline" : li.doc ? "doc" : "comment";
      const lc = kind !== "directive" && kind !== "doc" && LOOKS_LIKE_CODE.test(commentBody(comment));
      if (cur && cur.kind === kind && kind !== "inline" && cur.looksLikeCode === lc && cur.end === lineNo - 1) {
        cur.end = lineNo; cur.lines.push(text);
      } else {
        cur = { file: h.file, start: lineNo, end: lineNo, kind, lines: [text], looksLikeCode: lc, present: false, hints: [] };
        blocks.push(cur);
      }
    });
  }

  const workingTree = new Map<string, Set<string>>();
  for (const b of blocks) {
    if (!workingTree.has(b.file)) {
      const p = join(root, b.file);
      workingTree.set(b.file, new Set(existsSync(p) ? readFileSync(p, "utf8").split("\n").map((l) => l.trim()) : []));
    }
    b.present = b.lines.every((l) => workingTree.get(b.file)!.has(l.trim()));
    if (syntaxFor(b.file)?.lang !== "cs") continue;
    if (b.kind === "comment" && b.lines.some((l) => TEST_MARKER.test(l.trim()))) b.hints.push("test-marker");
    if (b.kind !== "doc") continue;
    const info = infoAt(b.file, CSHARP)!;
    const decl = info.slice(b.end).find((li) => li.code.trim() && !/^\[.*\]$/.test(li.code.trim()))?.code;
    const { hints, visibility } = docHints(b.lines, decl);
    b.hints.push(...hints);
    const policy = docPolicy(b.file);
    if (policy && visibility !== "non-public") {
      if (policy.docsRequired) b.hints.push("docs-required-by-build");
      if (policy.xmlDocs && policy.web) b.hints.push("may-feed-openapi");
    }
  }
  const policies = [...policyCache.values()].filter(Boolean) as DocPolicy[];

  const headSha = git("rev-parse", "HEAD").out;
  const toSha = git("rev-parse", range.to).out;
  const dirty = git("status", "--porcelain", "--untracked-files=no").out.split("\n").filter(Boolean);
  const exactLines = headSha === toSha && dirty.length === 0;
  const counts = Object.fromEntries((["comment", "doc", "inline", "directive"] as Kind[]).map((k) => [k, blocks.filter((b) => b.kind === k).length]));
  const report = { range: range.label, from: range.from, to: range.to, commits: range.commits, headIsTarget: headSha === toSha, dirtyFiles: dirty, exactLines, counts, csharpProjects: policies, skippedFiles: [...skipped], generatedFiles: [...generated], blocks };

  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`Range:   ${range.label}\nCommits: ${range.commits.length}`);
  range.commits.slice(0, 20).forEach((c) => console.log(`  ${c}`));
  if (range.commits.length > 20) console.log(`  … ${range.commits.length - 20} more`);
  console.log(`Working tree: ${dirty.length ? `DIRTY (${dirty.length} file(s))` : "clean"}; HEAD ${headSha === toSha ? "is" : "is NOT"} the scanned tip; line numbers ${exactLines ? "exact" : "approximate, locate by text"}`);
  console.log(`Added comment blocks: ${counts.comment} comment, ${counts.doc} doc, ${counts.inline} inline, ${counts.directive} directive (keep directives)`);
  if (policies.length) {
    console.log("\nC# doc policy (projects owning the scanned doc comments):");
    for (const p of policies) console.log(`  ${p.project}: XML docs ${p.xmlDocs ? "on" : "off"}, CS1591 ${p.cs1591Error ? "is an ERROR" : "not an error"}${p.styleCop ? ", StyleCop" : ""}${p.web ? ", web/OpenAPI project" : ""}${p.docsRequired ? " → public docs REQUIRED" : ""}`);
  }
  let lastFile = "";
  for (const b of blocks) {
    if (b.file !== lastFile) { console.log(`\n${b.file}`); lastFile = b.file; }
    const tags = [b.kind, b.looksLikeCode ? "looks-like-code" : "", ...b.hints, b.present ? "" : "GONE-from-working-tree"].filter(Boolean).join(", ");
    console.log(`  L${b.start}${b.end > b.start ? `-${b.end}` : ""} [${tags}]`);
    b.lines.forEach((l) => console.log(`    ${l}`));
  }
  if (generated.size) console.log(`\nGenerated files, not scanned (--include-generated to scan): ${[...generated].join(", ")}`);
  if (skipped.size) console.log(`\nUnsupported file types, not scanned: ${[...skipped].join(", ")}`);
}

// ---- verify ----

// Compares the code of each changed file, whole file before vs after with comments stripped, so text inside a
// multi-line string can never pass as a removed comment.
function verify() {
  const against = flag("against") ?? "HEAD";
  if (!git("rev-parse", "--verify", "--quiet", against).ok) die(`Ref not found: ${against}`);
  const changes = git("diff", "--name-status", "-M", "--no-color", against).out.split("\n").filter(Boolean).map((l) => {
    const p = l.split("\t");
    return { status: p[0], oldPath: p[1], newPath: p[p.length - 1] };
  });
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const violations: { file: string; reason: string; line?: number; before?: string; after?: string }[] = [];
  let commentLinesBefore = 0, commentLinesAfter = 0;
  for (const c of changes) {
    const s = syntaxFor(c.newPath);
    if (!s) { violations.push({ file: c.newPath, reason: "unsupported file type, cannot prove only comments changed; review by hand" }); continue; }
    if (c.status === "D") { violations.push({ file: c.oldPath, reason: "file deleted" }); continue; }
    const before = c.status.startsWith("A") ? "" : showAt(against, c.oldPath) ?? "";
    const after = readFileSync(join(root, c.newPath), "utf8");
    const lines = (t: string) => analyze(t, s).map((li, n) => ({ n: n + 1, code: norm(li.code), comment: norm(li.comment) }));
    const a = lines(before), b = lines(after);
    commentLinesBefore += a.filter((x) => x.comment && !x.code).length;
    commentLinesAfter += b.filter((x) => x.comment && !x.code).length;
    const ac = a.filter((x) => x.code), bc = b.filter((x) => x.code);
    let k = 0;
    while (k < ac.length && k < bc.length && ac[k].code === bc[k].code) k++;
    if (k < ac.length || k < bc.length) violations.push({ file: c.newPath, reason: "code changed", line: bc[k]?.n ?? ac[k]?.n, before: ac[k]?.code ?? "(nothing)", after: bc[k]?.code ?? "(nothing)" });
  }
  const untracked = git("ls-files", "--others", "--exclude-standard").out.split("\n").filter(Boolean);
  const report = { against, files: changes.map((c) => c.newPath), commentLinesRemoved: commentLinesBefore - commentLinesAfter, untracked, ok: violations.length === 0, violations };
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Working tree vs ${against}: ${changes.length} file(s) changed; full comment lines ${commentLinesBefore} → ${commentLinesAfter}`);
    if (untracked.length) console.log(`Note: ${untracked.length} untracked file(s) not checked.`);
    if (!violations.length) console.log("OK: only comments and whitespace changed.");
    for (const v of violations) {
      console.log(`\nVIOLATION ${v.file}${v.line ? `:${v.line}` : ""}\n  ${v.reason}`);
      if (v.before !== undefined) console.log(`  first difference, before: ${v.before}\n                    after:  ${v.after}`);
    }
  }
  process.exit(violations.length ? 1 : 0);
}

mode === "scan" ? scan() : verify();
