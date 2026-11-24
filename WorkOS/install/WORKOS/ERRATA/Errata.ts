#!/usr/bin/env bun
/**
 * Errata.ts — the WorkOS complaint ledger CLI (Errata-lite).
 *
 *   bun WORKOS/ERRATA/Errata.ts record --text "<the principal's words>" [--kind complaint|bug|feature-request|correction|praise|question]
 *        [--skill <Name>] [--artifact <file>] [--requested "<the ask in flight>"] [--doing "<what the system was doing>"]
 *        [--isa <path>] [--session <id>] [--rating <1-10>] [--tag <t>]... [--json]
 *   bun WORKOS/ERRATA/Errata.ts list [--kind K] [--status S] [--skill <Name>] [--since YYYY-MM-DD] [--limit N] [--unenriched] [--json]
 *   bun WORKOS/ERRATA/Errata.ts show <ERR-id> [--json]
 *   bun WORKOS/ERRATA/Errata.ts stats
 *   bun WORKOS/ERRATA/Errata.ts enrich [--limit N]
 *   bun WORKOS/ERRATA/Errata.ts skills [--since YYYY-MM-DD] [--json]
 *   bun WORKOS/ERRATA/Errata.ts misses [--json]
 *   bun WORKOS/ERRATA/Errata.ts impact --skill <Name> --since YYYY-MM-DD [--days 14] [--json]
 *
 * The ledger (Schema.ts, Store.ts) is upstream 8.761.0's: one JSON line per erratum or patch in
 * WORKOS/USER/ERRATA/errata-YYYY-MM.jsonl, verbatim at capture, enriched later by a model, never rewritten.
 * What WorkOS adds, because it has no output ledger:
 *   - A complaint is attributed to a skill by `--skill` (stored as the tag `skill:<Name>`), and a skill's
 *     outputs are its Skill-tool calls in WORKOS/MEMORY/SKILLS/execution.jsonl (hooks/EventLogger.hook.ts).
 *     `skills` and `impact` read complaint rate as complaints per call.
 *   - A complaint filed with `--artifact` against a file whose Proof receipt is fresh and presentable is a
 *     false pass: Proof said it could be shown and the principal found it wrong. It is tagged `false-pass`.
 * `misses` returns no retire candidates: WorkOS keeps no dismissal record to find them from.
 * Not ported: automatic capture from the conversation, trained triage, mining past sessions, sending upstream.
 *
 * Exit: 0 ok · 1 not found or refused · 2 usage.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { workosPath } from "../TOOLS/Paths";
import { ErrataStore } from "./Store";
import { enrichPending } from "./Enrich";
import { KINDS, type Erratum, type Kind } from "./Schema";

/** Kinds that count toward a complaint rate. Praise, questions and feature requests do not. */
export const COMPLAINT_KINDS: ReadonlySet<string> = new Set(["complaint", "bug", "correction", "incident"]);
const DAY_MS = 86_400_000;

export const executionFile = (): string => process.env.ERRATA_EXECUTION_FILE ?? workosPath("MEMORY", "SKILLS", "execution.jsonl");

export function skillOf(e: Erratum): string | null {
  const tag = e.tags.find((t) => t.startsWith("skill:"));
  return tag ? tag.slice(6) : null;
}

/** Skill-tool calls by skill name, each with its timestamp. A torn or foreign line is skipped. */
export function loadCalls(path = executionFile()): { skill: string; ts: number }[] {
  if (!existsSync(path)) return [];
  const out: { skill: string; ts: number }[] = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    try {
      const j = JSON.parse(raw) as { skill?: unknown; ts?: unknown };
      const ts = typeof j.ts === "string" ? Date.parse(j.ts) : NaN;
      if (typeof j.skill === "string" && j.skill && Number.isFinite(ts)) out.push({ skill: j.skill.replace(/^.*:/, ""), ts });
    } catch { /* torn line */ }
  }
  return out;
}

export interface SkillRow { skill: string; outputs: number; complaints: number; rate: number | null; false_passes: number }

/** Per-skill complaint rate in [from, to): complaints over Skill-tool calls. A skill with no calls has rate null. */
export function skillRows(rows: Erratum[], calls: { skill: string; ts: number }[], from = 0, to = Infinity): SkillRow[] {
  const acc = new Map<string, SkillRow>();
  const get = (s: string) => acc.get(s) ?? (acc.set(s, { skill: s, outputs: 0, complaints: 0, rate: null, false_passes: 0 }), acc.get(s)!);
  for (const c of calls) if (c.ts >= from && c.ts < to) get(c.skill).outputs++;
  for (const e of rows) {
    const s = skillOf(e); const t = Date.parse(e.ts);
    if (!s || !(t >= from && t < to) || !COMPLAINT_KINDS.has(e.kind)) continue;
    const r = get(s); r.complaints++;
    if (e.tags.includes("false-pass")) r.false_passes++;
  }
  for (const r of acc.values()) r.rate = r.outputs ? Math.round((r.complaints / r.outputs) * 10_000) / 10_000 : null;
  return [...acc.values()].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.complaints - a.complaints || a.skill.localeCompare(b.skill));
}

export interface ImpactWindow { from: string; to: string; outputs: number; complaints: number; rate: number | null }
export interface Impact { skill: string; since: string; days: number; before: ImpactWindow; after: ImpactWindow; delta: number | null; verdict: "lower" | "higher" | "unchanged" | "insufficient-data" }

/** Complaint rate per call for `days` before vs `days` from `since` (the after window capped at now). Read-only. */
export function impact(rows: Erratum[], calls: { skill: string; ts: number }[], skill: string, since: Date, days = 14, now = new Date()): Impact {
  const s = since.getTime();
  const win = (from: number, to: number): ImpactWindow => {
    const r = skillRows(rows, calls, from, to).find((x) => x.skill === skill);
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), outputs: r?.outputs ?? 0, complaints: r?.complaints ?? 0, rate: r?.rate ?? null };
  };
  const before = win(s - days * DAY_MS, s);
  const after = win(s, Math.min(s + days * DAY_MS, Math.max(now.getTime(), s)));
  const delta = before.rate !== null && after.rate !== null ? Math.round((after.rate - before.rate) * 10_000) / 10_000 : null;
  return { skill, since: since.toISOString(), days, before, after, delta, verdict: delta === null ? "insufficient-data" : delta < 0 ? "lower" : delta > 0 ? "higher" : "unchanged" };
}

export function falsePasses(rows: Erratum[]): Record<string, unknown>[] {
  return rows.filter((e) => e.tags.includes("false-pass")).map((e) => ({
    id: e.id, ts: e.ts, skill: skillOf(e), artifact: e.attachments[0] ?? null,
    receipt: e.tags.find((t) => t.startsWith("proof:"))?.slice(6) ?? null, complaint: e.complaint.slice(0, 300),
  }));
}

/** The Proof receipt verdict for an artifact as it is now, or null when Proof is absent or has no fresh receipt. */
async function proofOf(artifact: string): Promise<{ presentable: boolean; sha: string } | null> {
  try {
    const { verifyArtifact } = await import("../../skills/Assay/Tools/Proof.ts");
    const v = verifyArtifact(artifact);
    if (v.freshness !== "fresh" || !v.receipt) return null;
    return { presentable: v.presentable, sha: v.receipt.artifact.sha256 };
  } catch { return null; }
}

const LEADING_KINDS: [RegExp, Kind][] = [
  [/^bug:\s*/i, "bug"], [/^(?:feature|feat):\s*/i, "feature-request"], [/^praise:\s*/i, "praise"],
  [/^(?:question|q):\s*/i, "question"], [/^incident:\s*/i, "incident"], [/^correction:\s*/i, "correction"],
];
/** `bug: the thing broke` → kind bug, text "the thing broke"; null when the text carries no leading tag. */
export function leadingKind(raw: string): { kind: Kind; text: string } | null {
  const t = raw.trim();
  for (const [re, kind] of LEADING_KINDS) if (re.test(t)) return { kind, text: t.replace(re, "").trim() };
  return null;
}

const argVal = (a: string[], f: string) => { const i = a.indexOf(f); return i >= 0 && a[i + 1] !== undefined ? a[i + 1] : undefined; };
const argAll = (a: string[], f: string) => a.flatMap((x, i) => (x === f && a[i + 1] !== undefined ? [a[i + 1]] : []));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function line(e: Erratum): string {
  const skill = skillOf(e);
  return `${e.id}  ${e.ts.slice(0, 16).replace("T", " ")}  ${e.kind.padEnd(15)} ${e.status.padEnd(9)} ${skill ? `[${skill}] ` : ""}${e.complaint.replace(/\s+/g, " ").slice(0, 100)}`;
}

export async function main(argv: string[], store = new ErrataStore()): Promise<number> {
  const [cmd, ...args] = argv;
  const json = args.includes("--json");
  switch (cmd) {
    case "record": {
      const raw = argVal(args, "--text");
      if (!raw?.trim()) { console.error("record needs --text \"<the principal's words>\""); return 2; }
      // A leading kind tag (`bug: …`) sets the kind when --kind is absent and is the only text removed.
      const tagged = argVal(args, "--kind") === undefined ? leadingKind(raw) : null;
      const text = tagged ? tagged.text : raw.trim();
      const kind = (argVal(args, "--kind") ?? tagged?.kind ?? "complaint") as Kind;
      if (!text) { console.error("record needs words after the kind tag"); return 2; }
      if (!(KINDS as readonly string[]).includes(kind)) { console.error(`--kind must be one of ${KINDS.join(", ")}`); return 2; }
      const ratingRaw = argVal(args, "--rating");
      const rating = ratingRaw === undefined ? null : Number(ratingRaw);
      if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 10)) { console.error("--rating is an integer 1-10 the principal gave"); return 2; }
      const skill = argVal(args, "--skill");
      if (skill !== undefined && !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(skill)) { console.error("--skill is a skill directory name"); return 2; }
      const tags = argAll(args, "--tag");
      const attachments: string[] = [];
      const artifact = argVal(args, "--artifact");
      if (artifact) {
        const abs = resolve(artifact);
        if (!existsSync(abs)) { console.error(`no such artifact: ${artifact}`); return 2; }
        attachments.push(abs);
        const proof = await proofOf(abs);
        if (proof?.presentable && COMPLAINT_KINDS.has(kind)) tags.push("false-pass", `proof:${proof.sha.slice(0, 12)}`);
      }
      if (skill) tags.push(`skill:${skill}`);
      const e = store.append({
        system: "workos", source: "principal", channel: "er-command", kind, complaint: text, rating,
        reporter: { id: "principal", role: "principal" },
        context: {
          requested: argVal(args, "--requested") ?? null, doing: argVal(args, "--doing") ?? null,
          isa: argVal(args, "--isa") ?? null, session_id: argVal(args, "--session") ?? process.env.CLAUDE_SESSION_ID ?? null,
          component: skill ? `skills/${skill}` : null, cwd: process.cwd(),
        },
        attachments, tags: [...new Set(tags)],
      });
      if (!e) { console.error("not recorded: machine text, or the same words were already filed today"); return 1; }
      console.log(json ? JSON.stringify(e) : `recorded ${e.id} (${e.kind}${skill ? `, ${skill}` : ""})${e.tags.includes("false-pass") ? "\nfalse pass: its Proof receipt said presentable" : ""}`);
      return 0;
    }
    case "list": {
      const since = argVal(args, "--since");
      if (since && !DATE_RE.test(since)) { console.error("--since must be YYYY-MM-DD"); return 2; }
      const skill = argVal(args, "--skill");
      let rows = store.list({
        kind: argVal(args, "--kind"), status: argVal(args, "--status"), since,
        enriched: args.includes("--unenriched") ? false : undefined,
      });
      if (skill) rows = rows.filter((e) => skillOf(e) === skill);
      const limit = argVal(args, "--limit");
      if (limit) rows = rows.slice(-Number(limit));
      if (json) console.log(JSON.stringify(rows));
      else if (!rows.length) console.log("no entries");
      else for (const e of rows) console.log(line(e));
      return 0;
    }
    case "show": {
      const e = store.get(args[0] ?? "");
      if (!e) { console.error("not found"); return 1; }
      if (json) { console.log(JSON.stringify(e)); return 0; }
      console.log(`${line(e)}\n\n${e.complaint}\n`);
      for (const [k, v] of Object.entries(e.context)) if (v) console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
      if (e.tags.length) console.log(`tags: ${e.tags.join(", ")}`);
      if (e.attachments.length) console.log(`attachments: ${e.attachments.join(", ")}`);
      if (e.enrichment) console.log(`enrichment (${e.enrichment.model}): ${e.enrichment.class} · upset ${e.enrichment.how_upset} · ${e.enrichment.what_upset} · fix: ${e.enrichment.proposed_fix}`);
      return 0;
    }
    case "stats":
      console.log(JSON.stringify(store.stats(), null, 2));
      return 0;
    case "enrich": {
      const limit = argVal(args, "--limit");
      try { console.log(JSON.stringify(await enrichPending(store, limit ? { limit: Number(limit) } : {}))); return 0; }
      catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 1; }
    }
    case "skills": {
      const since = argVal(args, "--since");
      if (since !== undefined && !DATE_RE.test(since)) { console.error("skills --since must be YYYY-MM-DD"); return 2; }
      const rows = skillRows(store.all(), loadCalls(), since ? Date.parse(`${since}T00:00:00Z`) : 0);
      if (json) console.log(JSON.stringify(rows, null, 2));
      else if (!rows.length) console.log("no skill calls or attributed complaints");
      else for (const r of rows) console.log(`${r.skill.padEnd(24)} ${String(r.outputs).padStart(5)} calls  ${String(r.complaints).padStart(3)} complaints  rate ${r.rate === null ? "n/a" : `${(r.rate * 100).toFixed(1)}%`}  ${r.false_passes} false passes`);
      return 0;
    }
    case "misses": {
      const fp = falsePasses(store.all());
      if (json) console.log(JSON.stringify({ false_passes: fp, retire_candidates: [] }, null, 2));
      else console.log(fp.length ? fp.map((f) => `${f.id} [${f.skill ?? "unattributed"}] ${f.artifact}: ${f.complaint}`).join("\n") : "no false passes");
      return 0;
    }
    case "impact": {
      const skill = argVal(args, "--skill"); const since = argVal(args, "--since");
      const days = argVal(args, "--days") === undefined ? 14 : Number(argVal(args, "--days"));
      if (!skill || !since || !DATE_RE.test(since) || !Number.isInteger(days) || days < 1) { console.error("impact requires --skill <Name> --since YYYY-MM-DD [--days N]"); return 2; }
      const r = impact(store.all(), loadCalls(), skill, new Date(`${since}T00:00:00Z`), days);
      if (json) console.log(JSON.stringify(r, null, 2));
      else {
        const w = (n: string, x: ImpactWindow) => `${n.padEnd(7)} ${x.from.slice(0, 10)} .. ${x.to.slice(0, 10)}  ${x.outputs} calls, ${x.complaints} complaints, rate ${x.rate === null ? "n/a" : `${(x.rate * 100).toFixed(1)}%`}`;
        console.log([`impact for ${r.skill} since ${r.since.slice(0, 10)} (${r.days}-day windows)`, w("before", r.before), w("after", r.after), `delta: ${r.delta === null ? "n/a" : `${(r.delta * 100).toFixed(1)} points`} (${r.verdict})`].join("\n"));
      }
      return 0;
    }
    default:
      console.error("usage: Errata.ts record|list|show|stats|enrich|skills|misses|impact (see header)");
      return 2;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
