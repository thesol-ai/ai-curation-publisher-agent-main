import { describe, expect, it } from "vitest";
import type { Source } from "@curator/core";
import { MockInstagramProvider } from "./mock/mock-instagram-provider";
import { MockWebProvider } from "./mock/mock-web-provider";
import { MockXProvider } from "./mock/mock-x-provider";
import { ProviderRegistry } from "./provider-registry";
import { SourceIngestionService } from "./source-ingestion.service";

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_local",
    platform: "instagram",
    sourceType: "profile",
    value: "openai",
    providerPriority: ["mock_instagram"],
    status: "active",
    watermark: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides
  };
}

describe("SourceIngestionService", () => {
  it("fetches normalized posts from a mock Instagram profile", async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockInstagramProvider());
    const service = new SourceIngestionService(registry);

    const result = await service.ingestSource(makeSource(), { limit: 1 });

    expect(result.providerUsed).toBe("mock_instagram");
    expect(result.returnedCount).toBe(1);
    expect(result.normalizedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.posts[0]).toMatchObject({
      provider: "mock_instagram",
      platform: "instagram",
      sourceType: "profile"
    });
  });

  it("fetches normalized posts from a mock X query", async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockXProvider());
    const service = new SourceIngestionService(registry);

    const result = await service.ingestSource(makeSource({
      id: "source_x",
      platform: "x",
      sourceType: "query",
      value: "ai news",
      providerPriority: ["mock_x"]
    }));

    expect(result.providerUsed).toBe("mock_x");
    expect(result.posts).toHaveLength(2);
    expect(result.posts.every((post) => post.platform === "x" && post.sourceType === "query")).toBe(true);
  });

  it("fetches a normalized article from a mock Web URL", async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockWebProvider());
    const service = new SourceIngestionService(registry);

    const result = await service.ingestSource(makeSource({
      id: "source_web",
      platform: "web",
      sourceType: "web_url",
      value: "https://source.local/article",
      providerPriority: ["mock_web"]
    }));

    expect(result.providerUsed).toBe("mock_web");
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.canonicalUrl).toBe("https://source.local/article");
    expect(result.posts[0]?.sourceType).toBe("web_url");
  });

  it("falls back after provider failure and records metadata", async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockInstagramProvider({ scenario: "failure" }));
    registry.register(new MockInstagramProvider({ id: "mock_instagram_backup" }));
    const service = new SourceIngestionService(registry);

    const result = await service.ingestSource(makeSource({ providerPriority: ["mock_instagram", "mock_instagram_backup"] }));

    expect(result.providerUsed).toBe("mock_instagram_backup");
    expect(result.selectedFallbackProviderId).toBe("mock_instagram_backup");
    expect(result.providerAttempts.map((attempt) => attempt.status)).toEqual(["failed", "success"]);
    expect(result.providerAttempts[0]).toMatchObject({
      providerId: "mock_instagram",
      failureCategory: "unknown_error"
    });
    expect(result.failedCount).toBe(0);
    expect(result.normalizedCount).toBe(2);
  });

  it("handles unsupported source types", async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockInstagramProvider());
    const service = new SourceIngestionService(registry);

    const result = await service.ingestSource(makeSource({ sourceType: "web_url" }));

    expect(result.providerUsed).toBeUndefined();
    expect(result.posts).toEqual([]);
    expect(result.providerAttempts[0]?.status).toBe("unsupported");
    expect(result.providerAttempts[0]?.failureCategory).toBe("unsupported_source_type");
    expect(result.failedCount).toBe(1);
  });

  it("returns metadata counts for duplicate mock posts", async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockXProvider({ scenario: "duplicates" }));
    const service = new SourceIngestionService(registry);

    const result = await service.ingestSource(makeSource({
      id: "source_x",
      platform: "x",
      sourceType: "hashtag",
      value: "ai",
      providerPriority: ["mock_x"]
    }));

    expect(result.providerUsed).toBe("mock_x");
    expect(result.returnedCount).toBe(2);
    expect(result.normalizedCount).toBe(2);
    expect(result.posts[0]?.sourcePostId).toBe(result.posts[1]?.sourcePostId);
  });

  it("returns empty metadata for empty provider results", async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockWebProvider({ scenario: "empty" }));
    const service = new SourceIngestionService(registry);

    const result = await service.ingestSource(makeSource({
      id: "source_web",
      platform: "web",
      sourceType: "web_url",
      value: "https://source.local/article",
      providerPriority: ["mock_web"]
    }));

    expect(result.providerUsed).toBe("mock_web");
    expect(result.returnedCount).toBe(0);
    expect(result.normalizedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.posts).toEqual([]);
  });
});
