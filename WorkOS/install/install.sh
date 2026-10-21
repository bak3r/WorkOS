#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#   WorkOS — One-Line Bootstrap Installer
#   WORKOS_REPO=<owner/name> bash install.sh   (or WORKOS_SRC=<dir> — see below)
#
#   Unlike a whole-harness install, this does NOT clobber your setup.
#   It drops the WorkOS skill into your existing harness, then hands off
#   to the agentic `/WorkOS setup`, which (with your permission) does the
#   conflict detection, the principal conversation, the TELOS work-goals
#   interview (role now + where you want to be), pulls in any sources you provide, and
#   wires hooks — adapting to YOUR OS and harness as it goes.
#
#   What this script does (the bootstrap only):
#     1. Verifies prerequisites (curl, bash, tar; offers to install bun)
#     2. Detects your harness + any existing WorkOS install (no clobber)
#     3. Fetches the latest WorkOS release (or uses $WORKOS_SRC locally)
#     4. Places the WorkOS skill additively into your skills dir
#     5. Hands off to `/WorkOS setup` (the agentic onboarding)
#
#   Local/offline install (no network):
#     WORKOS_SRC=/path/to/WORKOS_RELEASES/<version> bash install.sh
#
#   Supply-chain handling — best-effort, and honest about where it stops
#   (public issue #1726, @rpriven; fallback tag: #1694):
#     • COMMIT-PINNED DOWNLOAD. Resolving a tag and then downloading
#       archive/refs/tags/<tag>.tar.gz are two separate requests, and a tag can
#       be force-moved in between (that is exactly how this repo publishes, see
#       CreateRelease). So we resolve the tag to its commit SHA and download
#       archive/<sha>.tar.gz — what was resolved is what is fetched. If SHA
#       resolution fails we fall back to the tag tarball and SAY SO out loud.
#     • CHECKSUM. GitHub publishes no checksum for these generated tarballs, so
#       nothing here can verify the download against an upstream signature —
#       full supply-chain verification is not achievable from this script alone.
#       What it does: download to a file, sha256 it BEFORE extracting, and print
#       the digest. Set WORKOS_EXPECTED_SHA256=<hex> to hard-fail on a mismatch,
#       using a value obtained out of band (a prior install, another machine,
#       someone you trust). Caveat worth knowing: GitHub does not guarantee its
#       generated archives are byte-stable forever — a server-side compression
#       change alters the digest without the content changing. Compare digests
#       across machines at the same point in time, not against an old note.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ─── Release resolution — always the latest published release ─────
# No pin: this resolves the newest GitHub Release at run time, so every new
# release reaches every installer with zero edits here. Override with
# WORKOS_VERSION=x.y.z (or WORKOS_TAG=vx.y.z) to force a specific version.
# Resolution order: (1) the releases/latest HTML redirect — NOT subject to the
# anonymous API rate limit (60/hr/IP) that made the old API-only path fail on
# shared IPs; (2) the GitHub API; (3) a stamped fallback tag, WITH a warning.
# WORKOS_FALLBACK_TAG is stamped to the release version by EmitSkill at emit
# time — never edit it by hand, and never trust it silently (2026-07-12: a
# rate-limited API call silently installed v7.0.0 after v7.1.1 had shipped).
# The value in SOURCE still has to name a real release: EmitSkill only rewrites
# it on the emit path, and it had drifted to v7.3.2, a tag that was never
# published — so any source-run install that reached the fallback 404'd
# (public issue #1694). Corrected to the newest published release.
# Repo owner/name is parameterized — there is no default remote; pass
# WORKOS_REPO=<owner/name> for a network install, or WORKOS_SRC=<dir> (preferred).
WORKOS_REPO="${WORKOS_REPO:-OWNER/REPO}"
WORKOS_FALLBACK_TAG="v1.0.0"
if [ -n "${WORKOS_VERSION:-}" ]; then
  WORKOS_TAG="v${WORKOS_VERSION}"
elif [ -n "${WORKOS_SRC:-}" ] || [ "$WORKOS_REPO" = "OWNER/REPO" ]; then
  # Local install (the normal path in a deny-all sandbox): no network probe.
  # The tag is only a label here; the files come from WORKOS_SRC.
  WORKOS_TAG="${WORKOS_TAG:-$WORKOS_FALLBACK_TAG}"
elif [ -z "${WORKOS_TAG:-}" ]; then
  # 1) Redirect probe: github.com/<repo>/releases/latest 302s to .../releases/tag/vX.Y.Z
  WORKOS_TAG="$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
    "https://github.com/${WORKOS_REPO}/releases/latest" 2>/dev/null \
    | sed -n 's|.*/releases/tag/||p' || true)"
  # 2) API fallback (rate-limited for anonymous callers, so it's second)
  if [ -z "$WORKOS_TAG" ]; then
    WORKOS_TAG="$(curl -fsSL "https://api.github.com/repos/${WORKOS_REPO}/releases/latest" 2>/dev/null \
      | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true)"
  fi
  # 3) Stamped fallback — loud, never silent
  if [ -z "$WORKOS_TAG" ]; then
    WORKOS_TAG="$WORKOS_FALLBACK_TAG"
    echo "WARNING: could not resolve the latest release from GitHub (network/rate limit)." >&2
    echo "WARNING: installing pinned fallback ${WORKOS_FALLBACK_TAG} — a newer release may exist." >&2
    echo "WARNING: re-run later, or force one with WORKOS_VERSION=x.y.z" >&2
  fi
fi
# Harden the resolved tag before it is used ANYWHERE: it flows into a download
# URL and file paths below. A hostile release name or env override (e.g.
# $'v1\n...') must never reach those sinks, so allow only GitHub's tag charset
# and reject empty. Runs before the first interpolation on purpose.
case "$WORKOS_TAG" in
  ""|*[!A-Za-z0-9._-]*)
    printf 'FATAL: WORKOS_TAG is empty or contains disallowed characters; refusing to continue: %s\n' \
      "$(printf '%s' "$WORKOS_TAG" | tr -d '\n\r' | cut -c1-80)" >&2
    exit 1 ;;
esac
WORKOS_VERSION="${WORKOS_TAG#v}"
# Only an explicit override is honoured here — the default URL is built in Step
# 3, after the tag has been pinned to the commit SHA it resolved to.
WORKOS_TARBALL_URL="${WORKOS_TARBALL_URL:-}"
# Where the WorkOS skill dir lives inside the release tree:
WORKOS_RELEASE_SUBPATH="${WORKOS_RELEASE_SUBPATH:-WorkOS}"
# Local source override — point at a WORKOS_RELEASES/<version> dir to install offline.
WORKOS_SRC="${WORKOS_SRC:-}"
# Target skills dir (auto-detected below; override to force).
WORKOS_SKILLS_DIR="${WORKOS_SKILLS_DIR:-}"
DRY_RUN="${DRY_RUN:-0}"

# ─── Colors / helpers ────────────────────────────────────────────
if [ -t 1 ]; then
  BLUE='\033[38;2;59;130;246m'; LIGHT_BLUE='\033[38;2;147;197;253m'
  DARK_BLUE='\033[38;2;29;78;216m'; GREEN='\033[38;2;34;197;94m'; YELLOW='\033[38;2;234;179;8m'
  RED='\033[38;2;239;68;68m'; DIM='\033[38;2;71;85;105m'; RESET='\033[0m'; BOLD='\033[1m'
else
  BLUE='' LIGHT_BLUE='' DARK_BLUE='' GREEN='' YELLOW='' RED='' DIM='' RESET='' BOLD=''
fi
info()    { printf "  ${BLUE}ℹ${RESET} %b\n" "$1"; }
success() { printf "  ${GREEN}✓${RESET} %b\n" "$1"; }
warn()    { printf "  ${YELLOW}⚠${RESET} %b\n" "$1"; }
error()   { printf "  ${RED}✗${RESET} %b\n" "$1" >&2; }
step()    { printf "\n${BOLD}${LIGHT_BLUE}▸ %s${RESET}\n" "$1"; }
run()     { if [ "$DRY_RUN" = "1" ]; then echo "  [DRY-RUN] $*"; else "$@"; fi; }
# sha256 of a file using whatever the platform ships — macOS has shasum, most
# Linux distros have sha256sum, and some have both. Prints the bare hex digest,
# or nothing at all when neither exists (callers must handle the empty string).
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  fi
}

printf "\n  ${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
printf "  ${BOLD}${DARK_BLUE}Work${BLUE}O${LIGHT_BLUE}S${RESET}   ${BOLD}the work operating system${RESET}      ${DIM}current state ${BLUE}→${DIM} ideal state${RESET}   ${DIM}·${RESET}   ${LIGHT_BLUE}v%s bootstrap${RESET}\n" "$WORKOS_VERSION"
printf "  ${LIGHT_BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n\n"
[ "$DRY_RUN" = "1" ] && warn "DRY-RUN mode — no changes will be made."

# ─── Step 1: Prereqs ─────────────────────────────────────────────
step "1/5  Checking prerequisites"
OS="$(uname -s)"
case "$OS" in
  Darwin) info "Platform: macOS" ;;
  Linux)  info "Platform: Linux" ;;
  *)      warn "Unrecognized OS: $OS — proceeding; the setup will adapt." ;;
esac

need() { command -v "$1" >/dev/null 2>&1 && success "$1 ($(command -v "$1"))" || { error "Required: $1"; return 1; }; }
FAIL=0
# curl is only needed to fetch a release — a local WORKOS_SRC install runs without it.
[ -n "$WORKOS_SRC" ] || need curl || FAIL=1
need bash || FAIL=1
need tar  || FAIL=1
[ $FAIL -ne 0 ] && { error "Install the missing prerequisites and re-run."; exit 1; }

# WorkOS needs bun >= 1.2.21: hooks use Bun.YAML (added in 1.2.21), and bun.lock
# uses the v6 lockfile format, which bun < 1.2 cannot parse. So we require bun AND
# a modern-enough bun — auto-installing (which pulls the latest) via the same
# official installer whether bun is absent OR too old.
BUN_MIN_MAJOR=1
BUN_MIN_MINOR=2
BUN_MIN_PATCH=21
BUN_MIN="${BUN_MIN_MAJOR}.${BUN_MIN_MINOR}.${BUN_MIN_PATCH}"
bun_too_old() {
  # returns 0 (true) when the installed bun is older than $BUN_MIN
  local v major minor patch
  v="$(bun --version 2>/dev/null | head -n1 | tr -d '[:space:]' || true)"
  [ -z "$v" ] && return 0
  major="${v%%.*}"; minor="${v#*.}"; patch="${minor#*.}"; minor="${minor%%.*}"; patch="${patch%%[!0-9]*}"
  case "$major" in ''|*[!0-9]*) return 0 ;; esac
  case "$minor" in ''|*[!0-9]*) minor=0 ;; esac
  case "$patch" in ''|*[!0-9]*) patch=0 ;; esac
  [ "$major" -ne "$BUN_MIN_MAJOR" ] && { [ "$major" -lt "$BUN_MIN_MAJOR" ]; return; }
  [ "$minor" -ne "$BUN_MIN_MINOR" ] && { [ "$minor" -lt "$BUN_MIN_MINOR" ]; return; }
  [ "$patch" -lt "$BUN_MIN_PATCH" ]
}
install_bun() {
  # Dry-run must simulate end-to-end: the run wrapper suppresses the install,
  # so the postcondition check would abort the simulation (Forge audit, 2026-07-30).
  if [ "$DRY_RUN" = "1" ]; then info "[DRY-RUN] Would install bun (curl -fsSL https://bun.sh/install | bash)"; return 0; fi
  if [ "${WORKOS_AUTO_INSTALL_BUN:-1}" = "1" ] && [ -z "${CI:-}" ] && [ -t 0 ]; then
    info "Installing bun..."
    run bash -c "curl -fsSL https://bun.sh/install | bash"
    [ -f "$HOME/.bun/bin/bun" ] && export PATH="$HOME/.bun/bin:$PATH" && hash -r && success "bun installed" \
      || { error "bun install failed"; exit 1; }
  else
    error "Install bun ≥ ${BUN_MIN} first:  ${BOLD}curl -fsSL https://bun.sh/install | bash${RESET}"; exit 1
  fi
}

if ! command -v bun >/dev/null 2>&1; then
  warn "bun not found — WorkOS tools need it."
  install_bun
elif bun_too_old; then
  warn "bun $(bun --version 2>/dev/null) is too old — WorkOS needs bun ≥ ${BUN_MIN} (Bun.YAML in hooks, v6 bun.lock format)."
  install_bun
fi
if [ "$DRY_RUN" != "1" ] && bun_too_old; then
  error "bun is still older than ${BUN_MIN} ($(bun --version 2>/dev/null)). Upgrade with ${BOLD}bun upgrade${RESET} and re-run."; exit 1
fi
success "bun ($(command -v bun), v$(bun --version 2>/dev/null))"

# ─── Step 2: Detect harness (no clobber) ─────────────────────────
step "2/5  Detecting your harness"
if [ -z "$WORKOS_SKILLS_DIR" ]; then
  # An explicit CLAUDE_CONFIG_DIR always wins (the sbx sets <workspace>/.claude and
  # links it into ~/.claude) — same rule as Tools/DetectEnv.ts configRoot.
  if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then WORKOS_SKILLS_DIR="${CLAUDE_CONFIG_DIR%/}/skills"
  elif [ -d "$HOME/.claude" ]; then WORKOS_SKILLS_DIR="$HOME/.claude/skills"
  elif [ -d "$HOME/.config/claude" ]; then WORKOS_SKILLS_DIR="$HOME/.config/claude/skills"
  else WORKOS_SKILLS_DIR="$HOME/.claude/skills"; fi
fi
info "Skills dir: ${BOLD}${WORKOS_SKILLS_DIR/#$HOME/~}${RESET}"
TARGET="$WORKOS_SKILLS_DIR/WorkOS"
if [ -e "$TARGET" ]; then
  info "Existing WorkOS skill found — it will be backed up AFTER the new release is fetched."
else
  success "No existing WorkOS skill — clean drop-in."
fi

# ─── Step 3: Fetch the WorkOS release ────────────────────────────
step "3/5  Fetching WorkOS ${WORKOS_TAG}"
TMP_DIR="$(mktemp -d -t workos-install-XXXXXX)"
# The EXIT trap also restores the backed-up skill if we die MID-PLACEMENT —
# command failure alone was handled, but SIGINT/SIGTERM during the copy left
# no active skill despite the transactional promise (Forge audit, 2026-07-30).
PLACEMENT_BACKUP=""
PLACEMENT_DONE=0
restore_on_abort() {
  rm -rf "$TMP_DIR"
  if [ -n "$PLACEMENT_BACKUP" ] && [ "$PLACEMENT_DONE" = "0" ] && [ -d "$PLACEMENT_BACKUP" ]; then
    rm -rf "$TARGET" 2>/dev/null || true
    mv "$PLACEMENT_BACKUP" "$TARGET" 2>/dev/null || true
    echo "Aborted mid-placement — previous WorkOS skill restored from backup." >&2
  fi
}
# Signals must EXIT (which fires the EXIT trap above) — a handler that merely
# restores would let bash resume the script afterward and reinstall over the
# restored backup (bash defers traps until the foreground child returns).
trap restore_on_abort EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -n "$WORKOS_SRC" ]; then
  info "Local source: ${WORKOS_SRC/#$HOME/~}"
  SRC_SKILL="$WORKOS_SRC/$WORKOS_RELEASE_SUBPATH"
  [ -d "$SRC_SKILL" ] || { error "WorkOS skill not found at $SRC_SKILL"; exit 1; }
else
  info "Downloading ${WORKOS_TAG} (HTTPS, no auth)..."
  if [ "$WORKOS_REPO" = "OWNER/REPO" ]; then
    error "Network install needs WORKOS_REPO set (owner/name), or use WORKOS_SRC for a local install."; exit 1
  fi
  # Pin the download to the commit the tag pointed at AT RESOLUTION TIME. The
  # tag→tarball gap is a real window here: releases force-move tags, so the two
  # requests could disagree. Resolution is read-only, so it runs in dry-run too.
  WORKOS_COMMIT=""
  if [ -z "$WORKOS_TARBALL_URL" ]; then
    # 1) API — the vnd.github.sha media type answers with the bare 40-char SHA.
    WORKOS_COMMIT="$(curl -fsSL -H 'Accept: application/vnd.github.sha' \
      "https://api.github.com/repos/${WORKOS_REPO}/commits/${WORKOS_TAG}" 2>/dev/null \
      | tr -d '[:space:]' || true)"
    # 2) git ls-remote — no anonymous API rate limit. An annotated tag resolves
    #    to the tag OBJECT on refs/tags/<tag>, so prefer the ^{} peeled line.
    if ! printf '%s' "$WORKOS_COMMIT" | grep -qE '^[0-9a-f]{40}$'; then
      if command -v git >/dev/null 2>&1; then
        LS_REMOTE="$(git ls-remote "https://github.com/${WORKOS_REPO}.git" \
          "refs/tags/${WORKOS_TAG}" "refs/tags/${WORKOS_TAG}^{}" 2>/dev/null || true)"
        # `|| true` on both: a non-matching grep is a normal outcome here, and
        # under `set -o pipefail` its exit 1 would abort the whole install.
        WORKOS_COMMIT="$(printf '%s\n' "$LS_REMOTE" | grep '\^{}$' | head -n 1 | cut -f1 || true)"
        [ -n "$WORKOS_COMMIT" ] || WORKOS_COMMIT="$(printf '%s\n' "$LS_REMOTE" | head -n 1 | cut -f1 || true)"
        WORKOS_COMMIT="$(printf '%s' "$WORKOS_COMMIT" | tr -d '[:space:]')"
      fi
    fi
    if printf '%s' "$WORKOS_COMMIT" | grep -qE '^[0-9a-f]{40}$'; then
      WORKOS_TARBALL_URL="https://github.com/${WORKOS_REPO}/archive/${WORKOS_COMMIT}.tar.gz"
      info "Pinned ${WORKOS_TAG} to commit ${WORKOS_COMMIT}"
    else
      WORKOS_COMMIT=""
      WORKOS_TARBALL_URL="https://github.com/${WORKOS_REPO}/archive/refs/tags/${WORKOS_TAG}.tar.gz"
      warn "Could not resolve ${WORKOS_TAG} to a commit SHA — downloading the TAG tarball instead."
      warn "That tag can move between now and the download; check the printed sha256 if that matters to you."
    fi
  else
    info "Using WORKOS_TARBALL_URL override — no commit pinning."
  fi

  TARBALL="$TMP_DIR/workos-${WORKOS_TAG}.tar.gz"
  if [ "$DRY_RUN" = "1" ]; then
    # The download is suppressed, so the postconditions below would abort the
    # simulation against an empty TMP_DIR (Forge audit, 2026-07-30 — same class
    # as the install_bun postcondition). Simulate the resolved path.
    info "[DRY-RUN] Would download $WORKOS_TARBALL_URL, sha256 it, then extract it"
    SRC_SKILL="$TMP_DIR/[dry-run-extracted]/$WORKOS_RELEASE_SUBPATH"
    info "[DRY-RUN] Would extract the tarball and resolve the skill at .../$WORKOS_RELEASE_SUBPATH"
  else
    # Download to a FILE, hash it, THEN extract — never `curl | tar`, which
    # extracts bytes nobody ever looked at and leaves nothing to compare.
    curl -fsSL -o "$TARBALL" "$WORKOS_TARBALL_URL" \
      || { error "Download failed: $WORKOS_TARBALL_URL"; exit 1; }
    TARBALL_SHA256="$(sha256_of "$TARBALL")"
    if [ -n "$TARBALL_SHA256" ]; then
      printf "\n  ${BOLD}sha256 of the downloaded tarball${RESET}\n  ${BOLD}${LIGHT_BLUE}%s${RESET}\n" "$TARBALL_SHA256"
      printf "  ${DIM}%s${RESET}\n\n" "$WORKOS_TARBALL_URL"
    else
      warn "Neither shasum nor sha256sum is installed — cannot hash the download."
    fi
    if [ -n "${WORKOS_EXPECTED_SHA256:-}" ]; then
      if [ -z "$TARBALL_SHA256" ]; then
        error "WORKOS_EXPECTED_SHA256 is set but no sha256 tool is available — refusing to install unverified."; exit 1
      fi
      EXPECTED_SHA256="$(printf '%s' "$WORKOS_EXPECTED_SHA256" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
      if [ "$EXPECTED_SHA256" != "$TARBALL_SHA256" ]; then
        error "sha256 MISMATCH — refusing to install."
        error "  expected: $EXPECTED_SHA256"
        error "  actual:   $TARBALL_SHA256"
        exit 1
      fi
      success "sha256 matches WORKOS_EXPECTED_SHA256"
    fi
    tar -xzf "$TARBALL" -C "$TMP_DIR" \
      || { error "Extraction failed — the download may be truncated or corrupt."; exit 1; }
    rm -f "$TARBALL"
    EXTRACTED="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    SRC_SKILL="$EXTRACTED/$WORKOS_RELEASE_SUBPATH"
    [ -d "$SRC_SKILL" ] || { error "WorkOS skill not in tarball at $WORKOS_RELEASE_SUBPATH"; exit 1; }
  fi
fi
if [ -n "${WORKOS_COMMIT:-}" ]; then success "Fetched ${WORKOS_TAG} (commit ${WORKOS_COMMIT})"; else success "Fetched ${WORKOS_TAG}"; fi

# Back up the existing skill ONLY now that a usable source is in hand. Doing this
# in Step 2 meant any Step 3 failure — an unset WORKOS_REPO, a missing local
# source, a network error — left the user with no active WorkOS skill and a
# backup directory they had to find themselves.
if [ -e "$TARGET" ]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  warn "Existing WorkOS skill — backing up ONLY it to WorkOS.backup-$TS (your other files are untouched)."
  run mv "$TARGET" "$TARGET.backup-$TS"
  [ "$DRY_RUN" = "1" ] || PLACEMENT_BACKUP="$TARGET.backup-$TS"
fi

# ─── Step 4: Place the skill (additive) ──────────────────────────
step "4/5  Installing the WorkOS skill (additive — nothing else touched)"
run mkdir -p "$WORKOS_SKILLS_DIR"
# Transactional placement: a failed copy (permissions, disk, interrupt) must
# restore the backup instead of leaving no active skill (Forge audit, 2026-07-30).
if [ "$DRY_RUN" = "1" ]; then
  run cp -R "$SRC_SKILL" "$TARGET"
else
  if ! cp -R "$SRC_SKILL" "$TARGET"; then
    if [ -n "${TS:-}" ] && [ -d "$TARGET.backup-$TS" ]; then
      rm -rf "$TARGET" 2>/dev/null || true
      mv "$TARGET.backup-$TS" "$TARGET"
      error "Skill copy failed — previous installation RESTORED from backup. Fix the underlying error (disk space? permissions?) and re-run."
    else
      error "Skill copy failed and no backup exists — re-run the installer after fixing the underlying error."
    fi
    exit 1
  fi
fi
PLACEMENT_DONE=1
success "WorkOS skill placed at ${TARGET/#$HOME/~}"

# Interceptor verification captures must never ride into a user's backup commit
# (public issue #1566, @xmasyx): keeping the config root under git with a private
# remote is common, and captures can contain authenticated pages. Name-anchored,
# NOT extension-anchored — both .png and .jpg captures have been observed, and a
# format change must not silently reopen the hole. Idempotent append.
GITIGNORE_TARGET="$(dirname "$WORKOS_SKILLS_DIR")/.gitignore"
# Each rule is guarded INDIVIDUALLY — a compound guard keyed on the first rule
# left older installs missing every rule added later (Forge audit, 2026-07-30).
# Direct redirection, never a path interpolated into a bash -c string — a
# single quote in HOME would terminate the quoting and reparse the path as
# shell syntax (Forge audit P1, 2026-07-30).
append_gitignore_line() {
  if [ "$DRY_RUN" = "1" ]; then echo "  [DRY-RUN] append to gitignore: $1"; else printf '%s\n' "$1" >> "$GITIGNORE_TARGET"; fi
}
CAPTURE_RULES_ADDED=0
for capture_rule in 'interceptor-screenshot-*' 'interceptor-capture-*' 'interceptor-macos-screenshot-*'; do
  if ! grep -qxF "$capture_rule" "$GITIGNORE_TARGET" 2>/dev/null; then
    if [ "$CAPTURE_RULES_ADDED" = "0" ] && ! grep -q '# Interceptor verification captures' "$GITIGNORE_TARGET" 2>/dev/null; then
      append_gitignore_line ''
      append_gitignore_line '# Interceptor verification captures — never commit (name-anchored; capture format varies)'
    fi
    append_gitignore_line "$capture_rule"
    CAPTURE_RULES_ADDED=1
  fi
done
[ "$CAPTURE_RULES_ADDED" = "1" ] && success "Backup-safety gitignore rules for Interceptor captures in place"

# ─── Step 5: Hand off to the agentic setup ───────────────────────
step "5/5  Onboarding"
if [ "$DRY_RUN" = "1" ]; then info "[DRY-RUN] Would launch /WorkOS setup"; exit 0; fi
echo
success "WorkOS is installed. Now let's set it up for YOU."
info "The rest is a conversation — it detects conflicts, asks about your work goals"
info "(TELOS: your role now + where you want to be), pulls in any sources you provide, and wires"
info "hooks with your permission. Nothing changes without you saying yes."
echo
if command -v claude >/dev/null 2>&1 && [ -z "${CLAUDECODE:-}" ]; then
  info "Launching setup..."
  exec claude "/WorkOS setup"
else
  printf "  ${BOLD}Open your harness and run:${RESET}  ${LIGHT_BLUE}/WorkOS setup${RESET}\n\n"
fi
