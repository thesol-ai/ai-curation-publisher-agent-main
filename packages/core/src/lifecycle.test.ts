import { describe, expect, it } from "vitest";
import {
  assertItemStatusTransition,
  canEnterCostlyProcessing,
  canTransitionItemStatus,
  isItemStatus,
  isTerminalItemStatus
} from "./lifecycle";

describe("item lifecycle", () => {
  it("allows expected forward transitions", () => {
    expect(canTransitionItemStatus("discovered", "normalized")).toBe(true);
    expect(canTransitionItemStatus("normalized", "validated")).toBe(true);
    expect(canTransitionItemStatus("published_telegram", "published_wordpress")).toBe(true);
  });

  it("blocks expensive processing after duplicate skip", () => {
    expect(canTransitionItemStatus("duplicate_skipped", "queued_for_ai")).toBe(false);
    expect(canTransitionItemStatus("duplicate_skipped", "media_ready")).toBe(false);
  });

  it("recognizes known and terminal statuses", () => {
    expect(isItemStatus("sent_to_review")).toBe(true);
    expect(isItemStatus("made_up_status")).toBe(false);
    expect(isTerminalItemStatus("cancelled")).toBe(true);
  });

  it("throws for invalid transitions", () => {
    expect(() => assertItemStatusTransition("discovered", "queued_for_ai")).toThrow(
      "Invalid item lifecycle transition"
    );
    expect(() => assertItemStatusTransition("discovered", "normalized")).not.toThrow();
  });

  it("allows costly processing only for queued_for_ai", () => {
    expect(canEnterCostlyProcessing("queued_for_ai")).toBe(true);
    expect(canEnterCostlyProcessing("discovered")).toBe(false);
    expect(canEnterCostlyProcessing("normalized")).toBe(false);
    expect(canEnterCostlyProcessing("validated")).toBe(false);
    expect(canEnterCostlyProcessing("duplicate_skipped")).toBe(false);
    expect(canEnterCostlyProcessing("invalid")).toBe(false);
  });
});
