import { describe, expect, it } from "vitest";
import { MediaPreparationService } from "./media-preparation.service";
import { MockMediaProcessor } from "./mock-media-processor";

describe("MediaPreparationService", () => {
  it("skips empty media", async () => {
    const service = new MediaPreparationService(new MockMediaProcessor());

    const result = await service.prepare({ itemId: "item_local", media: [] });

    expect(result.status).toBe("skipped");
    expect(result.preparedAssets).toEqual([]);
    expect(result.failedAssets).toEqual([]);
    expect(result.groups).toEqual([]);
  });

  it("skips media entries with empty source URLs", async () => {
    const service = new MediaPreparationService(new MockMediaProcessor());

    const result = await service.prepare({
      itemId: "item_local",
      media: [{ kind: "image", sourceUrl: " " }]
    });

    expect(result.status).toBe("skipped");
    expect(result.warnings).toEqual(["Skipped media entries with empty source URLs."]);
  });

  it("prepares mixed carousel media while preserving order and grouping", async () => {
    const service = new MediaPreparationService(new MockMediaProcessor());

    const result = await service.prepare({
      itemId: "item_local",
      media: [
        { kind: "image", sourceUrl: "https://source.local/1.png" },
        { kind: "video", sourceUrl: "https://source.local/2.mp4" },
        { kind: "image", sourceUrl: "https://source.local/3.png" }
      ]
    });

    expect(result.status).toBe("ready");
    expect(result.preparedAssets.map((asset) => asset.order)).toEqual([0, 1, 2]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.assets).toHaveLength(3);
    expect(new Set(result.preparedAssets.map((asset) => asset.groupId)).size).toBe(1);
  });

  it("reports failed assets without external processing", async () => {
    const service = new MediaPreparationService(new MockMediaProcessor({
      failSourceUrls: ["https://source.local/fail.mp4"]
    }));

    const result = await service.prepare({
      itemId: "item_local",
      media: [
        { kind: "image", sourceUrl: "https://source.local/ok.png" },
        { kind: "video", sourceUrl: "https://source.local/fail.mp4" }
      ]
    });

    expect(result.status).toBe("partial");
    expect(result.preparedAssets).toHaveLength(1);
    expect(result.failedAssets).toHaveLength(1);
    expect(result.failedAssets[0]?.errorMessage).toBe("Mock media processing failure");
  });
});
