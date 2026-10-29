import { homedir } from "node:os";
import { join } from "node:path";
import { P, RESET } from "../Ansi";
import { readJson } from "../Cache";
import { object, string, type State } from "../State";
import { fit } from "../Width";
import { emailForms } from "../../TOOLS/StatusLineAbbrev";

/** True when Claude Code runs on Amazon Bedrock: CLAUDE_CODE_USE_BEDROCK in the environment or in settings.json env. */
export function onBedrock(state: State): boolean {
  const v = state.env.CLAUDE_CODE_USE_BEDROCK ?? string(object(state.settings.env).CLAUDE_CODE_USE_BEDROCK);
  return v === "1" || v === "true";
}

/**
 * How this session pays for Claude. On Bedrock: the provider and the AWS region, since there is no signed-in account
 * and no plan to meter. Otherwise the signed-in Claude Code address, shortened by rule as the pane narrows.
 */
export function renderAccount(state: State): string {
  if (state.geometry.phone) return "";
  if (onBedrock(state)) {
    const region = state.env.AWS_REGION || state.env.AWS_DEFAULT_REGION || string(object(state.settings.env).AWS_REGION);
    const full = `${P.slate600}PROVIDER:${RESET} ${P.slate500}AMAZON BEDROCK${RESET}${region ? ` ${P.slate600}│${RESET} ${P.slate500}${region}${RESET}` : ""}`;
    return `${fit(state.geometry.content, full, `${P.slate500}BEDROCK${region ? ` ${region}` : ""}${RESET}`, `${P.slate500}BEDROCK${RESET}`)}\n`;
  }
  const home = state.env.HOME || homedir();
  const email = string(object(object(readJson(join(home, ".claude.json"))).oauthAccount).emailAddress);
  if (!email) return "";
  const line = fit(state.geometry.content, ...emailForms([email]).map(([show]) => `${P.slate600}CC:${RESET} ${P.slate500}${show}${RESET}`));
  return line ? `${line}\n` : "";
}
