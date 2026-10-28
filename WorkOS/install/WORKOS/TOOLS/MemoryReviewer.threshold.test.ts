/**
 * Per-kind auto-apply thresholds. The case that matters: an install whose
 * memory-review.json predates the per-kind map must still queue identity and
 * operational-rule proposals for the principal instead of auto-applying them.
 */
import { describe, expect, test } from "bun:test";
import { loadThresholdByKind, thresholdForKind } from "./MemoryReviewer";

const OLD_102_CONFIG = { schema_version: 1, turn_threshold: 8, min_minutes_between: 30, idle_threshold: 2, confidence_threshold: 0.7 };

describe("confidence_threshold_by_kind", () => {
  test("a config without the map (WorkOS 1.0.2) never auto-applies identity or operational rules", () => {
    const byKind = loadThresholdByKind(OLD_102_CONFIG);
    expect(thresholdForKind("identity", 0.7, byKind)).toBeNull();
    expect(thresholdForKind("operational-rule", 0.7, byKind)).toBeNull();
    expect(thresholdForKind("preference", 0.7, byKind)).toBe(0.7);
  });

  test("a map the principal wrote is read as written, even when it is empty", () => {
    expect(thresholdForKind("identity", 0.7, loadThresholdByKind({ confidence_threshold_by_kind: {} }))).toBe(0.7);
    expect(thresholdForKind("identity", 0.7, loadThresholdByKind({ confidence_threshold_by_kind: { identity: 0.95 } }))).toBe(0.95);
  });

  test("a malformed map still fails closed for every kind", () => {
    expect(thresholdForKind("preference", 0.7, loadThresholdByKind({ confidence_threshold_by_kind: [] }))).toBeNull();
  });
});
