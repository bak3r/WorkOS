import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkConfig, parseWorkYaml } from "./work-config";

const tmp = () => join(mkdtempSync(join(tmpdir(), "wcfg-")), "config.yaml");

describe("work-config", () => {
  test("missing config → ledger on, integrations auto-detected from env", () => {
    const off = loadWorkConfig({}, tmp());
    expect(off.enabled).toBe(true);
    expect(off.jira.enabled).toBe(false);
    expect(off.gitlab.enabled).toBe(false);
    expect(off.contextTtlMinutes).toBe(15);
    const on = loadWorkConfig({ JIRA_URL: "https://j", GITLAB_HOST: "https://g" }, tmp());
    expect(on.jira.enabled).toBe(true);
    expect(on.gitlab.enabled).toBe(true);
  });

  test("the shipped template parses to its documented defaults", () => {
    const path = join(import.meta.dir, "..", "..", "USER", "WORK", "config.yaml");
    const cfg = loadWorkConfig({}, path);
    expect(cfg.enabled).toBe(true);
    expect(cfg.kanbanStatuses).toEqual(["in-progress", "blocked", "in-review", "ready", "queued"]);
    expect(cfg.jira).toMatchObject({ enabled: false, projectKeys: [], jql: null });
    expect(cfg.contextTtlMinutes).toBe(15);
    expect(Object.keys(parseWorkYaml(readFileSync(path, "utf-8")))).toContain("gitlab");
  });

  test("explicit settings: lists, nested maps, comments, explicit disable", () => {
    const p = tmp();
    writeFileSync(p, [
      "enabled: false",
      "capture_reminders: no   # off",
      "project_property:",
      "  Some Repo: Product A",
      "jira:",
      "  enabled: true",
      "  project_keys:",
      "    - abc",
      "    - DEF",
      '  jql: "project = ABC"',
      "gitlab:",
      "  enabled: false",
      "context_ttl_minutes: 30",
    ].join("\n"));
    const cfg = loadWorkConfig({ GITLAB_HOST: "https://g" }, p);
    expect(cfg.enabled).toBe(false);
    expect(cfg.reasonCode).toBe("disabled_by_config");
    expect(cfg.captureReminders).toBe(false);
    expect(cfg.projectProperty("someRepo")).toBe("Product A");
    expect(cfg.projectProperty("other")).toBe("other");
    expect(cfg.jira).toMatchObject({ enabled: true, projectKeys: ["abc", "DEF"], jql: "project = ABC" });
    expect(cfg.gitlab.enabled).toBe(false);
    expect(cfg.contextTtlMinutes).toBe(30);
  });
});
