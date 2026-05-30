import type { NormalizedPost, Platform, Source, SourceType } from "@curator/core";

export type ProviderAdapterId = string;

export type ProviderFetchOptions = {
  limit?: number;
  backfillLimit?: number;
  since?: string;
  maxPages?: number;
  cursor?: string;
};

export type ProviderHealthStatus = {
  providerId: ProviderAdapterId;
  platform: Platform;
  ok: boolean;
  checkedAt: string;
  message?: string;
};

export type ProviderFetchResponse = {
  providerId: ProviderAdapterId;
  platform: Platform;
  sourceType: SourceType;
  posts: NormalizedPost[];
  fetchedAt: string;
  nextCursor?: string;
};

export interface ProviderAdapter {
  readonly id: ProviderAdapterId;
  readonly name: string;
  readonly platform: Platform;
  readonly supportedSourceTypes: readonly SourceType[];

  healthCheck(): Promise<ProviderHealthStatus>;
  fetchRecentPosts(source: Source, options?: ProviderFetchOptions): Promise<ProviderFetchResponse>;
  fetchByDirectUrl?(url: string, options?: ProviderFetchOptions): Promise<ProviderFetchResponse>;
}

export class UnsupportedSourceTypeError extends Error {
  constructor(providerId: string, sourceType: SourceType) {
    super(`Provider ${providerId} does not support source type ${sourceType}`);
    this.name = "UnsupportedSourceTypeError";
  }
}

export function assertSourceTypeSupported(provider: ProviderAdapter, sourceType: SourceType): void {
  if (!provider.supportedSourceTypes.includes(sourceType)) {
    throw new UnsupportedSourceTypeError(provider.id, sourceType);
  }
}

export function applyProviderLimit<T>(items: T[], options: ProviderFetchOptions = {}): T[] {
  const limit = options.limit ?? options.backfillLimit;
  if (limit === undefined) {
    return items;
  }

  return items.slice(0, Math.max(0, limit));
}
