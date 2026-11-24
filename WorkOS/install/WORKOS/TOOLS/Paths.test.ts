import { describe, expect, test } from "bun:test";
import { claudeDirFor, expandPathFrom, workosDirFor } from "./Paths";

const HOME = "/home/dev";

describe("Paths", () => {
  test("default install resolves under ~/.claude", () => {
    expect(claudeDirFor({}, HOME)).toBe("/home/dev/.claude");
    expect(workosDirFor({}, HOME)).toBe("/home/dev/.claude/WORKOS");
  });

  test("CLAUDE_CONFIG_DIR moves both roots (the Docker sandbox case)", () => {
    const env = { CLAUDE_CONFIG_DIR: "/workspace/.claude" };
    expect(claudeDirFor(env, HOME)).toBe("/workspace/.claude");
    expect(workosDirFor(env, HOME)).toBe("/workspace/.claude/WORKOS");
  });

  test("a shell-wide WORKOS_DIR does not pull an isolated install back to ~/.claude", () => {
    // The settings template exports WORKOS_DIR=$HOME/.claude/WORKOS in every session.
    const env = { CLAUDE_CONFIG_DIR: "/workspace/.claude", WORKOS_DIR: "$HOME/.claude/WORKOS" };
    expect(workosDirFor(env, HOME)).toBe("/workspace/.claude/WORKOS");
  });

  test("WORKOS_DIR relocates WORKOS when nothing isolates the profile", () => {
    expect(workosDirFor({ WORKOS_DIR: "~/alt/WORKOS" }, HOME)).toBe("/home/dev/alt/WORKOS");
    expect(claudeDirFor({ WORKOS_DIR: "~/alt/WORKOS" }, HOME)).toBe("/home/dev/.claude");
  });

  test("WORKOS_SKILLS_DIR marks the root when CLAUDE_CONFIG_DIR is unset, and loses to it", () => {
    expect(claudeDirFor({ WORKOS_SKILLS_DIR: "/opt/cfg/skills" }, HOME)).toBe("/opt/cfg");
    expect(workosDirFor({ WORKOS_SKILLS_DIR: "/opt/cfg/skills", WORKOS_DIR: "/x/WORKOS" }, HOME)).toBe("/opt/cfg/WORKOS");
    expect(claudeDirFor({ WORKOS_SKILLS_DIR: "/opt/cfg/skills", CLAUDE_CONFIG_DIR: "/c" }, HOME)).toBe("/c");
  });

  test("CLAUDE_PLUGIN_ROOT wins over everything", () => {
    const env = { CLAUDE_PLUGIN_ROOT: "/plug", CLAUDE_CONFIG_DIR: "/c", WORKOS_DIR: "/w" };
    expect(claudeDirFor(env, HOME)).toBe("/plug");
    expect(workosDirFor(env, HOME)).toBe("/plug/WORKOS");
  });

  test("expandPathFrom expands only a leading $HOME, ${HOME} or ~", () => {
    expect(expandPathFrom("$HOME/a", HOME)).toBe("/home/dev/a");
    expect(expandPathFrom("${HOME}/a", HOME)).toBe("/home/dev/a");
    expect(expandPathFrom("~", HOME)).toBe("/home/dev");
    expect(expandPathFrom("/x/$HOME", HOME)).toBe("/x/$HOME");
    expect(expandPathFrom("$HOMEX/a", HOME)).toBe("$HOMEX/a");
  });
});
