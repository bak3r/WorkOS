/**
 * Cortex Ledger port (Cortex 8.4.0) — behaviour the WorkOS port must keep.
 *
 * Every scenario that touches memory runs in a child `bun` process with its own HOME and
 * CLAUDE_CONFIG_DIR under a fresh temp directory: MemoryWriter resolves its allowlist and the
 * user-data boundary at import time, so an isolated process is the only way to be sure no
 * scenario can reach the real ~/.claude. The lock-fallback tests run in-process because
 * LedgerCore resolves nothing from the environment.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fallbackLockPath,
  kernelLockMode,
  libcCandidates,
  setFlockUnavailableForTests,
  withKernelLock,
} from "./lib/LedgerCore";

const TOOLS = import.meta.dir;
const PRINCIPAL_REL = "WORKOS/USER/PRINCIPAL/PRINCIPAL_MEMORY.md";
const DA_REL = "WORKOS/USER/DIGITAL_ASSISTANT/DA_MEMORY.md";
const EVENTS_REL = "WORKOS/MEMORY/LEDGER/cortex-events.jsonl";

const sandboxes: string[] = [];
afterEach(() => {
  setFlockUnavailableForTests(false);
  while (sandboxes.length > 0) rmSync(sandboxes.pop()!, { recursive: true, force: true });
});

/** A memory file in the shape WorkOS 1.0.2 ships (template frontmatter, marker pair). */
function memoryFile(title: string, entries: string[]): string {
  return [
    "---",
    "provenance: template",
    "schema_version: 1",
    "cap_entries: 48",
    "cap_chars_per_entry: 256",
    "last_updated: 2026-01-01",
    "last_updated_by: bootstrap-template",
    "convention: pai-freshness-v1",
    "---",
    "",
    `# ${title}`,
    "",
    "<!-- BEGIN ENTRIES -->",
    ...entries,
    "<!-- END ENTRIES -->",
    "",
  ].join("\n");
}

function entries(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `PREFERENCE: ${prefix} fact number ${i + 1} ~explicit`);
}

interface Sandbox { home: string; claude: string; userData: string }

/** HOME with ~/.config/WORKOS/USER as the real user-data tree and ~/.claude/WORKOS/USER linked to it. */
function sandbox(seed: { principal?: string[]; da?: string[] } = { principal: entries("principal", 5), da: entries("assistant", 3) }): Sandbox {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "workos-cortex-ledger-test-")));
  sandboxes.push(home);
  const userData = join(home, ".config/WORKOS/USER");
  const claude = join(home, ".claude");
  mkdirSync(join(userData, "PRINCIPAL"), { recursive: true });
  mkdirSync(join(userData, "DIGITAL_ASSISTANT"), { recursive: true });
  mkdirSync(join(claude, "WORKOS/MEMORY"), { recursive: true });
  symlinkSync(userData, join(claude, "WORKOS/USER"));
  if (seed.principal) writeFileSync(join(userData, "PRINCIPAL/PRINCIPAL_MEMORY.md"), memoryFile("Principal Hot-Layer Memory", seed.principal));
  if (seed.da) writeFileSync(join(userData, "DIGITAL_ASSISTANT/DA_MEMORY.md"), memoryFile("DA Hot-Layer Memory", seed.da));
  return { home, claude, userData };
}

/** Run `body` (an async function body with the ported modules in scope) in an isolated child; returns its JSON. */
function inSandbox(sb: Sandbox, body: string): any {
  const script = `
    const W = await import(${JSON.stringify(join(TOOLS, "MemoryWriter.ts"))});
    const L = await import(${JSON.stringify(join(TOOLS, "CortexLedger.ts"))});
    const C = await import(${JSON.stringify(join(TOOLS, "lib/CortexLedgerCore.ts"))});
    const P = (rel) => ${JSON.stringify(sb.claude)} + "/" + rel;
    const out = await (async () => { ${body} })();
    process.stdout.write(JSON.stringify(out));
  `;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(CLAUDE_|WORKOS_|CORTEX_|GIT_)/.test(k)) continue; // nothing may point the child at another tree
    env[k] = v;
  }
  env.HOME = sb.home;
  env.CLAUDE_CONFIG_DIR = sb.claude;
  const r = Bun.spawnSync(["bun", "-e", script], { env, cwd: sb.home, stdout: "pipe", stderr: "pipe" });
  const stderr = r.stderr.toString();
  if (r.exitCode !== 0) throw new Error(`sandbox child failed (${r.exitCode}): ${stderr}`);
  return JSON.parse(r.stdout.toString());
}

function ledgerRows(sb: Sandbox): any[] {
  const p = join(sb.claude, EVENTS_REL);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
}

describe("Cortex ledger: append, verify, tamper detection", () => {
  test("a write appends a hash-chained event before the file and verify holds", () => {
    const sb = sandbox();
    const out = inSandbox(sb, `
      const before = W.read(P(${JSON.stringify(PRINCIPAL_REL)}));
      const res = W.setEntries(P(${JSON.stringify(PRINCIPAL_REL)}), [...before.entries, "RULE: ledger test rule ~explicit"], { updatedBy: "test" });
      return { res, verify: L.verifyAll() };
    `);
    expect(out.res.ok).toBe(true);
    expect(out.res.additions).toEqual(["RULE: ledger test rule ~explicit"]);
    expect(out.verify.status).toBe("ok");
    const rows = ledgerRows(sb);
    // Anchor (both pre-ledger files) then the write itself.
    expect(rows.map((r) => r.kind)).toEqual(["checkpoint", "memory/set"]);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows[0].prev_row_hash).toBe("genesis");
    expect(rows[1].prev_row_hash).toBe(rows[0].row_hash);
    // The file is a byte copy of the event's content.
    expect(readFileSync(join(sb.claude, PRINCIPAL_REL), "utf8")).toBe(rows[1].content);
  });

  test("editing one row breaks the chain and verify reports CRITICAL", () => {
    const sb = sandbox();
    inSandbox(sb, `
      const before = W.read(P(${JSON.stringify(PRINCIPAL_REL)}));
      return W.setEntries(P(${JSON.stringify(PRINCIPAL_REL)}), [...before.entries, "RULE: tamper target ~explicit"], { updatedBy: "test" });
    `);
    const p = join(sb.claude, EVENTS_REL);
    const lines = readFileSync(p, "utf8").split("\n").filter((l) => l.length > 0);
    const row = JSON.parse(lines[1]);
    row.additions = ["RULE: something the principal never said ~explicit"];
    lines[1] = JSON.stringify(row);
    writeFileSync(p, lines.join("\n") + "\n");
    const out = inSandbox(sb, `return L.verifyAll();`);
    expect(out.status).toBe("critical");
    expect(out.files[0].detail).toContain("hash-chain break at seq=2");
  });

  test("deleting a row is detected, and a tampered ledger refuses further writes", () => {
    const sb = sandbox();
    inSandbox(sb, `
      const p = P(${JSON.stringify(PRINCIPAL_REL)});
      let e = W.read(p).entries;
      W.setEntries(p, [...e, "RULE: one ~explicit"], { updatedBy: "test" });
      e = W.read(p).entries;
      return W.setEntries(p, [...e, "RULE: two ~explicit"], { updatedBy: "test" });
    `);
    const p = join(sb.claude, EVENTS_REL);
    const lines = readFileSync(p, "utf8").split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(3);
    writeFileSync(p, [lines[0], lines[2]].join("\n") + "\n");
    const out = inSandbox(sb, `
      const verify = L.verifyAll();
      const e = W.read(P(${JSON.stringify(PRINCIPAL_REL)})).entries;
      const write = W.setEntries(P(${JSON.stringify(PRINCIPAL_REL)}), [...e, "RULE: three ~explicit"], { updatedBy: "test" });
      return { verify, write };
    `);
    expect(out.verify.status).toBe("critical");
    expect(out.verify.files[0].detail).toContain("hash-chain break");
    expect(out.write.ok).toBe(false);
    expect(out.write.code).toBe("EWRITE_FAILED");
  });

  test("a torn final line is quarantined by the next write instead of refusing it", () => {
    const sb = sandbox();
    inSandbox(sb, `return W.anchorUnledgered("test");`);
    const p = join(sb.claude, EVENTS_REL);
    writeFileSync(p, readFileSync(p, "utf8") + '{"v":1,"seq":2,"kind":"memory/se');
    const out = inSandbox(sb, `
      const e = W.read(P(${JSON.stringify(PRINCIPAL_REL)})).entries;
      const write = W.setEntries(P(${JSON.stringify(PRINCIPAL_REL)}), [...e, "RULE: after the tear ~explicit"], { updatedBy: "test" });
      return { write, verify: L.verifyAll() };
    `);
    expect(out.write.ok).toBe(true);
    expect(out.verify.status).toBe("ok");
    expect(ledgerRows(sb).map((r) => r.seq)).toEqual([1, 2]);
  });
});

describe("Cortex ledger: adoption of pre-existing memory files", () => {
  test("one labelled anchor row with the current hashes; a second run adds nothing; files untouched", () => {
    const sb = sandbox();
    const principalBefore = readFileSync(join(sb.claude, PRINCIPAL_REL), "utf8");
    const daBefore = readFileSync(join(sb.claude, DA_REL), "utf8");
    const first = inSandbox(sb, `return { anchor: W.anchorUnledgered("test"), verify: L.verifyAll() };`);
    const second = inSandbox(sb, `return { anchor: W.anchorUnledgered("test"), verify: L.verifyAll() };`);

    expect(first.anchor.appended).toEqual([{ seq: 1, kind: "checkpoint", files: [PRINCIPAL_REL, DA_REL] }]);
    expect(second.anchor.appended).toEqual([]);
    expect(first.verify.status).toBe("ok");
    expect(second.verify.status).toBe("ok");

    const rows = ledgerRows(sb);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.kind).toBe("checkpoint");
    expect(row.anchor).toBe(true);
    expect(row.reason).toBe("adopt-pre-ledger-files");
    expect(row.updated_by).toBe("test (adoption anchor)");
    expect(row.files[PRINCIPAL_REL]).toBe(principalBefore);
    expect(row.file_hashes[PRINCIPAL_REL].sha256).toBe(new Bun.CryptoHasher("sha256").update(principalBefore).digest("hex"));
    expect(row.file_hashes[PRINCIPAL_REL].entry_count).toBe(5);
    expect(row.file_hashes[DA_REL].entry_count).toBe(3);
    // No history is invented and no memory file is rewritten.
    expect(readFileSync(join(sb.claude, PRINCIPAL_REL), "utf8")).toBe(principalBefore);
    expect(readFileSync(join(sb.claude, DA_REL), "utf8")).toBe(daBefore);
  });

  test("genesis CLI refuses once anchored, and a write on an anchored ledger adds no second anchor", () => {
    const sb = sandbox();
    const out = inSandbox(sb, `
      const a = W.anchorUnledgered("test");
      const e = W.read(P(${JSON.stringify(PRINCIPAL_REL)})).entries;
      const w = W.setEntries(P(${JSON.stringify(PRINCIPAL_REL)}), [...e, "RULE: after anchor ~explicit"], { updatedBy: "test" });
      return { a, w };
    `);
    expect(out.w.ok).toBe(true);
    const kinds = ledgerRows(sb).map((r) => r.kind);
    expect(kinds).toEqual(["checkpoint", "memory/set"]);
    const env = { ...process.env, HOME: sb.home, CLAUDE_CONFIG_DIR: sb.claude };
    for (const k of Object.keys(env)) if (/^(CLAUDE_PLUGIN_ROOT|WORKOS_|CORTEX_)/.test(k)) delete (env as Record<string, unknown>)[k];
    const g = Bun.spawnSync(["bun", join(TOOLS, "CortexLedger.ts"), "genesis"], { env, stdout: "pipe", stderr: "pipe" });
    expect(g.exitCode).toBe(1);
    expect(g.stderr.toString()).toContain("genesis refused");
    expect(ledgerRows(sb).length).toBe(2);
  });

  test("a file that appears after the anchor gets exactly one adopt row of its own", () => {
    const sb = sandbox({ principal: entries("principal", 4) });
    const first = inSandbox(sb, `return { anchor: W.anchorUnledgered("test"), verify: L.verifyAll() };`);
    expect(first.anchor.appended).toEqual([{ seq: 1, kind: "checkpoint", files: [PRINCIPAL_REL] }]);
    expect(first.anchor.absent).toEqual([DA_REL]);
    expect(first.verify.files.find((f: any) => f.file === DA_REL).status).toBe("absent");
    expect(first.verify.status).toBe("ok");

    writeFileSync(join(sb.userData, "DIGITAL_ASSISTANT/DA_MEMORY.md"), memoryFile("DA Hot-Layer Memory", entries("assistant", 2)));
    const second = inSandbox(sb, `return { anchor: W.anchorUnledgered("test"), verify: L.verifyAll() };`);
    const third = inSandbox(sb, `return W.anchorUnledgered("test");`);
    expect(second.anchor.appended).toEqual([{ seq: 2, kind: "memory/adopt", files: [DA_REL] }]);
    expect(second.verify.status).toBe("ok");
    expect(third.appended).toEqual([]);
    expect(ledgerRows(sb).map((r) => r.kind)).toEqual(["checkpoint", "memory/adopt"]);
  });
});

describe("MemoryWriter guards", () => {
  test("an eroding write is refused, recorded as memory/rejected, and leaves the file alone", () => {
    const sb = sandbox({ principal: entries("principal", 12), da: entries("assistant", 1) });
    const before = readFileSync(join(sb.claude, PRINCIPAL_REL), "utf8");
    const out = inSandbox(sb, `
      const e = W.read(P(${JSON.stringify(PRINCIPAL_REL)})).entries;
      return W.setEntries(P(${JSON.stringify(PRINCIPAL_REL)}), e.slice(0, 10), { updatedBy: "MemorySystem.add" });
    `);
    expect(out.ok).toBe(false);
    expect(out.code).toBe("ESUSPECT_EROSION");
    expect(readFileSync(join(sb.claude, PRINCIPAL_REL), "utf8")).toBe(before);
    const rejected = ledgerRows(sb).filter((r) => r.kind === "memory/rejected");
    expect(rejected.length).toBe(1);
    expect(rejected[0].rejection_code).toBe("ESUSPECT_EROSION");
    expect(rejected[0].evictions.length).toBe(2);
  });

  test("consolidation intent lifts erosion only at the threshold, never the shrink guard", () => {
    const sb = sandbox({ principal: entries("principal", 40), da: entries("assistant", 1) });
    const out = inSandbox(sb, `
      const p = P(${JSON.stringify(PRINCIPAL_REL)});
      const e = W.read(p).entries;
      const merged = [...e.slice(0, 34), "PREFERENCE: merged summary of six facts ~deduced"];
      const plain = W.setEntries(p, merged, { updatedBy: "test" });
      const consolidated = W.setEntries(p, merged, { updatedBy: "test", consolidation: true });
      const wipe = W.setEntries(p, merged.slice(0, 2), { updatedBy: "test", consolidation: true });
      return { plain: plain.code ?? "ok", consolidated: consolidated.ok, wipe: wipe.code ?? "ok" };
    `);
    expect(out).toEqual({ plain: "ESUSPECT_EROSION", consolidated: true, wipe: "ESUSPECT_SHRINK" });
  });

  test("a write built on a stale read is refused with ESTALE_BASE and does not overwrite the newer write", () => {
    const sb = sandbox();
    const out = inSandbox(sb, `
      const p = P(${JSON.stringify(PRINCIPAL_REL)});
      const read = W.read(p);
      const concurrent = W.setEntries(p, [...read.entries, "RULE: landed while the reviewer was thinking ~explicit"], { updatedBy: "manual" });
      const stale = W.setEntries(p, [...read.entries, "RULE: reviewer output ~explicit"], { updatedBy: "MemorySystem.add", expectedFingerprint: read.fingerprint });
      const after = W.read(p);
      const fresh = W.setEntries(p, [...after.entries, "RULE: reviewer output ~explicit"], { updatedBy: "MemorySystem.add", expectedFingerprint: after.fingerprint });
      return { concurrent: concurrent.ok, stale, afterEntries: after.entries, fresh: fresh.ok };
    `);
    expect(out.concurrent).toBe(true);
    expect(out.stale.ok).toBe(false);
    expect(out.stale.code).toBe("ESTALE_BASE");
    expect(out.afterEntries).toContain("RULE: landed while the reviewer was thinking ~explicit");
    expect(out.afterEntries).not.toContain("RULE: reviewer output ~explicit");
    expect(out.fresh).toBe(true);
    const rejected = ledgerRows(sb).filter((r) => r.kind === "memory/rejected");
    expect(rejected.map((r) => r.rejection_code)).toEqual(["ESTALE_BASE"]);
  });
});

/** Run the CortexLedger CLI in the sandbox, with the same isolated environment as inSandbox. */
function cliInSandbox(sb: Sandbox, args: string[]): { code: number | null; out: string } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(CLAUDE_|WORKOS_|CORTEX_|GIT_)/.test(k)) continue;
    env[k] = v;
  }
  env.HOME = sb.home;
  env.CLAUDE_CONFIG_DIR = sb.claude;
  const r = Bun.spawnSync(["bun", join(TOOLS, "CortexLedger.ts"), ...args], { env, cwd: sb.home, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

describe("Cortex locks: a dead writer cannot block memory", () => {
  test("lockfiles an older build left behind do not block the next write", () => {
    const sb = sandbox();
    // What a writer killed mid-write under the O_EXCL scheme left on disk.
    mkdirSync(join(sb.claude, "WORKOS/MEMORY/LEDGER"), { recursive: true });
    writeFileSync(join(sb.claude, EVENTS_REL + ".lock"), "");
    writeFileSync(join(sb.userData, "PRINCIPAL/PRINCIPAL_MEMORY.md.lock"), "");
    const out = inSandbox(sb, `
      const p = P(${JSON.stringify(PRINCIPAL_REL)});
      return W.setEntries(p, [...W.read(p).entries, "RULE: written past a stale lock ~explicit"], { updatedBy: "test" });
    `);
    expect(out.ok).toBe(true);
  });

  test("a live holder of the memory-file lock still gets ELOCK_HELD", () => {
    const sb = sandbox();
    const out = inSandbox(sb, `
      const K = await import(${JSON.stringify(join(TOOLS, "lib/LedgerCore.ts"))});
      const p = P(${JSON.stringify(PRINCIPAL_REL)});
      const held = K.withKernelLock(p + ".lock", () => W.setEntries(p, [...W.read(p).entries, "RULE: must not land ~explicit"], { updatedBy: "test" }));
      return held.value;
    `);
    expect(out.ok).toBe(false);
    expect(out.code).toBe("ELOCK_HELD");
  });
});

describe("Cortex ledger: scheduled compaction", () => {
  test("maintain does nothing below the row threshold", () => {
    const sb = sandbox();
    inSandbox(sb, `
      const p = P(${JSON.stringify(PRINCIPAL_REL)});
      return W.setEntries(p, [...W.read(p).entries, "RULE: one ~explicit"], { updatedBy: "test" });
    `);
    const before = readFileSync(join(sb.claude, EVENTS_REL), "utf8");
    const r = cliInSandbox(sb, ["maintain"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("nothing to do");
    expect(readFileSync(join(sb.claude, EVENTS_REL), "utf8")).toBe(before);
  });

  test("past the threshold it checkpoints, archives the older rows, and memory folds the same", () => {
    const sb = sandbox();
    inSandbox(sb, `
      const p = P(${JSON.stringify(PRINCIPAL_REL)});
      for (const n of [1, 2, 3]) W.setEntries(p, [...W.read(p).entries, "RULE: compaction test " + n + " ~explicit"], { updatedBy: "test" });
      return true;
    `);
    const rowsBefore = ledgerRows(sb);
    const r = cliInSandbox(sb, ["maintain", "--min-rows", "2"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("compacted:");
    const rowsAfter = ledgerRows(sb);
    expect(rowsAfter.length).toBe(1);
    expect(rowsAfter[0].kind).toBe("checkpoint");
    expect(rowsAfter[0].seq).toBe(rowsBefore[rowsBefore.length - 1].seq + 1);
    const archived = readFileSync(join(sb.claude, `WORKOS/MEMORY/LEDGER/archive/events-1-${rowsBefore.length}.jsonl`), "utf8").trim().split("\n");
    expect(archived.length).toBe(rowsBefore.length);
    const out = inSandbox(sb, `return { verify: L.verifyAll().status, entries: W.read(P(${JSON.stringify(PRINCIPAL_REL)})).entries };`);
    expect(out.verify).toBe("ok");
    expect(out.entries).toContain("RULE: compaction test 3 ~explicit");
  });
});

describe("LedgerCore.withKernelLock without flock(2)", () => {
  function lockDir(): string {
    const d = realpathSync(mkdtempSync(join(tmpdir(), "workos-ledger-lock-test-")));
    sandboxes.push(d);
    return d;
  }

  test("falls back to the O_EXCL lockfile instead of failing, and releases it", () => {
    setFlockUnavailableForTests(true);
    expect(kernelLockMode()).toBe("file-lock-fallback");
    const lock = join(lockDir(), "sub/ledger.lock");
    let sawLockfile = false;
    const r = withKernelLock(lock, () => {
      sawLockfile = existsSync(fallbackLockPath(lock));
      return 42;
    });
    expect(r).toEqual({ ok: true, value: 42 });
    expect(sawLockfile).toBe(true);
    expect(existsSync(fallbackLockPath(lock))).toBe(false);
    expect(existsSync(lock)).toBe(false); // the flock file is never created in fallback mode
  });

  test("the fallback still excludes a concurrent holder and takes over a stale one", () => {
    setFlockUnavailableForTests(true);
    const lock = join(lockDir(), "ledger.lock");
    writeFileSync(fallbackLockPath(lock), "");
    const held = withKernelLock(lock, () => "ran", { deadlineMs: 60, retryMs: 10 });
    expect(held.ok).toBe(false);
    if (!held.ok) expect(held.message).toContain("held past deadline");

    const old = new Date(Date.now() - 60_000);
    utimesSync(fallbackLockPath(lock), old, old);
    const taken = withKernelLock(lock, () => "ran", { deadlineMs: 500, retryMs: 10, staleMs: 1000 });
    expect(taken).toEqual({ ok: true, value: "ran" });
  });

  test("an action's exception propagates in fallback mode and the lock is still released", () => {
    setFlockUnavailableForTests(true);
    const lock = join(lockDir(), "ledger.lock");
    expect(() => withKernelLock(lock, () => { throw new Error("boom"); })).toThrow("boom");
    expect(existsSync(fallbackLockPath(lock))).toBe(false);
  });

  test("musl library names are tried after glibc's; macOS uses libc.dylib", () => {
    expect(libcCandidates("linux", "x64")).toEqual(["libc.so.6", "libc.musl-x86_64.so.1", "libc.so"]);
    expect(libcCandidates("linux", "arm64")).toEqual(["libc.so.6", "libc.musl-aarch64.so.1", "libc.so"]);
    expect(libcCandidates("darwin", "arm64")).toEqual(["libc.dylib"]);
  });

  test("with flock available the kernel lock is used and its file persists", () => {
    setFlockUnavailableForTests(false);
    if (kernelLockMode() !== "flock") return; // a host with no loadable libc is the fallback case above
    const lock = join(lockDir(), "ledger.lock");
    expect(withKernelLock(lock, () => 7)).toEqual({ ok: true, value: 7 });
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(fallbackLockPath(lock))).toBe(false);
  });
});
