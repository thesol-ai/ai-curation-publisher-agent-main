import { describe, expect, it } from "vitest";
import { runE2EMockPipeline } from "./e2e-mock-pipeline";

describe("runE2EMockPipeline", () => {
  it("runs the full mock pipeline successfully", async () => {
    const result = await runE2EMockPipeline();

    expect(result.ok).toBe(true);
    expect(result.sourceId).toBe("source_e2e_mock_instagram");
    expect(result.itemId).toMatch(/^item_/);
    expect(result.providerUsed).toBe("mock_instagram");
    expect(result.normalizedCount).toBe(1);
    expect(result.queuedCount).toBe(1);
    expect(result.duplicateCount).toBe(0);
    expect(result.invalidCount).toBe(0);
    expect(result.aiOutputCreated).toBe(true);
    expect(result.reviewMessageCreated).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.queuedForPublish).toBe(true);
    expect(result.telegramPublished).toBe(true);
    expect(result.finalMessageId).toMatch(/^mock_telegram_final_/);
    expect(result.wordpressPrepared).toBe(true);
    expect(result.wordpressPublished).toBe(true);
    expect(result.wordpressPostId).toBe("mock_wp_post_1");
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
