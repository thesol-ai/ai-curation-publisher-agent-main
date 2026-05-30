import { describe, expect, it } from "vitest";
import { MockMediaProcessor } from "./mock-media-processor";

describe("MockMediaProcessor", () => {
  it("prepares images deterministically", async () => {
    const processor = new MockMediaProcessor();

    const asset = await processor.prepareImage({
      itemId: "item_local",
      media: {
        kind: "image",
        sourceUrl: "https://source.local/image.png",
        width: 1200,
        height: 800
      },
      order: 0
    });

    expect(asset.kind).toBe("image");
    expect(asset.status).toBe("ready");
    expect(asset.mimeType).toBe("image/jpeg");
    expect(asset.width).toBe(1200);
    expect(asset.height).toBe(800);
    expect(asset.storageKey).toBe("mock-media/item_local/0-image-prepared.jpg");
  });

  it("prepares videos and generates thumbnail metadata", async () => {
    const processor = new MockMediaProcessor();

    const asset = await processor.prepareVideo({
      itemId: "item_local",
      media: {
        kind: "video",
        sourceUrl: "https://source.local/video.mp4",
        durationSeconds: 42,
        width: 1920,
        height: 1080
      },
      order: 1
    });

    expect(asset.kind).toBe("video");
    expect(asset.status).toBe("ready");
    expect(asset.durationSeconds).toBe(42);
    expect(asset.thumbnail?.kind).toBe("thumbnail");
    expect(asset.thumbnail?.status).toBe("ready");
    expect(processor.thumbnailInputs).toHaveLength(1);
  });

  it("prepares carousel media in source order under one group", async () => {
    const processor = new MockMediaProcessor();

    const assets = await processor.prepareCarousel({
      itemId: "item_local",
      groupId: "group_local",
      media: [
        { kind: "image", sourceUrl: "https://source.local/1.png" },
        { kind: "video", sourceUrl: "https://source.local/2.mp4" },
        { kind: "image", sourceUrl: "https://source.local/3.png" }
      ]
    });

    expect(assets.map((asset) => asset.order)).toEqual([0, 1, 2]);
    expect(assets.map((asset) => asset.groupId)).toEqual(["group_local", "group_local", "group_local"]);
    expect(assets.map((asset) => asset.kind)).toEqual(["image", "video", "image"]);
  });

  it("returns failed assets for configured mock failures", async () => {
    const processor = new MockMediaProcessor({ failSourceUrls: ["https://source.local/fail.png"] });

    const asset = await processor.prepareImage({
      itemId: "item_local",
      media: { kind: "image", sourceUrl: "https://source.local/fail.png" },
      order: 0
    });

    expect(asset.status).toBe("failed");
    expect(asset.errorMessage).toBe("Mock media processing failure");
  });
});
