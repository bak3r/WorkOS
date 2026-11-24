#!/usr/bin/env bun
/**
 * GenerateManifest — maintainer tool. Hashes a release payload into a manifest next to this
 * file: an upstream LifeOS release (`lifeos-<version>.sha256`, what Inventory classifies
 * LifeOS copies against) or a WorkOS release (`workos-<version>.sha256`, what OverlaySystem
 * uses to tell an untouched older WorkOS file from one the developer edited). It never writes
 * anywhere but --out.
 *
 *   bun Tools/data/GenerateManifest.ts --src <LifeOS repo root> [--out <file>]
 *   bun Tools/data/GenerateManifest.ts --workos <WorkOS repo root> [--out <file>]
 *
 * A WorkOS manifest uses the same two key forms (WorkOS/<X> → <root>/skills/WorkOS/<X>) and
 * WorkOS's own placeholders. It leaves out the manifests themselves (Tools/data/*.sha256),
 * so a release can carry its own.
 *
 * Keys are PAYLOAD paths; Inventory maps them onto a config root:
 *   install/<X>   → <root>/<X>                   (what DeployCore/InstallHooks/... copy)
 *   LifeOS/<X>    → <root>/skills/LifeOS/<X>     (what install.sh copies; LifeOS/install/**
 *                                                  is the same bytes as install/**, so it is
 *                                                  not listed twice)
 * install/USER/** is listed (it rides along inside skills/LifeOS/install/); its own target,
 * the LifeOS data home, is outside the root and never classified.
 *
 * Line formats:
 *   <sha256>  <payload path>                          one per file (raw bytes)
 *   T\t<payload path>\t<tok,tok,...>\t<seg>,<seg>,...  files carrying identity placeholders;
 *       seg = <byte length>:<sha256 first 16 hex>:<first ≤8 bytes hex>. Lets Inventory
 *       recognise a substituted copy ({{PRINCIPAL_NAME}} → "Dana") without the text.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export const LIFEOS_TOKENS = [
  "{{DA_NAME}}", "{{DA_FULL_NAME}}", "{{PRINCIPAL_NAME}}", "{{PRINCIPAL_FULL_NAME}}",
  "{{PRIMARY_VOICE_ID}}", "{{SECONDARY_VOICE_ID}}", "{{LIFEOS_VERSION}}",
];
const SKIP = new Set([".git", "node_modules", ".DS_Store"]);

function sha(b: Buffer | Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

export const WORKOS_TOKENS = ["{{PRINCIPAL_NAME}}", "{{PRINCIPAL_FULL_NAME}}", "{{DA_NAME}}", "{{DA_FULL_NAME}}", "{{WORKOS_VERSION}}"];

function* walk(dir: string, skipRel: (rel: string) => boolean, base = dir): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    const rel = relative(base, p);
    if (skipRel(rel)) continue;
    if (e.isDirectory()) yield* walk(p, skipRel, base);
    else if (e.isFile()) yield rel;
  }
}

export function templateLine(payloadPath: string, buf: Buffer, tokens: string[] = LIFEOS_TOKENS): string | null {
  const text = buf.toString("latin1"); // byte-preserving: offsets below are byte offsets
  const re = new RegExp(tokens.map((t) => t.replace(/[{}]/g, "\\$&")).join("|"), "g");
  const toks: string[] = [];
  const segs: string[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    segs.push(text.slice(last, m.index));
    toks.push(m[0]);
    last = m.index! + m[0].length;
  }
  if (toks.length === 0) return null;
  segs.push(text.slice(last));
  const enc = segs.map((s) => {
    const b = Buffer.from(s, "latin1");
    return `${b.length}:${sha(b).slice(0, 16)}:${b.subarray(0, 8).toString("hex")}`;
  });
  return `T\t${payloadPath}\t${toks.join(",")}\t${enc.join(",")}`;
}

const isManifest = (rel: string) => /(^|\/)Tools\/data\/[^/]+\.sha256$/.test(rel);

function main(): void {
  const a = process.argv.slice(2);
  const get = (f: string) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  const src = get("--src");
  const wsrc = get("--workos");
  const product = wsrc ? "WorkOS" : "LifeOS";
  const root = wsrc ?? src;
  if (!root || !existsSync(join(root, product, "install"))) {
    console.error("usage: bun GenerateManifest.ts --src <LifeOS repo root> | --workos <WorkOS repo root> [--out <file>]");
    process.exit(1);
  }
  const skill = join(root, product);
  const tokens = wsrc ? WORKOS_TOKENS : LIFEOS_TOKENS;
  const skip = wsrc ? isManifest : () => false;
  const version = readFileSync(join(skill, "install", product.toUpperCase(), "VERSION"), "utf8").trim();
  const out = get("--out") || join(import.meta.dir, `${product.toLowerCase()}-${version}.sha256`);
  const lines: string[] = [];
  const tlines: string[] = [];
  const add = (payloadPath: string, file: string) => {
    const buf = readFileSync(file);
    lines.push(`${sha(buf)}  ${payloadPath}`);
    const t = templateLine(payloadPath, buf, tokens);
    if (t) tlines.push(t);
  };
  // install/USER/** is listed too: install.sh copies it inside skills/<product>/install/.
  for (const rel of walk(join(skill, "install"), skip)) {
    add(`install/${rel}`, join(skill, "install", rel));
  }
  for (const rel of walk(skill, (r) => r === "install" || r.startsWith("install/") || skip(r))) {
    add(`${product}/${rel}`, join(skill, rel));
  }
  lines.sort();
  tlines.sort();
  writeFileSync(out, [
    `# ${product} ${version} payload manifest — generated by Tools/data/GenerateManifest.ts. Do not edit by hand.`,
    `# version ${version}`,
    ...lines,
    ...tlines,
    "",
  ].join("\n"));
  console.log(JSON.stringify({ ok: true, version, out, files: lines.length, templated: tlines.length }));
}

if (import.meta.main) main();
