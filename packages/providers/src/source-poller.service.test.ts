import { describe, expect, it } from "vitest";
import type { NormalizedPost, Platform, Source } from "@curator/core";
import { MockSocialProvider } from "./mock/mock-provider";
import { SourcePollerService, type PollIngestGate, type PollIngestGateResult } from "./source-poller.service";

class FailingMockProvider extends MockSocialProvider {
  override async fetchSource(): Promise<never> {
    throw new Error(`${this.id} failed`);
  }

  override async fetchDirectUrl(): Promise<never> {
    throw new Error(`${this.id} failed`);
  }
}

class FixedOutcomeIngestGate implements PollIngestGate {
  private index = 0;

  constructor(private readonly outcomes: PollIngestGateResult["outcome"][]) {}

  async processNormalizedPost(_input: { sourceId: string; post: NormalizedPost }): Promise<PollIngestGateResult> {
    const outcome = this.outcomes[this.index] ?? "queued";
    this.index += 1;
    return { outcome };
  }
}

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

function mockProvider(id: string, platform: Platform): MockSocialProvider {
  return new MockSocialProvider({ id, platform, now: () => new Date(0) });
}

describe("SourcePollerService", () => {
  it("polls one Instagram profile source with a mock provider", async () => {
    const poller = new SourcePollerService({
      providers: [mockProvider("mock_instagram", "instagram")],
      ingestGate: new FixedOutcomeIngestGate(["queued"]),
      now: () => new Date(0)
    });

    const result = await poller.pollSource(makeSource(), { limit: 1 });

    expect(result.sourceId).toBe("source_local");
    expect(result.platform).toBe("instagram");
    expect(result.sourceType).toBe("profile");
    expect(result.providerUsed).toBe("mock_instagram");
    expect(result.returnedCount).toBe(1);
    expect(result.normalizedCount).toBe(1);
    expect(result.queuedCount).toBe(1);
    expect(result.duplicateCount).toBe(0);
    expect(result.invalidCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.sourceState.lastProviderUsed).toBe("mock_instagram");
  });

  it("polls one X hashtag source with a mock provider", async () => {
    const poller = new SourcePollerService({
      providers: [mockProvider("mock_x", "x")],
      now: () => new Date(0)
    });

    const result = await poller.pollSource(makeSource({
      id: "source_x",
      platform: "x",
      sourceType: "hashtag",
      value: "ai",
      providerPriority: ["mock_x"]
    }));

    expect(result.providerUsed).toBe("mock_x");
    expect(result.platform).toBe("x");
    expect(result.sourceType).toBe("hashtag");
    expect(result.returnedCount).toBe(1);
  });

  it("polls one Web URL source with a mock provider", async () => {
    const poller = new SourcePollerService({
      providers: [mockProvider("mock_web", "web")],
      now: () => new Date(0)
    });

    const result = await poller.pollSource(makeSource({
      id: "source_web",
      platform: "web",
      sourceType: "web_url",
      value: "https://source.local/article",
      providerPriority: ["mock_web"]
    }));

    expect(result.providerUsed).toBe("mock_web");
    expect(result.platform).toBe("web");
    expect(result.sourceType).toBe("web_url");
    expect(result.returnedCount).toBe(1);
    expect(result.posts[0]?.canonicalUrl).toBe("https://source.local/article");
  });

  it("falls back when the first provider fails", async () => {
    const poller = new SourcePollerService({
      providers: [
        new FailingMockProvider({ id: "mock_instagram_primary", platform: "instagram" }),
        mockProvider("mock_instagram_backup", "instagram")
      ],
      now: () => new Date(0)
    });

    const result = await poller.pollSource(makeSource({
      providerPriority: ["mock_instagram_primary", "mock_instagram_backup"]
    }));

    expect(result.providerUsed).toBe("mock_instagram_backup");
    expect(result.providerAttempts.map((attempt) => attempt.status)).toEqual(["failed", "success"]);
    expect(result.errors).toEqual(["mock_instagram_primary failed"]);
    expect(result.failedCount).toBe(0);
  });

  it("counts duplicate and invalid ingest gate outcomes", async () => {
    const poller = new SourcePollerService({
      providers: [mockProvider("mock_instagram", "instagram")],
      ingestGate: new FixedOutcomeIngestGate(["duplicate", "invalid"]),
      now: () => new Date(0)
    });

    const result = await poller.pollSource(makeSource(), { limit: 2 });

    expect(result.returnedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.invalidCount).toBe(0);
    expect(result.queuedCount).toBe(0);
  });

  it("returns a structured failure when no provider is available", async () => {
    const poller = new SourcePollerService({ providers: [], now: () => new Date(0) });

    const result = await poller.pollSource(makeSource());

    expect(result.providerUsed).toBeUndefined();
    expect(result.returnedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.errors).toEqual(["No provider available for instagram"]);
    expect(result.sourceState.lastError).toBe("No provider available for instagram");
  });
});
