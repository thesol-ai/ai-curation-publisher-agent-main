import type { NormalizedPost, ProviderId, Source } from "@curator/core";
import type { ProviderAdapter, ProviderFetchOptions } from "./provider-adapter";
import { UnsupportedSourceTypeError } from "./provider-adapter";
import { classifyProviderError, type ProviderErrorCategory } from "./provider-errors";
import { ProviderRegistry } from "./provider-registry";

export type SourceIngestionOptions = ProviderFetchOptions & {
  providerPriority?: ProviderId[];
};

export type ProviderAttempt = {
  providerId: string;
  status: "success" | "failed" | "unsupported";
  returnedCount: number;
  error?: string;
  failureCategory?: ProviderErrorCategory;
};

export type SourceIngestionResult = {
  sourceId: string;
  providerUsed?: string;
  selectedFallbackProviderId?: string;
  providerAttempts: ProviderAttempt[];
  posts: NormalizedPost[];
  returnedCount: number;
  normalizedCount: number;
  failedCount: number;
  error?: string;
};

export class SourceIngestionService {
  constructor(private readonly registry: ProviderRegistry) {}

  async ingestSource(source: Source, options: SourceIngestionOptions = {}): Promise<SourceIngestionResult> {
    const providers = this.registry.resolveProviderPriority(source, options.providerPriority);
    const providerAttempts: ProviderAttempt[] = [];

    if (providers.length === 0) {
      return {
        sourceId: source.id,
        providerAttempts,
        posts: [],
        returnedCount: 0,
        normalizedCount: 0,
        failedCount: 1,
        error: `No provider registered for platform ${source.platform}`
      };
    }

    for (const provider of providers) {
      try {
        const response = await fetchFromProvider(provider, source, options);
        providerAttempts.push({
          providerId: provider.id,
          status: "success",
          returnedCount: response.posts.length
        });

        return {
          sourceId: source.id,
          providerUsed: provider.id,
          ...(providerAttempts.length > 1 ? { selectedFallbackProviderId: provider.id } : {}),
          providerAttempts,
          posts: response.posts,
          returnedCount: response.posts.length,
          normalizedCount: response.posts.length,
          failedCount: 0
        };
      } catch (error) {
        const unsupported = error instanceof UnsupportedSourceTypeError;
        const providerError = classifyProviderError(error);
        providerAttempts.push({
          providerId: provider.id,
          status: unsupported ? "unsupported" : "failed",
          returnedCount: 0,
          error: providerError.message,
          failureCategory: unsupported ? "unsupported_source_type" : providerError.category
        });
      }
    }

    return {
      sourceId: source.id,
      providerAttempts,
      posts: [],
      returnedCount: 0,
      normalizedCount: 0,
      failedCount: providerAttempts.length,
      error: providerAttempts.at(-1)?.error ?? "No provider returned posts"
    };
  }
}

async function fetchFromProvider(provider: ProviderAdapter, source: Source, options: ProviderFetchOptions) {
  if (!provider.supportedSourceTypes.includes(source.sourceType)) {
    throw new UnsupportedSourceTypeError(provider.id, source.sourceType);
  }

  if ((source.sourceType === "direct_url" || source.sourceType === "web_url") && provider.fetchByDirectUrl) {
    return provider.fetchByDirectUrl(source.value, options);
  }

  return provider.fetchRecentPosts(source, options);
}
