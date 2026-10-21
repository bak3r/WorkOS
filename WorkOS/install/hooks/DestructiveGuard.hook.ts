#!/usr/bin/env bun
/**
 * @version 1.0.0
 * DestructiveGuard.hook.ts — hard-blocks destructive and credential-exfil Bash shapes.
 *
 * Why this exists: Safety.hook.ts only runs on PermissionRequest, which never
 * fires in bypassPermissions / dontAsk mode (the Docker Sandboxes TUI launches
 * `claude --dangerously-skip-permissions`). There, a dangerous-shape command
 * would run with no prompt at all. This guard runs on PreToolUse in EVERY mode
 * (principal decision 2026-10-21: "always block") and refuses the shapes below.
 *
 * Scope is deliberately narrower than the classifier's `dangerous-shape` set:
 * interpreter one-liners (`node -e`, `python -c` …) and plain `.env` reads stay
 * with the normal permission flow, because blocking them would stop everyday
 * work. What is blocked here is what nobody runs by accident:
 *   - recursive deletes of /, system top-level dirs, the home dir itself, ~/.claude
 *   - curl|wget|base64 piped into a shell, eval/bash -c of a download
 *   - raw disk writes, mkfs, fork bombs, chmod -R 777
 *   - reverse shells (nc -l/-e, /dev/tcp|udp)
 *   - privileged / host-root / $HOME-mounting docker run
 *   - force-push or hard reset on main/master/prod, history rewrites, ref deletion
 *   - attaching to another process (gdb/lldb/strace -p, dtrace)
 *   - reading private keys / cloud credentials / process environ
 *   - sending .env or credential files over the network
 *
 * Matching runs on buildShapeTargets() from lib/safety-classifier, so quoting,
 * `bash -c '…'`, env-prefix wrappers, $(…)/backtick substitutions and backslash
 * escapes are seen through exactly as the classifier sees through them.
 *
 * FAIL-OPEN on internal error (same isolation contract as the other PreToolGuard
 * checks); the patterns are pure regexes over the command string.
 */

import { readFileSync } from "node:fs";
import { buildShapeTargets } from "./lib/safety-classifier";

interface HookInput {
  tool_name?: string;
  tool_input?: { command?: unknown };
}

const SYSTEM_DIRS =
  "bin|boot|dev|etc|lib|lib32|lib64|opt|proc|root|sbin|srv|sys|usr|var|home|Users|System|Library|Applications|private";

/** Recursive rm flags: -r/-R anywhere in a short-flag cluster, or --recursive. */
const RM_RECURSIVE = String.raw`\brm\s+(?:-[A-Za-z]*\s+)*(?:-[A-Za-z]*[rR][A-Za-z]*|--recursive)\b(?:\s+-{1,2}[A-Za-z-]+)*\s+`;
/** End of a path argument: whitespace, glob, quote, separator or end of string. */
const PATH_END = String.raw`(?=$|\s|\*|'|"|;|&|\|)`;

export const DESTRUCTIVE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp(`${RM_RECURSIVE}(?:\\/|\\/\\*|\\/(?:${SYSTEM_DIRS})\\/?)${PATH_END}`), "recursive delete of / or a system directory"],
  [new RegExp(`${RM_RECURSIVE}(?:~|~\\/|~\\/\\*|\\$HOME|\\$\\{HOME\\}|\\$HOME\\/\\*?|\\$\\{HOME\\}\\/\\*?)${PATH_END}`), "recursive delete of the home directory"],
  [new RegExp(`${RM_RECURSIVE}(?:~|\\$HOME|\\$\\{HOME\\}|\\$CLAUDE_CONFIG_DIR|\\$\\{CLAUDE_CONFIG_DIR\\})\\/\\.claude\\/?${PATH_END}|${RM_RECURSIVE}(?:\\$CLAUDE_CONFIG_DIR|\\$\\{CLAUDE_CONFIG_DIR\\})\\/?${PATH_END}`), "recursive delete of the Claude Code config root"],
  [/\brm\b[^|;&]*--no-preserve-root\b/, "rm --no-preserve-root"],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|dash|ksh)\b/i, "download piped into a shell"],
  [/\bbase64\s+(-d|--decode)\b[^|]*\|\s*(sh|bash|zsh)\b/i, "decoded payload piped into a shell"],
  [/\beval\s+["']?\$\((curl|wget)\b/, "eval of a download"],
  [/\b(bash|sh|zsh)\s+-c\s+["']?\$\((curl|wget)\b/, "shell -c of a download"],
  [/\bdd\s+(?:\S+\s+)*of=\/dev\/(?!null\b|zero\b|stdout\b|stderr\b)/, "raw write to a device"],
  [/\bmkfs(\.[a-z0-9]+)?\b/, "filesystem format"],
  [/:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;\s*:/, "fork bomb"],
  [/\bchmod\s+(-[A-Za-z]*R[A-Za-z]*\s+)+0?777\b/, "recursive chmod 777"],
  [/\bnc\b\s+(?:\S+\s+)*-[A-Za-z]*[le]\b/, "netcat listener or exec (reverse shell)"],
  [/\/dev\/(tcp|udp)\/[^/\s]+\/\d+/, "raw socket via /dev/tcp|udp (reverse shell)"],
  [/\bdocker\s+run\b[^|]*--privileged\b/, "privileged container"],
  [/\bdocker\s+run\b[^|]*\s(-v|--volume)[= ]\s*\/(:|\s)/, "container mounting the host root"],
  [/\bdocker\s+run\b[^|]*\s(-v|--volume)[= ]\s*(\$HOME|\$\{HOME\}|~)(\/)?(:|\s)/, "container mounting the home directory"],
  [/\bgit\s+push\b[^|;&]*(--force\b|--force-with-lease\b|\s-f\b|\s\+)[^|;&]*\b(main|master|production|prod)\b/, "force-push to a protected branch"],
  [/\bgit\s+push\b[^|;&]*\s\+?(main|master|production|prod)\b[^|;&]*(--force\b|--force-with-lease\b|\s-f\b)/, "force-push to a protected branch"],
  [/\bgit\s+push\b[^|;&]*\s\+(main|master|production|prod)\b/, "force-push to a protected branch"],
  [/\bgit\s+reset\s+--hard\s+\S*\b(main|master|production|prod)\b/, "hard reset onto a protected branch"],
  [/\bgit\s+(filter-branch|filter-repo)\b/, "history rewrite"],
  [/\bgit\s+update-ref\s+-d\b/, "ref deletion"],
  [/\b(gdb|lldb|strace)\s+(?:[^|]*\s)?-p\b/, "attach to another process"],
  [/\bdtrace\b/, "kernel tracing"],
  [/\.ssh\/(id_[a-z0-9]+|[a-z0-9_-]+_rsa|[a-z0-9_-]+_ed25519)(?!\.pub)\b/, "private SSH key access"],
  [/\.aws\/credentials\b/, "cloud credential file access"],
  [/\.gnupg\/(private-keys|secring)/, "private GPG key access"],
  [/\/proc\/(?:self|\d+|\*|\$\$|\$\{\w+\}|\$\w+)\/(environ|mem)\b/, "process environment or memory read"],
];

/** A secret-bearing file named in the same command as a network sender. */
const SECRET_FILE = /(^|[\s=@"'<])([~$\{\}\/A-Za-z0-9._-]+\/)?\.env(\.[A-Za-z0-9_-]+)?(?=$|[\s"';|&>)])/;
const NETWORK_SENDER = /\b(curl|wget|nc|ncat|socat|scp|sftp|rsync|ssh|ftp|http|https|xh)\b/;

export function findDestructive(command: string): string | null {
  const targets = buildShapeTargets(command);
  for (const [re, label] of DESTRUCTIVE_PATTERNS) {
    if (targets.some((t) => re.test(t))) return label;
  }
  if (targets.some((t) => SECRET_FILE.test(t) && NETWORK_SENDER.test(t))) {
    return "secret file sent over the network";
  }
  return null;
}

/** Pure check for PreToolGuard dispatch. Returns a block decision or null (allow). */
export function check(input: HookInput): { block: true; message: string } | null {
  const command = input?.tool_input?.command;
  if (typeof command !== "string" || !command.trim()) return null;
  const label = findDestructive(command);
  if (!label) return null;
  return {
    block: true,
    message:
      `[DestructiveGuard] blocked: ${label}.\n` +
      "This shape is refused in every permission mode, including bypassPermissions. " +
      "If the principal really wants it, they run it themselves in their own terminal; " +
      "otherwise use a narrower command (a specific path, a non-protected branch, no secret files).\n",
  };
}

if (import.meta.main) {
  let input: HookInput = {};
  try {
    input = JSON.parse(readFileSync(0, "utf-8"));
  } catch {
    process.exit(0);
  }
  const result = check(input);
  if (result?.block) {
    process.stderr.write(result.message);
    process.exit(2);
  }
  process.exit(0);
}
