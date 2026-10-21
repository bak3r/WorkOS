#!/usr/bin/env bun
// Normalize env path vars Claude Code may inject unexpanded — literal $HOME/${HOME}
// in WORKOS_DIR/WORKOS_CONFIG_DIR/PROJECTS_DIR resolves to a shadow dir (#1404 / PR #1451, author jbmml).
for (const __k of ["WORKOS_DIR", "WORKOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const __v = process.env[__k];
  if (__v && /^\$\{?HOME\}?(\/|$)/.test(__v)) process.env[__k] = __v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? "~");
}


/**
 * InterviewScan — comprehensive completeness scanner across the unified work
 * TELOS sections + setup/identity files. Produces a prioritized gap report so
 * `/interview` can dynamically build the conversation around what's actually missing.
 *
 * Scans every relevant target, computes completeness, weights by leverage
 * (targets that unlock other context score higher), and outputs either a
 * human-readable gap report or a JSON plan the Interview skill consumes.
 *
 * Usage:
 *   bun InterviewScan.ts                 Human-readable gap report (default)
 *   bun InterviewScan.ts --json          JSON for programmatic consumption
 *   bun InterviewScan.ts --next          Show single next priority target + prompts
 *   bun InterviewScan.ts --file <path>   Deep-scan single file
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { readTelosFreshness, sectionSlug, legacyTelosFilePath, type SectionFreshness } from "./TelosFreshness";
import { homedir } from "node:os";
import { getDAName } from "../../hooks/lib/identity";

// Normalize env path vars that Claude Code injects without shell expansion (WorkOS#1404)
for (const k of ["WORKOS_DIR", "WORKOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const v = process.env[k];
  if (v && /^\$\{?HOME\}?(\/|$)/.test(v)) process.env[k] = v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? "~");
}


const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const WORKOS_DIR = process.env.WORKOS_DIR || join(HOME, ".claude", "WORKOS");
const USER_DIR = join(WORKOS_DIR, "USER");
const TELOS_DIR = join(USER_DIR, "TELOS");
const TELOS_PATH = join(TELOS_DIR, "TELOS.md");
const DA_NAME = getDAName();

type Category = "setup" | "foundational" | "ideal_state" | "current_state" | "context" | "identity";

// Phases drive interview ordering. Phase 0 = first-run setup (DA/Principal
// identity, credentials, projects, work ledger + integrations). Phase 1 = foundational work
// TELOS context (the core of the recurring interview). Phase 9 = deferred.
type Phase = 0 | 1 | 2 | 3 | 4 | 9;

type Target = {
  path: string;
  name: string;
  category: Category;
  phase: Phase;
  leverage: number; // 1-10 — higher = more valuable within its phase
  content_length: number;
  tbd_count: number;
  seed_markers: number;
  empty_sections: number;
  required_fields_missing: string[];
  completeness_score: number; // 0-100
  priority: number; // computed — includes phase boost so phase 1 always beats phase 2+
  review_mode: boolean; // true if ≥80% complete — interview walks through as a review, not a fill
  age_days: number | null;
  threshold_days: number;
  stale: boolean;
  why_incomplete: string[];
  prompts: string[];
};

// ─── Registry: what files are interview-targets, and their prompts ───
//
// PHASE ORDERING:
//   Phase 0 = First-run setup (DA/Principal identity, credentials, projects, work ledger + integrations)
//             — auto-skipped when every Phase 0 target is already populated
//   Phase 1 = Foundational work TELOS (role/team/stack now, goals, projects …)
//   Phase 2 = Ideal State (where you want to be at work)
//   Phase 3 = Working context (vocabulary, context filter)
//   Phase 4 = Identity + status
//   Phase 9 = Deferred

type RegistryTarget = Omit<Target, "content_length" | "tbd_count" | "seed_markers" | "empty_sections" | "required_fields_missing" | "completeness_score" | "priority" | "review_mode" | "age_days" | "threshold_days" | "stale" | "why_incomplete">;

const REGISTRY: RegistryTarget[] = [
  // ─── Phase 0: First-run setup ───
  { phase: 0, path: join(USER_DIR, "DIGITAL_ASSISTANT", "DA_IDENTITY.md"), name: "DA_IDENTITY", category: "setup", leverage: 10,
    prompts: ["What's your DA's name? (default: WorkOS)",
              "Full name and its role for you (e.g. pair programmer, reviewer)?",
              "Display color in hex (e.g. #3B82F6)?",
              "One-paragraph personality summary — direct, peer, opinionated, etc.?"] },
  { phase: 0, path: join(USER_DIR, "PRINCIPAL", "PRINCIPAL_IDENTITY.md"), name: "PRINCIPAL_IDENTITY/setup", category: "setup", leverage: 10,
    prompts: ["Your name (with pronunciation if uncommon)?",
              "Timezone (IANA zone, e.g. Europe/Berlin)?",
              "One-line role / what you do at work?",
              "Your team — its name, what it owns, and the systems you are responsible for?",
              "One-line focus — what you're working on right now?"] },
  { phase: 0, path: join(HOME, ".claude", ".env"), name: ".env/credentials", category: "setup", leverage: 10,
    prompts: ["Model access comes from the harness's own auth (e.g. Bedrock in the sandbox) — nothing to store here. Which optional skill keys do you use (APIFY_TOKEN, BRIGHTDATA_API_KEY)? Paste them here (will write to .env, won't echo back).",
              "GH_TOKEN — optional, only if you want the work pipeline. Skip if not using GitHub issues.",
              "Any other API tokens your work tooling needs stored?"] },
  { phase: 0, path: join(USER_DIR, "PROJECTS.md"), name: "PROJECTS/setup", category: "setup", leverage: 8,
    prompts: ["At least one project so routing works — name, local path, repo URL, build/test command, stack?",
              "What aliases would you use to refer to it conversationally? (e.g. \"the api\", \"the settlement service\")"] },
  { phase: 0, path: join(USER_DIR, "WORK", "config.yaml"), name: "WORK/config", category: "setup", leverage: 7,
    prompts: ["Work ledger — keep local work capture on (default), or set enabled: false in WORK/config.yaml?",
              "Read-only Jira/GitLab context — are JIRA_URL / JIRA_USERNAME / JIRA_API_TOKEN and glab + GITLAB_HOST available? Which Jira key prefixes does your team use (jira.project_keys; empty = any)?"] },

  // ─── Phase 1: Foundational work TELOS ───
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Current State")}`, name: "Current State", category: "current_state", leverage: 10,
    prompts: ["Your role right now — title, team, what you own?",
              "The stack you work in day to day — languages, frameworks, data stores, infrastructure?",
              "Where your career stands now — strengths, gaps, what you're known for on the team?"] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Goals")}`, name: "Goals", category: "foundational", leverage: 10,
    prompts: ["Goals for this sprint and this quarter — G0 through G-whatever, each with a one-line outcome?",
              "Longer career goals (promotion, scope, skills) worth tracking?",
              "Any goals agreed with your manager that aren't written down yet?"] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Projects")}`, name: "Projects", category: "foundational", leverage: 9,
    prompts: ["Which projects or epics are you actively working on?",
              "Which goal does each one serve?",
              "Anything you own that is stalled or waiting on someone else?"] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Problems")}`, name: "Problems", category: "foundational", leverage: 9,
    prompts: ["The problems your work exists to solve — for the product, the team, the codebase?",
              "Any problems you've identified but haven't committed a strategy to yet?"] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Strategies")}`, name: "Strategies", category: "foundational", leverage: 8,
    prompts: ["Active strategies — how are you attacking each problem?",
              "Approaches you've decided NOT to use, worth documenting?"] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Challenges")}`, name: "Challenges", category: "foundational", leverage: 7,
    prompts: ["What gets in the way at work — context switching, unclear requirements, review bottlenecks, known weak spots?",
              "Challenges you're actively working to overcome vs. just tracking?"] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Mission")}`, name: "Mission", category: "foundational", leverage: 7,
    prompts: ["Your professional mission — the one sentence for why you do this work?",
              "Anything about how you want to be as an engineer that belongs here?"] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Narratives")}`, name: "Narratives", category: "foundational", leverage: 6,
    prompts: ["Talking points for reviews, demos and 1:1s — what have you delivered and why it mattered?",
              "How do you describe your work to different audiences (team, manager, stakeholders)?"] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Team")}`, name: "Team", category: "foundational", leverage: 6,
    prompts: ["Who is on your team and adjacent teams — roles, who owns what?",
              "Who reviews your work, who do you escalate to, who depends on you?",
              `Which collaborators should ${DA_NAME} remember as first-class context?`] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Wrong (Things I've been wrong about)")}`, name: "Wrong (Things I've been wrong about)", category: "foundational", leverage: 5,
    prompts: ["What technical or process calls were you materially wrong about?",
              "Any assumptions you still half-hold but suspect are obsolete?",
              `What would you want ${DA_NAME} to challenge you on because history says you're biased there?`] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Wisdom")}`, name: "Wisdom", category: "foundational", leverage: 5,
    prompts: [`Engineering lessons learned the hard way — things you want ${DA_NAME} to remember permanently?`,
              "Any recent incident or review lesson that hasn't landed here yet?"] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Models")}`, name: "Models", category: "foundational", leverage: 4,
    prompts: ["Mental models you actively use when designing or debugging?",
              "Models you've retired or updated recently?"] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Beliefs")}`, name: "Beliefs", category: "foundational", leverage: 3,
    prompts: ["Professional beliefs that shape how you build and decide (testing, design, ownership)?",
              "Any beliefs that have changed recently worth capturing?"] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Frames")}`, name: "Frames", category: "foundational", leverage: 3,
    prompts: ["Useful ways of framing engineering trade-offs that you rely on?",
              "Frames that conflict with each other but you hold both?"] },
  { phase: 1, path: `${TELOS_PATH}#${sectionSlug("Predictions")}`, name: "Predictions", category: "foundational", leverage: 3,
    prompts: ["Predictions about your stack, product or team that deserve dates, confidence and falsification criteria?",
              "Any older predictions that should be reviewed against what actually happened?"] },

  // ─── Phase 2: Ideal State (single unified TELOS H2) ───
  { phase: 2, path: `${TELOS_PATH}#${sectionSlug("Ideal State")}`, name: "Ideal State", category: "ideal_state", leverage: 8,
    prompts: ["Where do you want to be at work in 1-2 years — role, scope, ownership?",
              "Which skills or technologies do you want to be strong in?",
              "What would your ideal team and way of working look like?"] },

  // ─── Phase 3: Working context ───
  { phase: 3, path: join(USER_DIR, "DEFINITIONS.md"), name: "DEFINITIONS/vocabulary", category: "context", leverage: 6,
    prompts: ["Domain and team vocabulary — terms, acronyms and service names that mean something specific here?",
              "Words that are easy to confuse (e.g. two services with similar names)?"] },
  { phase: 3, path: `${TELOS_PATH}#${sectionSlug("Context Filter")}`, name: "Context Filter", category: "context", leverage: 5,
    prompts: [`What should ${DA_NAME} bias toward when deciding what context matters?`,
              "Any themes that should be deprioritized or ignored unless you ask directly?",
              "What framing should guide recommendations when priorities conflict?"] },

  // ─── Phase 4: Identity + status ───
  { phase: 4, path: join(USER_DIR, "PRINCIPAL", "PRINCIPAL_IDENTITY.md"), name: "PRINCIPAL_IDENTITY", category: "identity", leverage: 8,
    prompts: ["Anything in the identity file that's out-of-date or needs refinement?",
              "Aspects of how you want to be represented that aren't captured yet?"] },
  { phase: 4, path: `${TELOS_PATH}#${sectionSlug("Status — Current Work & Recent Accomplishments")}`, name: "Status — Current Work & Recent Accomplishments", category: "current_state", leverage: 5,
    prompts: [`What recent accomplishments should ${DA_NAME} treat as current context?`,
              "Which project statuses are outdated or missing?",
              "Any strategic insight from the last few weeks that belongs in the status section?"] },
];

// ─── Scoring ───

const PLACEHOLDER_PATTERNS = [
  /\bTBD\b/g,
  /\bseed(ed)?\s+(during|through)\s+interview\b/gi,
  /\bseeded during interview\b/gi,
  /^\s*_\(.*(seeded|pending|empty|awaiting).*\)_\s*$/gim,
  /^\s*-\s*TBD\s*$/gim,
];

// Phase boost ensures setup-then-foundational ordering. Phase 0 (setup) at 100%
// drops to 0 boost so it disappears from the priority queue once configured;
// while incomplete it dominates. Phase 1 (TELOS) is the recurring core.
const PHASE_BOOST: Record<Phase, number> = { 0: 2000, 1: 1000, 2: 200, 3: 50, 4: 300, 9: 0 };

const TELOS_SECTION_PREFIX = `${TELOS_PATH}#`;
const TELOS_CONTENT = existsSync(TELOS_PATH) ? readFileSync(TELOS_PATH, "utf-8") : "";
const TELOS_SECTIONS = parseTelosSections(TELOS_CONTENT);
const freshness = readTelosFreshness();
const freshnessBySlug = new Map<string, SectionFreshness>(freshness.sections.map((sf) => [sf.slug, sf]));

function parseTelosSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const matches = [...content.matchAll(/^##\s+(.+?)\s*$/gm)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const heading = match[1].trim();
    const headingEnd = (match.index ?? 0) + match[0].length;
    const bodyStart = content.indexOf("\n", headingEnd);
    const nextStart = i + 1 < matches.length ? matches[i + 1].index ?? content.length : content.length;
    const body = content.slice(bodyStart === -1 ? headingEnd : bodyStart + 1, nextStart);
    sections.set(sectionSlug(heading), body);
  }
  return sections;
}

/**
 * Body of a TELOS section, tolerating a split-file install.
 *
 * The H2 scan over TELOS.md is the primary source. On a split-file TELOS,
 * though, TELOS.md is a thin index and the real content lives in an ALLCAPS
 * sibling — so every section scored 0% "does not exist" while the content was
 * sitting right there. A POPULATED sibling wins; an empty or missing one falls
 * back to the H2 body, so a half-made file can never hide real content.
 * Consolidating into TELOS.md is still the correct direction — this only stops
 * the scan from misreporting an install that hasn't.
 * public PR #1587, @asdf8675309
 */
function extractSectionBody(target: RegistryTarget, sections: Map<string, string>): string | null {
  if (!target.path.startsWith(TELOS_SECTION_PREFIX)) return null;
  const slug = sectionSlug(target.name);
  const h2Body = sections.get(slug) ?? null;

  const legacyPath = legacyTelosFilePath(slug, TELOS_PATH);
  if (legacyPath) {
    try {
      const raw = readFileSync(legacyPath, "utf-8");
      // Strip frontmatter so a file carrying only `---\nlast_updated: ...\n---`
      // reads as empty rather than as content.
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
      if (body.replace(/^#.*$/gm, "").trim().length > 0) return body;
    } catch {
      // Unreadable sibling — fall through to the H2 body.
    }
  }

  return h2Body;
}

function freshnessForSection(target: RegistryTarget): SectionFreshness | null {
  if (!target.path.startsWith(TELOS_SECTION_PREFIX)) return null;
  return freshnessBySlug.get(sectionSlug(target.name)) ?? null;
}

function scoreFile(target: RegistryTarget): Target {
  const result: Target = {
    ...target,
    content_length: 0,
    tbd_count: 0,
    seed_markers: 0,
    empty_sections: 0,
    required_fields_missing: [],
    completeness_score: 0,
    priority: 0,
    review_mode: false,
    age_days: null,
    threshold_days: 0,
    stale: false,
    why_incomplete: [],
  };

  if (!existsSync(target.path)) {
    result.why_incomplete.push("file does not exist");
    result.completeness_score = 0;
    result.priority = PHASE_BOOST[target.phase] + target.leverage * 2 + 100;
    return result;
  }

  const content = readFileSync(target.path, "utf-8");
  result.content_length = content.length;

  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matches = content.match(pattern);
    if (!matches) continue;
    if (pattern.source.includes("TBD")) result.tbd_count += matches.length;
    else result.seed_markers += matches.length;
  }

  // Empty sections: a heading followed by whitespace or placeholder
  const sectionMatches = content.matchAll(/^#{2,4}\s+.+\n([\s\S]*?)(?=^#{2,4}|\Z)/gm);
  for (const m of sectionMatches) {
    const body = m[1].trim();
    const substantive = body
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/_\(.*?\)_/g, "")
      .replace(/\bTBD\b/g, "")
      .trim();
    if (substantive.length < 20) result.empty_sections += 1;
  }

  // Completeness heuristic: weight content length vs. placeholders
  const placeholderPenalty = result.tbd_count * 40 + result.seed_markers * 20 + result.empty_sections * 30;
  const contentBonus = Math.min(content.length / 10, 500);
  result.completeness_score = Math.max(0, Math.min(100, 100 - placeholderPenalty / 10 + contentBonus / 50));

  // Priority: phase (dominant) + leverage + incompleteness. Phase 1 always beats Phase 2.
  const incompleteness = 100 - result.completeness_score;
  result.priority = Math.round(PHASE_BOOST[target.phase] + target.leverage * 2 + incompleteness);

  // Review mode vs. fill mode: ≥80% complete means we're reviewing, not filling.
  // Review prompts should be "here's what's there, anything to update/refine/add?"
  // Fill prompts should be "this is empty, let's populate it."
  result.review_mode = result.completeness_score >= 80;

  if (result.tbd_count > 0) result.why_incomplete.push(`${result.tbd_count} TBD markers`);
  if (result.seed_markers > 0) result.why_incomplete.push(`${result.seed_markers} "seed during interview" markers`);
  if (result.empty_sections > 0) result.why_incomplete.push(`${result.empty_sections} empty/sparse sections`);
  if (content.length < 500 && target.category !== "foundational") result.why_incomplete.push("sparse content");
  if (result.review_mode && result.why_incomplete.length === 0) result.why_incomplete.push("already substantive — review for updates/refinements");

  return result;
}

function scoreSection(target: RegistryTarget, sectionBody: string, sectionFreshness: SectionFreshness | null): Target {
  const result: Target = {
    ...target,
    content_length: sectionBody.length,
    tbd_count: 0,
    seed_markers: 0,
    empty_sections: 0,
    required_fields_missing: [],
    completeness_score: 0,
    priority: 0,
    review_mode: false,
    age_days: sectionFreshness?.ageDays ?? null,
    threshold_days: sectionFreshness?.thresholdDays ?? 0,
    stale: sectionFreshness?.stale ?? false,
    why_incomplete: [],
  };

  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matches = sectionBody.match(pattern);
    if (!matches) continue;
    if (pattern.source.includes("TBD")) result.tbd_count += matches.length;
    else result.seed_markers += matches.length;
  }

  // Empty sections: a heading followed by whitespace or placeholder
  const sectionMatches = sectionBody.matchAll(/^#{3,4}\s+.+\n([\s\S]*?)(?=^#{3,4}|\Z)/gm);
  for (const m of sectionMatches) {
    const body = m[1].trim();
    const substantive = body
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/_\(.*?\)_/g, "")
      .replace(/\bTBD\b/g, "")
      .trim();
    if (substantive.length < 20) result.empty_sections += 1;
  }

  const substantiveSection = sectionBody
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/_\(.*?\)_/g, "")
    .replace(/\bTBD\b/g, "")
    .trim();
  if (substantiveSection.length < 20) result.empty_sections += 1;

  // Completeness heuristic: weight content length vs. placeholders
  const placeholderPenalty = result.tbd_count * 40 + result.seed_markers * 20 + result.empty_sections * 30;
  const contentBonus = Math.min(sectionBody.length / 10, 500);
  result.completeness_score = Math.max(0, Math.min(100, 100 - placeholderPenalty / 10 + contentBonus / 50));

  // Priority: phase (dominant) + leverage + incompleteness. Phase 1 always beats Phase 2.
  const incompleteness = 100 - result.completeness_score;
  // Stale sections get a large bump so overdue reviews naturally rise to the top.
  result.priority = Math.round(PHASE_BOOST[target.phase] + target.leverage * 2 + incompleteness + (result.stale ? 200 : 0));

  // Review mode vs. fill mode: ≥80% complete means we're reviewing, not filling.
  // Review prompts should be "here's what's there, anything to update/refine/add?"
  // Fill prompts should be "this is empty, let's populate it."
  result.review_mode = result.completeness_score >= 80;

  if (result.tbd_count > 0) result.why_incomplete.push(`${result.tbd_count} TBD markers`);
  if (result.seed_markers > 0) result.why_incomplete.push(`${result.seed_markers} "seed during interview" markers`);
  if (result.empty_sections > 0) result.why_incomplete.push(`${result.empty_sections} empty/sparse sections`);
  if (sectionBody.length < 500 && target.category !== "foundational") result.why_incomplete.push("sparse content");
  if (result.review_mode && result.why_incomplete.length === 0) result.why_incomplete.push("already substantive — review for updates/refinements");

  return result;
}

function scoreTarget(target: RegistryTarget): Target {
  const sectionBody = extractSectionBody(target, TELOS_SECTIONS);
  if (target.path.startsWith(TELOS_SECTION_PREFIX)) {
    if (sectionBody === null) {
      const sectionFreshness = freshnessForSection(target);
      const result: Target = {
        ...target,
        content_length: 0,
        tbd_count: 0,
        seed_markers: 0,
        empty_sections: 0,
        required_fields_missing: [],
        completeness_score: 0,
        priority: 0,
        review_mode: false,
        age_days: sectionFreshness?.ageDays ?? null,
        threshold_days: sectionFreshness?.thresholdDays ?? 0,
        stale: sectionFreshness?.stale ?? false,
        why_incomplete: ["section does not exist"],
      };
      const incompleteness = 100 - result.completeness_score;
      // Stale sections get a large bump so overdue reviews naturally rise to the top.
      result.priority = Math.round(PHASE_BOOST[target.phase] + target.leverage * 2 + incompleteness + (result.stale ? 200 : 0));
      return result;
    }
    return scoreSection(target, sectionBody, freshnessForSection(target));
  }
  return scoreFile(target);
}

const PHASE_LABELS: Record<Phase, string> = {
  0: "PHASE 0 — Setup (DA / Principal / credentials / projects / work ledger + integrations)",
  1: "PHASE 1 — Foundational work TELOS (the core — review first)",
  2: "PHASE 2 — Ideal State",
  3: "PHASE 3 — Working context",
  4: "PHASE 4 — Identity + status",
  9: "PHASE 9 — Deferred",
};

// ─── Output formatters ───

function formatHuman(targets: Target[]): string {
  const overall = Math.round(targets.reduce((s, t) => s + t.completeness_score, 0) / targets.length);

  const lines: string[] = [];
  lines.push(`═══ WorkOS Interview Gap Report ═══`);
  lines.push(``);
  lines.push(`Overall: ${overall}% complete across ${targets.length} interview targets`);

  // Per-phase averages
  const phases: Phase[] = [1, 2, 3, 4, 9];
  const phaseStats = phases.map((p) => {
    const t = targets.filter((x) => x.phase === p);
    const avg = t.length ? Math.round(t.reduce((s, x) => s + x.completeness_score, 0) / t.length) : 0;
    return { phase: p, count: t.length, avg };
  });
  lines.push(
    `Phases: ` +
      phaseStats
        .filter((p) => p.count > 0)
        .map((p) => `P${p.phase}=${p.avg}%`)
        .join("  ·  ")
  );
  lines.push(``);

  // Render each phase as its own block
  for (const phase of phases) {
    const items = targets.filter((t) => t.phase === phase);
    if (items.length === 0) continue;
    lines.push(`── ${PHASE_LABELS[phase]} ──`);
    for (const t of items) {
      const mode = t.review_mode ? "review" : "fill  ";
      const marker = t.stale ? "⚠" : t.completeness_score === 100 ? "✓" : t.completeness_score >= 80 ? "·" : "○";
      const base = `  ${marker} ${mode}  ${t.name.padEnd(48)}  ${t.completeness_score.toFixed(0).padStart(3)}%  (lev ${String(t.leverage).padStart(2)})`;
      if (t.threshold_days > 0) {
        const age = t.age_days === null ? "—" : `${t.age_days}d`;
        const stale = t.stale ? "STALE " : "";
        lines.push(`${base}  ${stale}${`${age}/${t.threshold_days}d`.padEnd(13)}  — ${t.why_incomplete.join(", ") || "—"}`);
      } else {
        lines.push(`${base}  — ${t.why_incomplete.join(", ") || "—"}`);
      }
    }
    lines.push(``);
  }

  // Suggested next — skip Phase 9 (deferred)
  const next = targets.find((t) => t.phase !== 9);
  if (next) {
    const modeLabel = next.review_mode ? "REVIEW" : "FILL";
    lines.push(`── Suggested next (${modeLabel}): ${next.name} ──`);
    next.prompts.slice(0, 3).forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
    lines.push(``);
    lines.push(`Run /interview to start the conversational pass.`);
  } else {
    lines.push(`✅ Everything in scope is either done or deferred.`);
  }

  return lines.join("\n");
}

function formatJson(targets: Target[]): string {
  const overall = Math.round(targets.reduce((s, t) => s + t.completeness_score, 0) / targets.length);
  return JSON.stringify({ overall_complete: overall, count: targets.length, targets }, null, 2);
}

function formatNext(targets: Target[]): string {
  // Pick the highest-priority non-deferred target
  const t = targets.find((x) => x.phase !== 9);
  if (!t) return "✅ Nothing in scope. Check --phase 9 for deferred items.";
  const lines: string[] = [];
  const modeLabel = t.review_mode ? "REVIEW mode — read file, ask what to update/refine/add" : "FILL mode — walk through prompts to populate";
  lines.push(`📋 ${t.name}  —  ${t.completeness_score.toFixed(0)}% complete  ·  ${PHASE_LABELS[t.phase]}`);
  lines.push(`File: ${t.path}`);
  lines.push(`Leverage: ${t.leverage}/10  ·  Priority: ${t.priority}  ·  ${modeLabel}`);
  lines.push(`Why incomplete: ${t.why_incomplete.join(", ") || "—"}`);
  lines.push(``);
  if (t.review_mode) {
    lines.push(`Review approach (${DA_NAME} reads file first, then asks):`);
    lines.push(`  - "Here's what you've got in ${t.name}. Anything outdated? Sharpen / refine?"`);
    lines.push(`  - "Any recent thinking that should be captured here?"`);
    lines.push(`  - "Anything missing from a category that should exist?"`);
  } else {
    lines.push(`Questions for ${DA_NAME} to ask:`);
    t.prompts.forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
  }
  return lines.join("\n");
}

// ─── Main ───

function main(): void {
  const args = process.argv.slice(2);
  const includeDeferred = args.includes("--include-deferred");
  const phaseIdx = args.indexOf("--phase");
  const phaseFilter = phaseIdx !== -1 ? Number(args[phaseIdx + 1]) : null;

  if (args.includes("--file")) {
    const idx = args.indexOf("--file");
    const match = REGISTRY.find((t) => t.path === args[idx + 1] || t.name === args[idx + 1]);
    if (!match) {
      console.error(`Not found: ${args[idx + 1]}`);
      process.exit(1);
    }
    const scored = scoreTarget(match);
    console.log(JSON.stringify(scored, null, 2));
    return;
  }

  let scored = REGISTRY.map(scoreTarget);

  // Filter: by default skip phase 9 (deferred). --include-deferred to include.
  // --phase N filters to a single phase.
  if (phaseFilter !== null) {
    scored = scored.filter((t) => t.phase === phaseFilter);
  } else if (!includeDeferred) {
    scored = scored.filter((t) => t.phase !== 9);
  }

  // Sort: phase ascending (1 before 2), then priority descending within phase.
  scored.sort((a, b) => {
    if (a.phase !== b.phase) return a.phase - b.phase;
    return b.priority - a.priority;
  });

  if (args.includes("--json")) {
    console.log(formatJson(scored));
  } else if (args.includes("--next")) {
    console.log(formatNext(scored));
  } else {
    console.log(formatHuman(scored));
  }
}

main();
