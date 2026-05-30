import { describe, expect, it } from "vitest";
import { MockWordPressClient } from "./client";
import type { WordPressPostMetadata, WordPressPostMetadataStore } from "./wordpress-publishing.service";
import { WordPressPublishingService } from "./wordpress-publishing.service";
import { createMockWordPressOutput } from "./wordpress-output";

class InMemoryWordPressPostMetadataStore implements WordPressPostMetadataStore {
  readonly records: WordPressPostMetadata[] = [];

  async recordPublishedPost(metadata: WordPressPostMetadata): Promise<void> {
    this.records.push(metadata);
  }
}

describe("WordPressPublishingService", () => {
  it("publishes WordPress output through the mock client", async () => {
    const client = new MockWordPressClient({ baseUrl: "https://wordpress.local" });
    const metadataStore = new InMemoryWordPressPostMetadataStore();
    const service = new WordPressPublishingService(client, metadataStore);

    const result = await service.publish({
      itemId: "item_local",
      output: createMockWordPressOutput({ title_fa: "Long WordPress title" }),
      sourceUrl: "https://source.local/post",
      slug: "long-wordpress-title"
    });

    expect(result.outcome).toBe("published");
    if (result.outcome !== "published") {
      throw new Error("Expected published result");
    }

    expect(result.itemId).toBe("item_local");
    expect(result.post.id).toBe("mock_wp_post_1");
    expect(result.post.url).toBe("https://wordpress.local/long-wordpress-title");
    expect(result.payload.status).toBe("draft");
    expect(client.createdPosts).toHaveLength(1);
    expect(metadataStore.records).toEqual([
      {
        itemId: "item_local",
        wordpressPostId: "mock_wp_post_1",
        wordpressUrl: "https://wordpress.local/long-wordpress-title",
        status: "draft",
        publishedAt: new Date(0).toISOString()
      }
    ]);
  });

  it("returns validation failures before calling the client", async () => {
    const client = new MockWordPressClient();
    const service = new WordPressPublishingService(client);

    const result = await service.publish({
      itemId: "item_local",
      output: createMockWordPressOutput({ title_fa: " " })
    });

    expect(result.outcome).toBe("invalid_output");
    expect(client.createdPosts).toHaveLength(0);
  });

  it("returns structured failures from the client", async () => {
    const client = new MockWordPressClient({ failCreatePostWith: "WordPress unavailable" });
    const service = new WordPressPublishingService(client);

    const result = await service.publish({
      itemId: "item_local",
      output: createMockWordPressOutput()
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") {
      throw new Error("Expected failed result");
    }

    expect(result.errorMessage).toBe("WordPress unavailable");
    expect(result.payload.status).toBe("draft");
  });

  it("respects explicit non-draft status when provided", async () => {
    const client = new MockWordPressClient();
    const service = new WordPressPublishingService(client);

    const result = await service.publish({
      itemId: "item_local",
      output: createMockWordPressOutput(),
      status: "pending"
    });

    expect(result.outcome).toBe("published");
    if (result.outcome !== "published") {
      throw new Error("Expected published result");
    }

    expect(result.post.status).toBe("pending");
    expect(client.createdPosts[0]?.status).toBe("pending");
  });
});
