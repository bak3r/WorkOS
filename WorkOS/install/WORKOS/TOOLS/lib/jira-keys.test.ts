import { describe, expect, test } from "bun:test";
import { extractJiraKeys, keyFromBranch } from "./jira-keys";

describe("extractJiraKeys", () => {
  test("generic keys of any team, deduped, in order", () => {
    expect(extractJiraKeys("ABC-1 then XY9-404, again ABC-1 and LONGPROJ1-77")).toEqual(["ABC-1", "XY9-404", "LONGPROJ1-77"]);
  });

  test("ISC criteria IDs are never keys, filter or not", () => {
    expect(extractJiraKeys("ISC-12 passed; see ABC-3")).toEqual(["ABC-3"]);
    expect(extractJiraKeys("ISC-12 and ABC-3", ["ISC", "ABC"])).toEqual(["ABC-3"]);
  });

  test("known false positives are dropped when no filter is set", () => {
    expect(extractJiraKeys("UTF-8 SHA-256 ISO-8601 RFC-7231 TLS-1 HTTP-2 SSL-3 ES-2015 AES-256 RSA-2048 CVE-2024-1234 GPT-4 P0-1")).toEqual([]);
  });

  test("an explicit filter keeps only its prefixes (case-insensitive config)", () => {
    expect(extractJiraKeys("ABC-1 DEF-2 SHA-256", ["def", "sha"])).toEqual(["DEF-2", "SHA-256"]);
  });

  test("lowercase and embedded shapes do not match", () => {
    expect(extractJiraKeys("abc-1 xABC-1 ABC-1x A-1")).toEqual([]);
  });
});

describe("keyFromBranch", () => {
  test("branch shapes", () => {
    expect(keyFromBranch("dev-TEAM-123-foo")).toBe("TEAM-123");
    expect(keyFromBranch("fix-OPS-9-x")).toBe("OPS-9");
    expect(keyFromBranch("feature/ABC-42_add-thing")).toBe("ABC-42");
    expect(keyFromBranch("main")).toBeNull();
    expect(keyFromBranch("dev-TEAM-123-foo", ["OPS"])).toBeNull();
  });
});
