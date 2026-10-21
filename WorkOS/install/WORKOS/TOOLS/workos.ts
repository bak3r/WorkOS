#!/usr/bin/env bun
/**
 * workos — the WorkOS launcher CLI
 * (Canonical name `workos`; alias it to whatever you like — public PR #1631, @elhoim.)
 *
 * Comprehensive CLI for managing Claude Code with dynamic MCP loading,
 * updates, version checking, and profile management.
 *
 * Usage:
 *   workos             Launch Claude (default profile)
 *   workos -m bd       Launch with Bright Data MCP
 *   workos -m bd,ap    Launch with multiple MCPs
 *   workos -r / --resume  Resume a session (picker, or pass a session ID)
 *   workos --local     Stay in current directory (don't cd to ~/.claude)
 *   workos -- <flags...>  Forward everything after -- verbatim to `claude`
 *   workos update      Update Claude Code
 *   workos version     Show version info
 *   workos profiles    List available profiles
 *   workos mcp list    List available MCPs
 *   workos mcp set <profile>  Set MCP profile
 */

import { spawn, spawnSync } from "bun";
import { existsSync, readFileSync, writeFileSync, readdirSync, symlinkSync, unlinkSync, lstatSync, realpathSync } from "fs";
import { homedir } from "os";
import { join, basename, resolve } from "path";

// ============================================================================
// Configuration
// ============================================================================

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"); // sbx: <workspace>/.claude
const MCP_DIR = join(CLAUDE_DIR, "MCPs");
const ACTIVE_MCP = join(CLAUDE_DIR, ".mcp.json");
const BANNER_SCRIPT = join(CLAUDE_DIR, "WORKOS", "TOOLS", "Banner.ts");
// Note: RAW archiving removed - Claude Code handles its own cleanup (30-day retention in projects/)

// MCP shorthand mappings
const MCP_SHORTCUTS: Record<string, string> = {
  bd: "Brightdata-MCP.json",
  brightdata: "Brightdata-MCP.json",
  ap: "Apify-MCP.json",
  apify: "Apify-MCP.json",
  dev: "dev-work.mcp.json",
  sec: "security.mcp.json",
  security: "security.mcp.json",
  research: "research.mcp.json",
  full: "full.mcp.json",
  min: "minimal.mcp.json",
  minimal: "minimal.mcp.json",
  none: "none.mcp.json",
};

// Profile descriptions
const PROFILE_DESCRIPTIONS: Record<string, string> = {
  none: "No MCPs (maximum performance)",
  minimal: "Essential MCPs",
  "dev-work": "Development tools (Shadcn, Supabase)",
  security: "Security tools (httpx, naabu)",
  research: "Research tools (Brightdata, Apify)",
  full: "All available MCPs",
};

// ============================================================================
// Utilities
// ============================================================================

function log(message: string, emoji = "") {
  console.log(emoji ? `${emoji} ${message}` : message);
}


// True when the current directory is a git repo's MAIN checkout (not a linked
// worktree) AND the repo uses the .claude/worktrees convention. The main
// checkout has --git-dir == --git-common-dir; a linked worktree's --git-dir
// points into .git/worktrees/<name>, so they differ. Fail-open: anything
// unexpected returns false and the launch proceeds (public PR #1579,
// @asdf8675309).
export function inMainCheckoutWithWorktrees(): boolean {
  try {
    // No --path-format flag → works on any git version; the two paths stay
    // directly comparable (both ".git" in a main checkout, divergent in a
    // linked worktree).
    const r = spawnSync(["git", "rev-parse", "--git-dir", "--git-common-dir"]);
    if (r.exitCode !== 0) return false; // not a git repo
    const [gitDir, commonDir] = r.stdout.toString().trim().split("\n");
    if (!gitDir || gitDir !== commonDir) return false; // linked worktree → fine
    const top = spawnSync(["git", "rev-parse", "--show-toplevel"]).stdout.toString().trim();
    if (top.length === 0) return false;
    // "In use" means the dir actually CONTAINS worktrees. The harness creates
    // an empty .claude/worktrees as a side effect of one-off agent isolation;
    // an empty dir must not lock --local out of the main checkout (caught
    // live on this install while porting).
    const wtDir = join(top, ".claude", "worktrees");
    return existsSync(wtDir) && readdirSync(wtDir).length > 0;
  } catch {
    return false;
  }
}

function error(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function displayBanner() {
  if (existsSync(BANNER_SCRIPT)) {
    spawnSync(["bun", BANNER_SCRIPT], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  }
}

// The launcher wraps the Claude Code CLI. On machines without it (e.g. an
// OpenCode-driven install, #1448) fail with directions, not a bare ENOENT.
function requireClaudeCli() {
  if (Bun.which("claude")) return;
  console.error("❌ Claude Code CLI not found on PATH — `workos` wraps the `claude` binary.");
  console.error("   Either install Claude Code (https://claude.com/claude-code), or launch your");
  console.error("   own harness with its system-prompt flag pointed at WORKOS/WORKOS_SYSTEM_PROMPT.md");
  console.error("   (see INSTALL.md step 7 for the non-Claude-Code launch shape).");
  process.exit(1);
}

// The constitution reaches Claude by exactly one route. Launcher route: append
// WORKOS_SYSTEM_PROMPT.md via --append-system-prompt-file. Sandbox route: the
// config-root CLAUDE.md @-imports it (ActivateImports.ts --with-system-prompt),
// because the sbx TUI starts plain `claude`; appending it as well would load it
// twice. -s naming that same file (the alias Setup wires) is skipped too; -s
// naming any OTHER file is always appended.
const SYSTEM_PROMPT_FILE = join(CLAUDE_DIR, "WORKOS", "WORKOS_SYSTEM_PROMPT.md");

function claudeMdImportsSystemPrompt(): boolean {
  try {
    return readFileSync(join(CLAUDE_DIR, "CLAUDE.md"), "utf-8")
      .split("\n")
      .some((l) => l.trim() === "@WORKOS/WORKOS_SYSTEM_PROMPT.md");
  } catch {
    return false;
  }
}

function samePath(a: string, b: string): boolean {
  const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
  return real(a) === real(b);
}

function systemPromptArgs(explicit?: string): string[] {
  const file = explicit ?? SYSTEM_PROMPT_FILE;
  if (samePath(file, SYSTEM_PROMPT_FILE) && claudeMdImportsSystemPrompt()) {
    console.error("ℹ️  CLAUDE.md imports WORKOS_SYSTEM_PROMPT.md — not appending it again.");
    return [];
  }
  return existsSync(file) ? ["--append-system-prompt-file", file] : [];
}

function getCurrentVersion(): string | null {
  if (!Bun.which("claude")) return null;
  const result = spawnSync(["claude", "--version"]);
  const output = result.stdout.toString();
  const match = output.match(/([0-9]+\.[0-9]+\.[0-9]+)/);
  return match ? match[1] : null;
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

async function getLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(
      "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest"
    );
    const version = (await response.text()).trim();
    if (/^[0-9]+\.[0-9]+\.[0-9]+/.test(version)) {
      return version;
    }
  } catch {
    return null;
  }
  return null;
}

// ============================================================================
// MCP Management
// ============================================================================

function getMcpProfiles(): string[] {
  if (!existsSync(MCP_DIR)) return [];
  return readdirSync(MCP_DIR)
    .filter((f) => f.endsWith(".mcp.json"))
    .map((f) => f.replace(".mcp.json", ""));
}

function getIndividualMcps(): string[] {
  if (!existsSync(MCP_DIR)) return [];
  return readdirSync(MCP_DIR)
    .filter((f) => f.endsWith("-MCP.json"))
    .map((f) => f.replace("-MCP.json", ""));
}

function getCurrentProfile(): string | null {
  if (!existsSync(ACTIVE_MCP)) return null;
  try {
    const stats = lstatSync(ACTIVE_MCP);
    if (stats.isSymbolicLink()) {
      const realpath = Bun.spawnSync(["readlink", ACTIVE_MCP]).stdout.toString().trim();
      return basename(realpath).replace(".mcp.json", "");
    }
    return "custom";
  } catch {
    return null;
  }
}

function mergeMcpConfigs(mcpFiles: string[]): object {
  const merged: Record<string, any> = { mcpServers: {} };

  for (const file of mcpFiles) {
    const filepath = join(MCP_DIR, file);
    if (!existsSync(filepath)) {
      log(`Warning: MCP file not found: ${file}`, "⚠️");
      continue;
    }
    try {
      const config = JSON.parse(readFileSync(filepath, "utf-8"));
      if (config.mcpServers) {
        Object.assign(merged.mcpServers, config.mcpServers);
      }
    } catch (e) {
      log(`Warning: Failed to parse ${file}`, "⚠️");
    }
  }

  return merged;
}

function setMcpProfile(profile: string) {
  const profileFile = join(MCP_DIR, `${profile}.mcp.json`);
  if (!existsSync(profileFile)) {
    error(`Profile '${profile}' not found`);
  }

  // Remove existing
  if (existsSync(ACTIVE_MCP)) {
    unlinkSync(ACTIVE_MCP);
  }

  // Create symlink
  symlinkSync(profileFile, ACTIVE_MCP);
  log(`Switched to '${profile}' profile`, "✅");
  log("Restart Claude Code to apply", "⚠️");
}

function setMcpCustom(mcpNames: string[]) {
  const files: string[] = [];

  for (const name of mcpNames) {
    const file = MCP_SHORTCUTS[name.toLowerCase()];
    if (file) {
      files.push(file);
    } else {
      // Try direct file match
      const directFile = `${name}-MCP.json`;
      const profileFile = `${name}.mcp.json`;
      if (existsSync(join(MCP_DIR, directFile))) {
        files.push(directFile);
      } else if (existsSync(join(MCP_DIR, profileFile))) {
        files.push(profileFile);
      } else {
        error(`Unknown MCP: ${name}`);
      }
    }
  }

  const merged = mergeMcpConfigs(files);

  // Remove symlink if exists, write new file
  if (existsSync(ACTIVE_MCP)) {
    unlinkSync(ACTIVE_MCP);
  }
  writeFileSync(ACTIVE_MCP, JSON.stringify(merged, null, 2));

  const serverCount = Object.keys((merged as any).mcpServers || {}).length;
  if (serverCount > 0) {
    log(`Configured ${serverCount} MCP server(s): ${mcpNames.join(", ")}`, "✅");
  }
}

/**
 * `k doctor` — the capability check. Doctor.ts and the statusline both advise
 * running "workos doctor" on a capability regression, but there was no such
 * subcommand: the only working invocation was the more obscure
 * `bun WORKOS/TOOLS/Doctor.ts`. Extra args are forwarded verbatim, so
 * `k doctor --network` and `k doctor decline <name>` work too.
 * public PR #1637, @elhoim
 */
function cmdDoctor(args: string[]) {
  const doctor = join(CLAUDE_DIR, "WORKOS", "TOOLS", "Doctor.ts");
  const result = spawnSync(["bun", doctor, ...args], {
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  process.exit(result.exitCode ?? 0);
}

// ============================================================================
// Commands
// ============================================================================

async function cmdLaunch(options: { mcp?: string; resume?: boolean; resumeId?: string; local?: boolean; systemPrompt?: string; passthrough?: string[] }) {
  // CLAUDE.md is now static — no build step needed.
  // Algorithm spec is loaded on-demand when Algorithm mode triggers.
  // (InstantiatePAI.ts is retired — kept for reference only)

  requireClaudeCli();
  displayBanner();
  const args = ["claude"];

  // WorkOS System Prompt — constitutional rules appended to Claude Code's system prompt
  // These rules get highest instruction authority (system prompt layer > CLAUDE.md layer)
  // — unless CLAUDE.md already imports them (sandbox route, see systemPromptArgs).
  args.push(...systemPromptArgs(options.systemPrompt));

  // Handle MCP configuration
  if (options.mcp) {
    const mcpNames = options.mcp.split(",").map((s) => s.trim());
    setMcpCustom(mcpNames);
  }

  // Add flags
  // NOTE: We never pass --dangerously-skip-permissions. Permissions come from
  // the settings.json allow/deny/ask system, full stop. (A comment here used to
  // advertise a --dangerous flag the parser never implemented — public issue
  // #1691, @catchingknives.)
  if (options.resume) {
    args.push("--resume");
    // Forward a specific session ID when given; bare --resume opens the picker.
    if (options.resumeId) {
      args.push(options.resumeId);
    }
  }

  // Guard (public PR #1579, @asdf8675309): --local launches Claude in the
  // CURRENT directory. If that's a repo's main checkout (not a worktree) and
  // the repo uses .claude/worktrees, the whole session would run on whatever
  // stale branch the root is parked on. Refuse unless explicitly overridden.
  if (options.local && process.env.WORKOS_ALLOW_ROOT !== "1" && inMainCheckoutWithWorktrees()) {
    error(
      "You're in the main checkout root, not a worktree.\n" +
        "   A --local session here runs on whatever branch the root is parked on.\n" +
        "   cd into a worktree first, or set WORKOS_ALLOW_ROOT=1 to override.",
    );
  }

  // Change to WorkOS directory unless --local flag is set
  if (!options.local) {
    process.chdir(CLAUDE_DIR);
  }

  // Flags this CLI doesn't model (e.g. --fork-session) reach `claude` verbatim
  // after a bare `--`. Without it the parser's default branch swallowed every
  // unrecognized dash-flag silently (public issue #1690, @catchingknives).
  if (options.passthrough?.length) {
    args.push(...options.passthrough);
  }

  // Launch Claude
  // AUTH: inherit the harness auth (Bedrock env in the sandbox, OAuth `claude /login`
  // elsewhere). Strip ANTHROPIC_API_KEY before spawn so a stray key never wins.
  // Mirrors the protection in cmdPrompt() — same hazard, same fix.
  const launchEnv = { ...process.env };
  delete launchEnv.ANTHROPIC_API_KEY;
  launchEnv.CLAUDE_CODE_WORKFLOWS = "1";
  const proc = spawn(args, {
    stdio: ["inherit", "inherit", "inherit"],
    env: launchEnv,
  });

  // Wait for Claude to exit
  await proc.exited;
}

async function cmdUpdate() {
  log("Checking for updates...", "🔍");

  const current = getCurrentVersion();
  const latest = await getLatestVersion();

  if (!current) {
    error("Could not detect current version");
  }

  console.log(`Current: v${current}`);
  if (latest) {
    console.log(`Latest:  v${latest}`);
  }

  // Skip if already up to date
  if (latest && compareVersions(current, latest) >= 0) {
    log("Already up to date", "✅");
    return;
  }

  log("Updating Claude Code...", "🔄");

  // Step 1: Update Bun
  log("Step 1/2: Updating Bun...", "📦");
  const bunResult = spawnSync(["brew", "upgrade", "bun"]);
  if (bunResult.exitCode !== 0) {
    log("Bun update skipped (may already be latest)", "⚠️");
  } else {
    log("Bun updated", "✅");
  }

  // Step 2: Update Claude Code
  log("Step 2/2: Installing latest Claude Code...", "🤖");
  const claudeResult = spawnSync(["bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"]);
  if (claudeResult.exitCode !== 0) {
    error("Claude Code installation failed");
  }
  log("Claude Code updated", "✅");

  // Show final version
  const newVersion = getCurrentVersion();
  if (newVersion) {
    console.log(`Now running: v${newVersion}`);
  }
}

async function cmdVersion() {
  log("Checking versions...", "🔍");

  const current = getCurrentVersion();
  const latest = await getLatestVersion();

  if (!current) {
    error("Could not detect current version");
  }

  console.log(`Current: v${current}`);
  if (latest) {
    console.log(`Latest:  v${latest}`);
    const cmp = compareVersions(current, latest);
    if (cmp >= 0) {
      log("Up to date", "✅");
    } else {
      log("Update available (run 'k update')", "⚠️");
    }
  } else {
    log("Could not fetch latest version", "⚠️");
  }
}

function cmdProfiles() {
  log("Available MCP Profiles:", "📋");
  console.log();

  const current = getCurrentProfile();
  const profiles = getMcpProfiles();

  for (const profile of profiles) {
    const isCurrent = profile === current;
    const desc = PROFILE_DESCRIPTIONS[profile] || "";
    const marker = isCurrent ? "→ " : "  ";
    const badge = isCurrent ? " (active)" : "";
    console.log(`${marker}${profile}${badge}`);
    if (desc) console.log(`    ${desc}`);
  }

  console.log();
  log("Usage: k mcp set <profile>", "💡");
}

function cmdMcpList() {
  log("Available MCPs:", "📋");
  console.log();

  // Individual MCPs
  log("Individual MCPs (use with -m):", "📦");
  const mcps = getIndividualMcps();
  for (const mcp of mcps) {
    const shortcut = Object.entries(MCP_SHORTCUTS)
      .filter(([_, v]) => v === `${mcp}-MCP.json`)
      .map(([k]) => k);
    const shortcuts = shortcut.length > 0 ? ` (${shortcut.join(", ")})` : "";
    console.log(`  ${mcp}${shortcuts}`);
  }

  console.log();
  log("Profiles (use with 'k mcp set'):", "📁");
  const profiles = getMcpProfiles();
  for (const profile of profiles) {
    const desc = PROFILE_DESCRIPTIONS[profile] || "";
    console.log(`  ${profile}${desc ? ` - ${desc}` : ""}`);
  }

  console.log();
  log("Examples:", "💡");
  console.log("  k -m bd          # Bright Data only");
  console.log("  k -m bd,ap       # Bright Data + Apify");
  console.log("  k mcp set research  # Full research profile");
}

async function cmdPrompt(prompt: string) {
  // One-shot prompt execution
  // NOTE: No --dangerously-skip-permissions - rely on settings.json permissions
  // AUTH: inherit the harness auth; no --bare (forces ANTHROPIC_API_KEY), and
  // strip the key from inherited env.
  requireClaudeCli();
  const args = ["claude", "-p", prompt];

  // Same constitutional layer as interactive launches — without this, one-shots
  // ran bare Claude Code (CLAUDE.md only, no output format, no security protocol).
  args.push(...systemPromptArgs());

  process.chdir(CLAUDE_DIR);

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_WORKFLOWS = "1";
  const proc = spawn(args, {
    stdio: ["inherit", "inherit", "inherit"],
    env,
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}

function cmdHelp() {
  console.log(`
workos — WorkOS launcher CLI (v2.2.0)

USAGE:
  workos                   Launch Claude (no MCPs, max performance)
  workos -m <mcp>          Launch with specific MCP(s)
  workos -m bd,ap          Launch with multiple MCPs
  workos -r, --resume [id]  Resume a session (interactive picker, or a specific session ID)
  workos -s, --system-prompt <file>  Append this file as the system prompt (default:
                           WORKOS_SYSTEM_PROMPT.md). When CLAUDE.md @-imports that file
                           (sandbox route) it is not appended again, even via -s;
                           -s naming any other file is always appended
  workos -l, --local       Stay in current directory (don't cd to ~/.claude)
  workos -- <flags...>     Forward everything after -- straight to \`claude\`

COMMANDS:
  workos update            Update Claude Code to latest version
  workos version, -v       Show version information
  workos profiles          List available MCP profiles
  workos mcp list          List all available MCPs
  workos mcp set <profile>  Set MCP profile permanently
  workos prompt "<text>"   One-shot prompt execution
  workos doctor [args]     Run the capability check (args forwarded to Doctor.ts)
  workos help, -h          Show this help

MCP SHORTCUTS:
  bd, brightdata           Bright Data scraping
  ap, apify                Apify automation
  dev                      Development tools
  sec, security            Security tools
  research                 Research tools (BD + Apify)
  full                     All MCPs
  min, minimal             Essential MCPs only
  none                     No MCPs

EXAMPLES:
  workos                   Start with current profile
  workos -m bd             Start with Bright Data
  workos -m bd,ap          Start with multiple MCPs
  workos -r                Resume a session (picker), or 'workos -r <id>' for a specific one
  workos mcp set research  Switch to research profile
  workos update            Update Claude Code
  workos prompt "What time is it?"  One-shot prompt
  workos -r -- --fork-session  Resume, forwarding --fork-session to claude

NOTE:
  Flags this CLI doesn't know are ignored, not rejected. To hand a native
  Claude Code flag to the underlying \`claude\` process, put it after \`--\`.
`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // No args - launch without touching MCP config (use native /mcp commands)
  if (args.length === 0) {
    await cmdLaunch({});
    return;
  }

  // `k` is aliased to `bun <this file>`, and bun CONSUMES a `--` that sits
  // immediately after the script path — verified: `-- --fork-session` arrives as
  // ["--fork-session"], while `-r -- --fork-session` keeps its separator. Only
  // that first one is eaten. So a leading dash-flag we don't model is the tail of
  // a separator the runtime swallowed; forwarding it is what the user asked for,
  // and the default branch below would otherwise silently drop it all over again
  // (public issue #1690, @catchingknives).
  const KNOWN_FLAGS = new Set([
    "-m", "--mcp", "-r", "--resume", "-s", "--system-prompt", "-l", "--local",
    "-v", "--version", "-h", "--help", "-p", "--",
  ]);
  if (args[0].startsWith("-") && !KNOWN_FLAGS.has(args[0])) {
    await cmdLaunch({ passthrough: args });
    return;
  }

  // Parse arguments
  let mcp: string | undefined;
  let resume = false;
  let resumeId: string | undefined;
  let local = false;
  let systemPrompt: string | undefined;
  let command: string | undefined;
  let subCommand: string | undefined;
  let subArg: string | undefined;
  let promptText: string | undefined;
  let doctorArgs: string[] = [];
  let passthrough: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "-m":
      case "--mcp":
        const nextArg = args[i + 1];
        // -m with no arg, or -m 0, or -m "" means no MCPs
        if (!nextArg || nextArg.startsWith("-") || nextArg === "0" || nextArg === "") {
          mcp = "none";
          if (nextArg === "0" || nextArg === "") i++;
        } else {
          mcp = args[++i];
        }
        break;
      case "-r":
      case "--resume":
        resume = true;
        // Optional session ID: `k -r <session-id>` resumes that session
        // directly; bare `k -r` opens the interactive picker.
        if (args[i + 1] && !args[i + 1].startsWith("-")) {
          resumeId = args[++i];
        }
        break;
      case "-s":
      case "--system-prompt":
        systemPrompt = args[++i];
        break;
      case "-l":
      case "--local":
        local = true;
        break;
      case "-v":
      case "--version":
      case "version":
        command = "version";
        break;
      case "-h":
      case "--help":
      case "help":
        command = "help";
        break;
      case "update":
        command = "update";
        break;
      case "profiles":
        command = "profiles";
        break;
      case "mcp":
        command = "mcp";
        subCommand = args[++i];
        subArg = args[++i];
        break;
      case "prompt":
      case "-p":
        command = "prompt";
        promptText = args.slice(i + 1).join(" ");
        i = args.length; // Exit loop
        break;
      case "doctor":
        command = "doctor";
        doctorArgs = args.slice(i + 1);
        i = args.length; // Exit loop
        break;
      case "--":
        // Everything after a bare `--` is forwarded verbatim to `claude`.
        passthrough = args.slice(i + 1);
        i = args.length; // Exit loop
        break;
      default:
        if (!arg.startsWith("-")) {
          // Might be an unknown command
          error(`Unknown command: ${arg}. Use 'workos help' for usage.`);
        }
    }
  }

  // Handle commands
  switch (command) {
    case "version":
      await cmdVersion();
      break;
    case "help":
      cmdHelp();
      break;
    case "update":
      await cmdUpdate();
      break;
    case "profiles":
      cmdProfiles();
      break;
    case "mcp":
      if (subCommand === "list") {
        cmdMcpList();
      } else if (subCommand === "set" && subArg) {
        setMcpProfile(subArg);
      } else {
        error("Usage: k mcp list | k mcp set <profile>");
      }
      break;
    case "prompt":
      if (!promptText) {
        error("Usage: k prompt \"your prompt here\"");
      }
      await cmdPrompt(promptText);
      break;
    case "doctor":
      cmdDoctor(doctorArgs);
      break;
    default:
      // Launch with options
      await cmdLaunch({ mcp, resume, resumeId, local, systemPrompt, passthrough });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
