/**
 * Boundary — path confinement for WorkOS tools.
 *
 *   confinedPath(root, p)      the real path of `p` when it stays inside `root`, else null. Every
 *                              existing component is resolved physically (symlinks followed, `..`
 *                              taken from the real parent), never folded lexically first.
 *
 * Ported from upstream LifeOS 8.761.0 LIFEOS/TOOLS/lib/Boundary.ts, confinedPath only. Upstream's
 * atomicWrite, withLock and redact live elsewhere in WorkOS (lib/atomic-write.ts) or are not ported.
 * @version 1.0.0
 */

import { lstatSync, realpathSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, sep } from "node:path"

// ── confinedPath ─────────────────────────────────────────────────────────────

function within(real: string, realRoot: string): boolean {
  if (real === realRoot) return true
  const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep
  return real.startsWith(prefix)
}

function errCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code
}

/**
 * The real path `p` names when it stays inside `root`, or null. A relative `p` is walked from the
 * real root and refused the moment it leaves it; an absolute `p` is walked from `/` and judged by
 * where it lands. Each existing component is resolved through the filesystem, so `link/../x` with
 * `link` pointing outside goes where the kernel would go. After the first missing component the
 * rest is appended as written. Refused (null): a missing root, `..` after a missing component, a
 * dangling or looping symlink, a component under a file, and any result outside the root.
 */
export function confinedPath(root: string, p: string): string | null {
  if (typeof root !== "string" || root === "" || typeof p !== "string") return null
  let realRoot: string
  try { realRoot = realpathSync(root) } catch { return null }

  const relative = !isAbsolute(p)
  let cur = relative ? realRoot : sep
  let curIsDir = true
  let missing = false
  const tail: string[] = []

  for (const comp of p.split(sep)) {
    if (comp === "" || comp === ".") continue
    if (missing) {
      if (comp === "..") return null
      tail.push(comp)
      continue
    }
    if (!curIsDir) return null
    if (comp === "..") {
      cur = dirname(cur)
    } else {
      const next = cur === sep ? sep + comp : cur + sep + comp
      let st
      try { st = lstatSync(next) } catch (e) {
        if (errCode(e) === "ENOENT") { missing = true; tail.push(comp); continue }
        return null
      }
      if (st.isSymbolicLink()) {
        try { cur = realpathSync(next) } catch { return null }
        try { curIsDir = statSync(cur).isDirectory() } catch { return null }
      } else {
        cur = next
        curIsDir = st.isDirectory()
      }
    }
    if (relative && !within(cur, realRoot)) return null
  }

  const result = tail.length ? join(cur, ...tail) : cur
  return within(result, realRoot) ? result : null
}

