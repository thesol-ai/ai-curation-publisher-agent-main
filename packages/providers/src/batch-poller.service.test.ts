import { describe, expect, it } from "vitest";
import type { Source } from "@curator/core";
import { BatchPollerService } from "./batch-poller.service";
import { MockSocialProvider } from "./mock/mock-provider";
import { SourcePollerService, type PollIngestGate, type PollIngestGateResult } from "./source-poller.service";

class SequenceIngestGate implements PollIngestGate {
  private index = 0;

  constructor(private readonly outcomes: PollIngestGateResult["outcome"][]) {}

  async processNormalizedPost(): Promise<PollIngestGateResult> {
    const outcome = this.outcomes[this.index] ?? "queued";
    this.index += 1;
    return { outcome };
  }
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_instagram",
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

describe("BatchPollerService", () => {
  it("processes sources sequentially and aggregates totals", async () => {
    const sourcePoller = new SourcePollerService({
      providers: [
        new MockSocialProvider({ id: "mock_instagram", platform: "instagram", now: () => new Date(0) }),
        new MockSocialProvider({ id: "mock_x", platform: "x", now: () => new Date(0) }),
        new MockSocialProvider({ id: "mock_web", platform: "web", now: () => new Date(0) })
      ],
      ingestGate: new SequenceIngestGate(["queued", "duplicate", "invalid"]),
      now: () => new Date(0)
    });
    const batchPoller = new BatchPollerService(sourcePoller, { now: () => new Date(0) });

    const result = await batchPoller.pollSources([
      makeSource(),
      makeSource({
        id: "source_x",
        platform: "x",
        sourceType: "hashtag",
        value: "ai",
        providerPriority: ["mock_x"]
      }),
      makeSource({
        id: "source_web",
        platform: "web",
        sourceType: "web_url",
        value: "https://source.local/article",
        providerPriority: ["mock_web"]
      })
    ]);

    expect(result.totalSources).toBe(3);
    expect(result.successfulSources).toBe(3);
    expect(result.failedSources).toBe(0);
    expect(result.totalReturned).toBe(3);
    expect(result.totalQueued).toBe(1);
    expect(result.totalDuplicates).toBe(1);
    expect(result.totalInvalid).toBe(1);
    expect(result.totalErrors).toBe(0);
    expect(result.sourceResults.map((sourceResult) => sourceResult.sourceId)).toEqual([
      "source_instagram",
      "source_x",
      "source_web"
    ]);
  });

  it("continues polling remaining sources after one source fails", async () => {
    const sourcePoller = new SourcePollerService({
      providers: [new MockSocialProvider({ id: "mock_instagram", platform: "instagram", now: () => new Date(0) })],
      ingestGate: new SequenceIngestGate(["queued"]),
      now: () => new Date(0)
    });
    const batchPoller = new BatchPollerService(sourcePoller, { now: () => new Date(0) });

    const result = await batchPoller.pollSources([
      makeSource({
        id: "source_web_without_provider",
        platform: "web",
        sourceType: "web_url",
        value: "https://source.local/article",
        providerPriority: ["mock_web"]
      }),
      makeSource()
    ]);

    expect(result.totalSources).toBe(2);
    expect(result.successfulSources).toBe(1);
    expect(result.failedSources).toBe(1);
    expect(result.totalReturned).toBe(1);
    expect(result.totalQueued).toBe(1);
    expect(result.totalErrors).toBe(1);
    expect(result.sourceResults[0]?.sourceId).toBe("source_web_without_provider");
    expect(result.sourceResults[0]?.failedCount).toBe(1);
    expect(result.sourceResults[1]?.sourceId).toBe("source_instagram");
    expect(result.sourceResults[1]?.queuedCount).toBe(1);
  });
});
