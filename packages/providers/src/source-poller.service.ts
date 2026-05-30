import type { FetchSourceInput, NormalizedPost, ProviderFetchResult, Source, SocialProvider } from "@curator/core";

export type PollingOptions = {
  limit?: number;
  backfillLimit?: number;
  since?: string;
  cursor?: string;
  providerPriority?: string[];
};

export type ProviderPollAttempt = {
  providerId: string;
  status: "success" | "failed" | "unsupported";
  returnedCount: number;
  error?: string;
};

export type PollIngestGateResult = {
  outcome: "queued" | "duplicate" | "invalid" | "failed";
};

export interface PollIngestGate {
  processNormalizedPost(input: { sourceId: string; post: NormalizedPost }): Promise<PollIngestGateResult>;
}

export type SourcePollResult = {
  sourceId: string;
  platform: Source["platform"];
  sourceType: Source["sourceType"];
  providerUsed?: string;
  providerAttempts: ProviderPollAttempt[];
  returnedCount: number;
  normalizedCount: number;
  queuedCount: number;
  duplicateCount: number;
  invalidCount: number;
  failedCount: number;
  errors: string[];
  startedAt: string;
  finishedAt: string;
  posts: NormalizedPost[];
  sourceState: {
    lastSuccessfulPollAt?: string;
    lastError?: string;
    lastProviderUsed?: string;
    lastSeenAt?: string;
    providerCursor?: string;
  };
};

export type SourcePollerOptions = {
  providers: SocialProvider[];
  ingestGate?: PollIngestGate;
  now?: () => Date;
};

export class SourcePollerService {
  private readonly providers: SocialProvider[];
  private readonly ingestGate: PollIngestGate | undefined;
  private readonly now: () => Date;

  constructor(options: SourcePollerOptions) {
    this.providers = options.providers;
    this.ingestGate = options.ingestGate;
    this.now = options.now ?? (() => new Date());
  }

  async pollSource(source: Source, options: PollingOptions = {}): Promise<SourcePollResult> {
    const startedAt = this.now().toISOString();
    const attempts: ProviderPollAttempt[] = [];
    const errors: string[] = [];
    const providers = this.resolveProviders(source, options.providerPriority);

    if (providers.length === 0) {
      const error = `No provider available for ${source.platform}`;
      return this.emptyResult(source, startedAt, [error], attempts, "failed");
    }

    for (const provider of providers) {
      if (!supportsSource(provider, source)) {
        const error = `Provider ${provider.id} does not support ${source.sourceType}`;
        attempts.push({ providerId: provider.id, status: "unsupported", returnedCount: 0, error });
        errors.push(error);
        continue;
      }

      try {
        const fetchResult = await fetchFromProvider(provider, source, {
          limit: options.limit ?? options.backfillLimit ?? 10,
          ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
          ...(options.since === undefined ? {} : { since: options.since })
        });

        attempts.push({ providerId: provider.id, status: "success", returnedCount: fetchResult.items.length });
        const ingestCounts = await this.ingestPosts(source, fetchResult.items);
        const finishedAt = this.now().toISOString();

        return {
          sourceId: source.id,
          platform: source.platform,
          sourceType: source.sourceType,
          providerUsed: provider.id,
          providerAttempts: attempts,
          returnedCount: fetchResult.items.length,
          normalizedCount: fetchResult.items.length,
          queuedCount: ingestCounts.queuedCount,
          duplicateCount: ingestCounts.duplicateCount,
          invalidCount: ingestCounts.invalidCount,
          failedCount: ingestCounts.failedCount,
          errors,
          startedAt,
          finishedAt,
          posts: fetchResult.items,
          sourceState: {
            lastSuccessfulPollAt: finishedAt,
            lastProviderUsed: provider.id,
            lastSeenAt: fetchResult.items[0]?.publishedAt ?? finishedAt,
            ...(fetchResult.nextCursor === undefined ? {} : { providerCursor: fetchResult.nextCursor })
          }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown provider polling failure";
        attempts.push({ providerId: provider.id, status: "failed", returnedCount: 0, error: message });
        errors.push(message);
      }
    }

    return this.emptyResult(source, startedAt, errors, attempts, "failed");
  }

  private resolveProviders(source: Source, override?: string[]): SocialProvider[] {
    const priority = override ?? source.providerPriority;
    if (priority.length > 0) {
      return priority
        .map((providerId) => this.providers.find((provider) => provider.id === providerId))
        .filter((provider): provider is SocialProvider => provider !== undefined)
        .filter((provider) => provider.platform === source.platform || provider.platform === "manual");
    }

    return this.providers.filter((provider) => provider.platform === source.platform || provider.platform === "manual");
  }

  private async ingestPosts(source: Source, posts: NormalizedPost[]): Promise<{
    queuedCount: number;
    duplicateCount: number;
    invalidCount: number;
    failedCount: number;
  }> {
    if (!this.ingestGate) {
      return {
        queuedCount: 0,
        duplicateCount: 0,
        invalidCount: 0,
        failedCount: 0
      };
    }

    const counts = {
      queuedCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      failedCount: 0
    };

    for (const post of posts) {
      try {
        const result = await this.ingestGate.processNormalizedPost({ sourceId: source.id, post });
        if (result.outcome === "queued") {
          counts.queuedCount += 1;
        } else if (result.outcome === "duplicate") {
          counts.duplicateCount += 1;
        } else if (result.outcome === "invalid") {
          counts.invalidCount += 1;
        } else {
          counts.failedCount += 1;
        }
      } catch {
        counts.failedCount += 1;
      }
    }

    return counts;
  }

  private emptyResult(
    source: Source,
    startedAt: string,
    errors: string[],
    attempts: ProviderPollAttempt[],
    state: "failed"
  ): SourcePollResult {
    const finishedAt = this.now().toISOString();
    return {
      sourceId: source.id,
      platform: source.platform,
      sourceType: source.sourceType,
      providerAttempts: attempts,
      returnedCount: 0,
      normalizedCount: 0,
      queuedCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      failedCount: 1,
      errors,
      startedAt,
      finishedAt,
      posts: [],
      sourceState: {
        lastError: errors.at(-1) ?? state
      }
    };
  }
}

function supportsSource(provider: SocialProvider, source: Source): boolean {
  if (source.sourceType === "profile") {
    return provider.capabilities.supportsProfiles;
  }

  if (source.sourceType === "hashtag") {
    return provider.capabilities.supportsHashtags;
  }

  if (source.sourceType === "query") {
    return provider.capabilities.supportsQueries;
  }

  if (source.sourceType === "direct_url") {
    return provider.capabilities.supportsDirectUrls;
  }

  if (source.sourceType === "web_url") {
    return provider.capabilities.supportsWebUrls;
  }

  return false;
}

async function fetchFromProvider(provider: SocialProvider, source: Source, input: Omit<FetchSourceInput, "source">): Promise<ProviderFetchResult> {
  if ((source.sourceType === "direct_url" || source.sourceType === "web_url") && provider.fetchDirectUrl) {
    return provider.fetchDirectUrl(source.value);
  }

  return provider.fetchSource({ source, ...input });
}
