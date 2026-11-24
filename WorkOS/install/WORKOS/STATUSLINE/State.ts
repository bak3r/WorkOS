import { readlinkSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, join } from "node:path";
import { claudeDirFor, workosDirFor } from "../TOOLS/Paths";
import { Cache, readJson, readText } from "./Cache";
import { geometry, type Geometry } from "./Width";

export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
export function string(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
export function number(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }

/** jq's `a // b`: b unless a is null, absent or false. Zero and the empty string are kept. */
export function alt<T>(a: unknown, b: T): unknown | T { return a === null || a === undefined || a === false ? b : a; }
/** A jq value as shell text (`@sh` on a scalar): strings as-is, numbers and booleans as JSON, anything else empty. */
function scalar(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}
function numeric(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return fallback;
}

/** Cache lifetimes in seconds. */
export const TTL = {
  workQueue: 300,
} as const;

/** Claude Code reserves ~16.5% of context for compaction: usable context is 83.5% of the window, as a ×10 integer. */
export const COMPACTION_USABLE = 835;

export interface State {
  input: JsonObject;
  rawInput: string;
  settings: JsonObject;
  env: Record<string, string | undefined>;
  root: string;
  claude: string;
  now: number;
  nowMs: number;
  timezone: string;
  clock: string;
  cache: Cache;
  geometry: Geometry;
  session: string;
  /** The stdin session id, or empty when absent or unusable as a cache-file name. Sections read this, never stdin directly. */
  sessionId: string;
  transcript: string;
  model: string;
  contextPct: number;
  versions: { workos: string; algorithm: string; harness: string };
  sessionLabel: string;
  tabLabel: string;
  /** The session-mode chips (⚡ULTRACODE, ↯ FAST) with leading spaces, empty when none is on; filled by the Ultracode section. */
  ultracode: string;
  /** The same chips in their short form (⚡UC, ↯), for rows too narrow for the full words. */
  ultracodeShort: string;
  /** Claude Code's stdin `fast_mode` is true: fast mode is on for this session. */
  fastMode: boolean;
  /** True when the install root could not be made absolute: the caller prints the bare name and exits 0. */
  failClosed: boolean;
  home: string;
  currentDir: string;
  dirName: string;
  effort: string;
  outputStyle: string;
  harnessName: string;
  harnessVersion: string;
  ccVersionJson: string;
  contextMax: number;
  totalInput: number;
  daName: string;
  /** The width to persist for later re-renders: COLUMNS, null when only the cache or the default answered. */
  widthToPersist: number | null;
}

/** A literal `$HOME`, `${HOME}` or `~/` prefix is expanded, a Windows drive path is made POSIX, and anything still relative or unexpanded is refused. */
export function expandRoot(dir: string, home: string, cygpath: (path: string) => string = () => ""): string | null {
  let d = dir;
  if (d.startsWith("$HOME")) d = home + d.slice(5);
  else if (d.startsWith("${HOME}")) d = home + d.slice(7);
  else if (d.startsWith("~/")) d = `${home}/${d.slice(2)}`;
  if (!d.startsWith("/")) {
    if (!/^[A-Za-z]:[/\\]/.test(d)) return null;
    const converted = cygpath(d) || `/${d[0]!.toLowerCase()}${d.slice(d.indexOf(":") + 1).replaceAll("\\", "/")}`;
    if (!converted.startsWith("/")) return null;
    d = converted;
  }
  return d.includes("$HOME") || d.includes("${HOME}") || d.includes("~") ? null : d;
}

/** The account's home directory from the password database, for spawn contexts that arrive with $HOME unset. */
function accountHome(): string {
  try { return userInfo().homedir; } catch { return homedir(); }
}

function systemHome(env: Record<string, string | undefined>): string {
  return env.HOME || accountHome();
}

/**
 * The first non-empty, whitespace-stripped version file: the install root, then the config root the harness names
 * (CLAUDE_CONFIG_DIR, else ~/.claude) under the account's own home. An em dash when none has a value. The old bash also
 * tried a hard-coded /Users/<name> path, which is wrong on Linux and in a sandbox; the account's home replaces it.
 */
export function versionFile(rel: string, root: string, env: Record<string, string | undefined>, account: string = accountHome()): string {
  for (const path of [join(root, rel), join(claudeDirFor(env, account), "WORKOS", rel)]) {
    const value = (readText(path) ?? "").replace(/\s/g, "");
    if (value) return value;
  }
  return "—";
}

/** Settings.principal.timezone, then $TZ, the /etc/localtime link, /etc/timezone, UTC. */
export function resolveTimezone(settingsZone: string, env: Record<string, string | undefined>): string {
  if (settingsZone) return settingsZone;
  if (env.TZ) return env.TZ;
  try {
    const link = readlinkSync("/etc/localtime").replace(/.*\/zoneinfo\//, "");
    if (link) return link;
  } catch { /* not a symlink */ }
  const zone = (readText("/etc/timezone") ?? "").replace(/\s/g, "");
  return zone || "UTC";
}

export function buildState(rawInput: string, env: Record<string, string | undefined> = process.env, nowMs = Date.now()): State {
  let input: JsonObject = {};
  try { input = object(JSON.parse(rawInput)); } catch { /* Malformed input uses the defaults. */ }
  const home = systemHome(env);
  const expanded = env.WORKOS_DIR ? expandRoot(env.WORKOS_DIR, home) : null;
  const failClosed = Boolean(env.WORKOS_DIR) && expanded === null;
  const root = expanded ?? workosDirFor(env, home);
  const claude = claudeDirFor(env, home);
  const settings = object(readJson(join(claude, "settings.json")));
  const now = Math.floor(nowMs / 1000);
  const cache = new Cache(join(env.XDG_CACHE_HOME || join(home, ".cache"), "workos-statusline"), now);
  let timezone = resolveTimezone(string(object(settings.principal).timezone), env);
  let clock: string;
  try { clock = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(nowMs); }
  catch { timezone = "UTC"; clock = new Date(nowMs).toISOString().slice(11, 16); }
  // A session id that cannot name a cache file is treated as absent, so the frame degrades instead of going blank.
  const rawSession = scalar(alt(input.session_id, ""));
  const sessionId = /[\\/\0]/.test(rawSession) ? "" : rawSession;
  const session = sessionId || "nosess";
  const workspace = object(input.workspace), model = object(input.model), context = object(input.context_window), harness = object(input.harness);
  const currentDir = scalar(alt(workspace.current_dir, alt(input.cwd, "."))) || ".";
  const names = object(readJson(join(root, "MEMORY", "STATE", "session-names.json")));
  const labels = object(readJson(join(root, "MEMORY", "STATE", "session-labels.json")));
  const haveNames = readText(join(root, "MEMORY", "STATE", "session-names.json")) !== null;
  const daidentity = object(settings.daidentity);
  const columns = env.COLUMNS && /^\d+$/.test(env.COLUMNS) ? Number(env.COLUMNS) : 0;
  const cachedWidth = cache.text(`term-width-${env.KITTY_WINDOW_ID || "default"}`);
  return {
    input, rawInput, settings, env, root, claude, now, nowMs, timezone, clock, cache,
    geometry: geometry(env, cachedWidth),
    session, sessionId, transcript: scalar(alt(input.transcript_path, "")), model: scalar(alt(model.display_name, "unknown")),
    contextPct: numeric(alt(context.used_percentage, 0)),
    versions: {
      workos: versionFile("VERSION", root, env),
      algorithm: versionFile("ALGORITHM/LATEST", root, env),
      harness: scalar(alt(input.version, "")) || cache.text("cc-version-cache.txt")?.trim() || "unknown",
    },
    sessionLabel: sessionId && haveNames ? string(names[sessionId]) : "", tabLabel: sessionId && haveNames ? string(labels[sessionId]) : "", ultracode: "", ultracodeShort: "",
    failClosed, home, currentDir, dirName: basename(currentDir) || ".",
    effort: scalar(alt(object(input.effort).level, "")), fastMode: input.fast_mode === true, outputStyle: scalar(alt(object(input.output_style).name, "")),
    harnessName: scalar(alt(harness.name, "")) || "CC", harnessVersion: scalar(alt(harness.version, "")), ccVersionJson: scalar(alt(input.version, "")),
    contextMax: numeric(alt(context.context_window_size, 200000), 200000), totalInput: numeric(alt(context.total_input_tokens, 0)),
    daName: scalar(alt(daidentity.name, alt(daidentity.displayName, alt(object(settings.env).DA, "Assistant")))) || "Assistant",
    widthToPersist: columns > 0 ? columns : null,
  };
}
