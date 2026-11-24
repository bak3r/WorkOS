/** WorkOS control keys (2026-11-24): kept only with their fixed values; everything else still fails. */
import { expect, test } from "bun:test";
import { skillFrontmatterProblems as f } from "./SkillHygieneGate";
const fm = (b: string) => `---\nname: X\ndescription: d\n${b}\n---\nbody\n`;
test("kept control keys with their values pass", () => {
  expect(f(fm("context: fork\nbackground: false"))).toEqual([]);
  expect(f(fm("disable-model-invocation: true\nallowed-tools: Read, Bash"))).toEqual([]);
  expect(f(fm("allowed-tools:\n  - Read\n  - Bash"))).toEqual([]);
});
test("other values and other keys still fail", () => {
  expect(f(fm("context: inline")).map((p) => p.key)).toEqual(["context"]);
  expect(f(fm("disable-model-invocation: false")).map((p) => p.key)).toEqual(["disable-model-invocation"]);
  expect(f(fm("background: maybe")).map((p) => p.key)).toEqual(["background"]);
  expect(f(fm("model: opus")).length).toBe(1);
  expect(f("---\n  name: X\n  description: d\n  context: inline\n---\n").map((p) => p.key)).toEqual(["context"]);
});
