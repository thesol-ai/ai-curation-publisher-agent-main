import type { Platform, Source, SourceType } from "@curator/core";
import { IngestGateService } from "@curator/db";
import { BatchPollerService, MockSocialProvider, SourcePollerService, type PollIngestGate } from "@curator/providers";
import type { Env } from "../types";

export type OperationalPollOptions = {
  limit?: number;
  backfillLimit?: number;
  since?: string;
  cursor?: string;
  providerPriority?: string[];
  useIngestGate?: boolean;
};

export type OperationalPollInput = {
  env: Env;
  sources?: Partial<Source>[];
  options?: OperationalPollOptions;
};

export type OperationalPollResult = {
  ok: true;
  mockMode: true;
  totalSources: number;
  successfulSources: number;
  failedSources: number;
  totalReturned: number;
  totalQueued: number;
  totalDuplicates: number;
  totalInvalid: number;
  totalErrors: number;
  perSource: Awaited<ReturnType<BatchPollerService["pollSources"]>>["sourceResults"];
};

export async function runMockPollOperation(input: OperationalPollInput): Promise<OperationalPollResult> {
  const sources = normalizeSources(input.sources);
  const ingestGate = input.options?.useIngestGate ? createIngestGateAdapter(input.env) : undefined;
  const sourcePoller = new SourcePollerService({
    providers: createMockProviders(),
    ...(ingestGate === undefined ? {} : { ingestGate })
  });
  const batchPoller = new BatchPollerService(sourcePoller);
  const result = await batchPoller.pollSources(sources, {
    ...(input.options?.limit === undefined ? {} : { limit: input.options.limit }),
    ...(input.options?.backfillLimit === undefined ? {} : { backfillLimit: input.options.backfillLimit }),
    ...(input.options?.since === undefined ? {} : { since: input.options.since }),
    ...(input.options?.cursor === undefined ? {} : { cursor: input.options.cursor }),
    ...(input.options?.providerPriority === undefined ? {} : { providerPriority: input.options.providerPriority })
  });

  return {
    ok: true,
    mockMode: true,
    totalSources: result.totalSources,
    successfulSources: result.successfulSources,
    failedSources: result.failedSources,
    totalReturned: result.totalReturned,
    totalQueued: result.totalQueued,
    totalDuplicates: result.totalDuplicates,
    totalInvalid: result.totalInvalid,
    totalErrors: result.totalErrors,
    perSource: result.sourceResults
  };
}

function createMockProviders(): MockSocialProvider[] {
  return [
    new MockSocialProvider({ id: "mock_instagram", platform: "instagram" }),
    new MockSocialProvider({ id: "mock_x", platform: "x" }),
    new MockSocialProvider({ id: "mock_web", platform: "web" })
  ];
}

function createIngestGateAdapter(env: Env): PollIngestGate {
  const ingestGate = new IngestGateService(env.DB);
  return {
    async processNormalizedPost(input) {
      const result = await ingestGate.process(input);
      return { outcome: result.outcome };
    }
  };
}

function normalizeSources(inputSources: Partial<Source>[] | undefined): Source[] {
  const sources = inputSources && inputSources.length > 0 ? inputSources : defaultMockSources();
  return sources.map((source, index) => {
    const platform = normalizePlatform(source.platform, index);
    const sourceType = normalizeSourceType(source.sourceType, platform);
    const id = source.id ?? `source_${platform}_${index + 1}`;
    const value = source.value ?? defaultSourceValue(platform, sourceType);

    return {
      id,
      platform,
      sourceType,
      value,
      providerPriority: source.providerPriority ?? [`mock_${platform === "x" ? "x" : platform}`],
      status: source.status ?? "active",
      watermark: source.watermark ?? {},
      settings: source.settings ?? {},
      createdAt: source.createdAt ?? new Date(0).toISOString(),
      updatedAt: source.updatedAt ?? new Date(0).toISOString()
    };
  });
}

function defaultMockSources(): Partial<Source>[] {
  return [
    {
      id: "source_instagram_demo",
      platform: "instagram",
      sourceType: "profile",
      value: "demo_profile",
      providerPriority: ["mock_instagram"]
    },
    {
      id: "source_x_demo",
      platform: "x",
      sourceType: "hashtag",
      value: "ai",
      providerPriority: ["mock_x"]
    },
    {
      id: "source_web_demo",
      platform: "web",
      sourceType: "web_url",
      value: "https://source.local/demo",
      providerPriority: ["mock_web"]
    }
  ];
}

function normalizePlatform(value: Source["platform"] | undefined, index: number): Platform {
  if (value === "instagram" || value === "x" || value === "web" || value === "manual") {
    return value;
  }

  return index === 1 ? "x" : index === 2 ? "web" : "instagram";
}

function normalizeSourceType(value: Source["sourceType"] | undefined, platform: Platform): SourceType {
  if (value === "profile" || value === "hashtag" || value === "query" || value === "direct_url" || value === "web_url" || value === "manual") {
    return value;
  }

  return platform === "web" ? "web_url" : "profile";
}

function defaultSourceValue(platform: Platform, sourceType: SourceType): string {
  if (platform === "web" || sourceType === "web_url" || sourceType === "direct_url") {
    return "https://source.local/demo";
  }

  return platform === "x" ? "ai" : "demo_profile";
}
