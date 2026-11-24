import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { governingIsa, isCodeFile, linkedIsa, resetLinkedIsaCache } from "./IsaGoverning";

// Everything lives under one temp root; the real ~/.claude is never read. CLAUDE_CONFIG_DIR points the WorkOS
// dir (and so MEMORY/WORK) at the temp root, HOME at a temp home so `~` and `$HOME` in `repo:` are testable.
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "isa-governing-")));
const HOME = join(ROOT, "home");
const CONFIG = join(ROOT, "config");
const WORK = join(CONFIG, "WORKOS", "MEMORY", "WORK");
const REPOS = join(ROOT, "repos");

const ENV_KEYS = ["HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_PLUGIN_ROOT", "WORKOS_DIR", "WORKOS_SKILLS_DIR"] as const;
const saved: Record<string, string | undefined> = {};
let counter = 0;

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.HOME = HOME;
  process.env.CLAUDE_CONFIG_DIR = CONFIG;
  mkdirSync(HOME, { recursive: true });
  rmSync(join(CONFIG, "WORKOS"), { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  resetLinkedIsaCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  resetLinkedIsaCache();
});

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

/** A git repo: `.git/HEAD` on `branch` (or detached when branch is null) and one source file. Returns its root. */
function makeRepo(name: string, branch: string | null = "main"): string {
  const root = join(REPOS, `${name}-${++counter}`);
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".git", "HEAD"), branch ? `ref: refs/heads/${branch}\n` : "3b18e512dba79e4c8300dd08aeb7f6f5a8b0f7a1\n");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.ts"), "export const x = 1;\n");
  return root;
}

/** A linked worktree of `main`: `.git` is a FILE pointing at <main>/.git/worktrees/<name>, which owns HEAD. */
function makeWorktree(main: string, name: string, branch: string): string {
  const wt = join(REPOS, `wt-${name}-${++counter}`);
  const gitdir = join(main, ".git", "worktrees", name);
  mkdirSync(gitdir, { recursive: true });
  writeFileSync(join(gitdir, "HEAD"), `ref: refs/heads/${branch}\n`);
  writeFileSync(join(gitdir, "commondir"), "../..\n");
  mkdirSync(join(wt, "src"), { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${gitdir}\n`);
  writeFileSync(join(wt, "src", "app.ts"), "export const y = 2;\n");
  return wt;
}

/** A WorkOS ISA at <WORK>/<slug>/ISA.md. `fm` lines go into the frontmatter. Returns its path. */
function workIsa(slug: string, fm: string[], mtime?: number): string {
  const path = join(WORK, slug, "ISA.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `---\nslug: ${slug}\nphase: climbing\nprogress: 0/3\n${fm.join("\n")}\n---\n\n# ${slug}\n`);
  if (mtime !== undefined) utimesSync(path, mtime, mtime);
  return realpathSync(path);
}

const fileOf = (repo: string) => join(repo, "src", "app.ts");

describe("in-repo walk", () => {
  test("the nearest ISA.md up to the repo root governs; a nearer one wins", () => {
    const repo = makeRepo("walk");
    writeFileSync(join(repo, "ISA.md"), "---\nphase: climbing\n---\n");
    expect(governingIsa(fileOf(repo))).toBe(join(repo, "ISA.md"));
    mkdirSync(join(repo, "src", "deep"), { recursive: true });
    writeFileSync(join(repo, "src", "deep", "ISA.md"), "---\nphase: climbing\n---\n");
    writeFileSync(join(repo, "src", "deep", "x.ts"), "");
    expect(governingIsa(join(repo, "src", "deep", "x.ts"))).toBe(join(repo, "src", "deep", "ISA.md"));
    expect(governingIsa(fileOf(repo))).toBe(join(repo, "ISA.md"));
  });

  test("a symlinked ISA resolves to its real path", () => {
    const repo = makeRepo("link");
    const real = workIsa("elsewhere", []);
    symlinkSync(real, join(repo, "ISA.md"));
    expect(governingIsa(fileOf(repo))).toBe(real);
  });

  test("an in-repo ISA beats a linked one", () => {
    const repo = makeRepo("both");
    workIsa("linked", [`repo: ${repo}`]);
    writeFileSync(join(repo, "ISA.md"), "---\nphase: climbing\n---\n");
    expect(governingIsa(fileOf(repo))).toBe(join(repo, "ISA.md"));
  });

  test("outside any git repo there is no governing ISA, even with a linked one for that directory", () => {
    const loose = join(ROOT, "loose");
    mkdirSync(loose, { recursive: true });
    writeFileSync(join(loose, "a.ts"), "");
    workIsa("loose", [`repo: ${loose}`]);
    expect(governingIsa(join(loose, "a.ts"))).toBeNull();
  });
});

describe("code_sync: off", () => {
  test("an off ISA in the repo owns nothing and stops the walk", () => {
    const repo = makeRepo("off");
    writeFileSync(join(repo, "ISA.md"), "---\nphase: climbing\ncode_sync: off\n---\n");
    workIsa("linked-ignored", [`repo: ${repo}`]);
    expect(governingIsa(fileOf(repo))).toBeNull();
  });

  test("a linked ISA with code_sync off owns nothing", () => {
    const repo = makeRepo("off-linked");
    workIsa("quiet", [`repo: ${repo}`, "code_sync: off"]);
    expect(governingIsa(fileOf(repo))).toBeNull();
  });
});

describe("not code", () => {
  test("Markdown, ISA.html, media and gitattributes-generated files have no governing ISA", () => {
    const repo = makeRepo("notcode");
    workIsa("rec", [`repo: ${repo}`]);
    writeFileSync(join(repo, ".gitattributes"), "dist/** linguist-generated\ncontent/** linguist-documentation=true\n");
    for (const rel of ["README.md", "ISA.html", "logo.png", "font.woff2", "dist/bundle.js", "content/post.json"]) {
      mkdirSync(dirname(join(repo, rel)), { recursive: true });
      writeFileSync(join(repo, rel), "");
      expect(governingIsa(join(repo, rel))).toBeNull();
    }
    expect(isCodeFile(fileOf(repo))).toBe(true);
    expect(governingIsa(fileOf(repo))).not.toBeNull();
  });

  test("a relative path is not governed", () => {
    expect(governingIsa("src/app.ts")).toBeNull();
    expect(governingIsa("")).toBeNull();
  });
});

describe("linked WorkOS ISA", () => {
  test("by branch: the ISA whose branch: equals the current branch wins over the repo-wide one", () => {
    const repo = makeRepo("branch", "feature/login");
    workIsa("repo-wide", [`repo: ${repo}`]);
    workIsa("other-branch", [`repo: ${repo}`, "branch: feature/other"]);
    const onBranch = workIsa("login", [`repo: ${repo}`, "branch: feature/login"]);
    expect(governingIsa(fileOf(repo))).toBe(onBranch);
  });

  test("by ticket: a ticket: key found in the branch name (any case) selects the ISA", () => {
    const repo = makeRepo("ticket", "bugfix/abc-123-null-ref");
    workIsa("repo-wide", [`repo: ${repo}`]);
    workIsa("wrong-ticket", [`repo: ${repo}`, "ticket: XYZ-9"]);
    const hit = workIsa("abc", [`repo: ${repo}`, "ticket: ABC-123"]);
    expect(governingIsa(fileOf(repo))).toBe(hit);
  });

  test("a ticket list and a quoted value both work; a non-matching branch: can still match by ticket", () => {
    const repo = makeRepo("ticketlist", "dev-QWE-77-thing");
    const hit = workIsa("multi", [`repo: "${repo}"`, "branch: feature/gone", 'ticket: [ABC-1, "QWE-77"]']);
    expect(governingIsa(fileOf(repo))).toBe(hit);
  });

  test("branch beats ticket when both tiers have a candidate", () => {
    const repo = makeRepo("tiers", "feature/ABC-5-x");
    workIsa("by-ticket", [`repo: ${repo}`, "ticket: ABC-5"]);
    const byBranch = workIsa("by-branch", [`repo: ${repo}`, "branch: feature/ABC-5-x"]);
    expect(governingIsa(fileOf(repo))).toBe(byBranch);
  });

  test("untiered fallback: with no branch or ticket match, the ISA with neither field governs", () => {
    const repo = makeRepo("fallback", "feature/unrelated");
    const wide = workIsa("repo-wide", [`repo: ${repo}`]);
    workIsa("other-branch", [`repo: ${repo}`, "branch: feature/other"]);
    workIsa("other-ticket", [`repo: ${repo}`, "ticket: ABC-9"]);
    expect(governingIsa(fileOf(repo))).toBe(wide);
  });

  test("only tiered ISAs and none match: no governing ISA", () => {
    const repo = makeRepo("nomatch", "main");
    workIsa("other-branch", [`repo: ${repo}`, "branch: feature/other"]);
    workIsa("other-ticket", [`repo: ${repo}`, "ticket: ABC-9"]);
    expect(governingIsa(fileOf(repo))).toBeNull();
  });

  test("a detached HEAD has no branch: only the untiered ISA can match", () => {
    const repo = makeRepo("detached", null);
    workIsa("by-branch", [`repo: ${repo}`, "branch: main"]);
    const wide = workIsa("wide", [`repo: ${repo}`]);
    expect(governingIsa(fileOf(repo))).toBe(wide);
  });

  test("complete and archived ISAs are skipped, in phase or status, before the tier is picked", () => {
    const repo = makeRepo("done", "feature/x");
    // frontmatter by hand: workIsa always writes phase: climbing
    for (const [slug, fm] of [
      ["done-branch", `phase: complete\nrepo: ${repo}\nbranch: feature/x`],
      ["archived-wide", `phase: climbing\nstatus: archived\nrepo: ${repo}`],
    ] as const) {
      mkdirSync(join(WORK, slug), { recursive: true });
      writeFileSync(join(WORK, slug, "ISA.md"), `---\n${fm}\n---\n`);
    }
    expect(governingIsa(fileOf(repo))).toBeNull();
    const live = workIsa("live-wide", [`repo: ${repo}`]);
    resetLinkedIsaCache();
    // the finished branch ISA does not hide the live repo-wide one
    expect(governingIsa(fileOf(repo))).toBe(live);
  });

  test("within a tier the most recently modified ISA wins", () => {
    const repo = makeRepo("recent", "main");
    workIsa("old", [`repo: ${repo}`], 1_700_000_000);
    const fresh = workIsa("fresh", [`repo: ${repo}`], 1_800_000_000);
    workIsa("older", [`repo: ${repo}`], 1_600_000_000);
    expect(governingIsa(fileOf(repo))).toBe(fresh);
  });

  test("a linked worktree reads its own HEAD and matches the main checkout's repo:", () => {
    const main = makeRepo("main-checkout", "main");
    const wt = makeWorktree(main, "wt1", "feature/in-worktree");
    workIsa("repo-wide", [`repo: ${main}`]);
    const onBranch = workIsa("wt-branch", [`repo: ${main}`, "branch: feature/in-worktree"]);
    expect(governingIsa(fileOf(wt))).toBe(onBranch);
    // the main checkout still sees its own branch, not the worktree's
    expect(governingIsa(fileOf(main))).not.toBe(onBranch);
  });

  test("a worktree path in repo: matches that worktree", () => {
    const main = makeRepo("main-checkout", "main");
    const wt = makeWorktree(main, "wt2", "feature/solo");
    const hit = workIsa("wt-only", [`repo: ${wt}`]);
    expect(governingIsa(fileOf(wt))).toBe(hit);
    expect(governingIsa(fileOf(main))).toBeNull();
  });

  test("two repos are not confused", () => {
    const a = makeRepo("alpha", "main");
    const b = makeRepo("beta", "main");
    const isaA = workIsa("alpha", [`repo: ${a}`]);
    expect(governingIsa(fileOf(a))).toBe(isaA);
    expect(governingIsa(fileOf(b))).toBeNull();
    const isaB = workIsa("beta", [`repo: ${b}`]);
    resetLinkedIsaCache();
    expect(governingIsa(fileOf(b))).toBe(isaB);
    expect(governingIsa(fileOf(a))).toBe(isaA);
  });

  test("a repo that is a prefix of another is not confused with it", () => {
    const a = makeRepo("proj", "main");
    const longer = `${a}-extra`;
    mkdirSync(join(longer, ".git"), { recursive: true });
    writeFileSync(join(longer, ".git", "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(join(longer, "src"), { recursive: true });
    writeFileSync(join(longer, "src", "app.ts"), "");
    workIsa("proj", [`repo: ${a}`]);
    expect(governingIsa(join(longer, "src", "app.ts"))).toBeNull();
  });

  test("repo: accepts ~ and $HOME, a trailing slash, a symlinked path and an inline comment", () => {
    // Bun caches os.homedir() at startup, so ~ expansion is exercised through the CLI in a child with HOME set.
    const repo = makeRepo("home", "main");
    const underHome = join(HOME, "work", "linked-repo");
    mkdirSync(dirname(underHome), { recursive: true });
    symlinkSync(repo, underHome);
    const ask = () => {
      const r = Bun.spawnSync(["bun", join(import.meta.dir, "IsaGoverning.ts"), fileOf(repo)], { env: { ...process.env, HOME }, stdout: "pipe", stderr: "pipe" });
      return JSON.parse(r.stdout.toString()).isa as string | null;
    };
    const viaTilde = workIsa("tilde", ["repo: ~/work/linked-repo/  # employer repo"]);
    expect(ask()).toBe(viaTilde);
    rmSync(join(WORK, "tilde"), { recursive: true });
    const viaEnv = workIsa("envhome", ['repo: "$HOME/work/linked-repo"']);
    expect(ask()).toBe(viaEnv);
  });

  test("a relative repo: and an ISA with no repo: link nothing", () => {
    const repo = makeRepo("rel", "main");
    workIsa("relative", ["repo: some/where"]);
    workIsa("unlinked", []);
    expect(governingIsa(fileOf(repo))).toBeNull();
  });

  test("the WORK dir is scanned once per process", () => {
    const repo = makeRepo("memo", "main");
    expect(governingIsa(fileOf(repo))).toBeNull(); // scan happens here, finds nothing
    workIsa("late", [`repo: ${repo}`]);
    expect(governingIsa(fileOf(repo))).toBeNull(); // memoised: the new ISA is not seen
    resetLinkedIsaCache();
    expect(governingIsa(fileOf(repo))).not.toBeNull();
  });

  test("no WORK dir at all: no governing ISA, no throw", () => {
    rmSync(join(CONFIG, "WORKOS"), { recursive: true, force: true });
    const repo = makeRepo("nowork", "main");
    expect(governingIsa(fileOf(repo))).toBeNull();
  });

  test("linkedIsa takes a repo root directly", () => {
    const repo = makeRepo("direct", "main");
    const isa = workIsa("direct", [`repo: ${repo}`]);
    expect(linkedIsa(repo)).toBe(isa);
  });
});
