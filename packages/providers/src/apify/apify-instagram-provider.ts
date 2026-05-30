import type { Platform, Source, SourceType } from "@curator/core";
import type { ProviderAdapter, ProviderFetchOptions, ProviderFetchResponse, ProviderHealthStatus } from "../provider-adapter";
import { applyProviderLimit, assertSourceTypeSupported } from "../provider-adapter";
import { assertProviderAvailable, type ProviderAvailability } from "../provider-status";
import { ProviderError, providerError } from "../provider-errors";
import type { ProviderHttpClient } from "../http/provider-http-client";
import { mapApifyInstagramResponseToPosts } from "./apify-mapper";

export type ApifyInstagramProviderOptions = {
  availability: ProviderAvailability;
  apiKey?: string;
  baseUrl?: string;
  httpClient?: ProviderHttpClient;
  now?: () => Date;
};

export class ApifyInstagramProvider implements ProviderAdapter {
  readonly id = "apify_instagram";
  readonly name = "Apify Instagram Provider Sandbox";
  readonly platform: Platform = "instagram";
  readonly supportedSourceTypes = ["profile", "hashtag", "direct_url"] as const satisfies readonly SourceType[];

  private readonly availability: ProviderAvailability;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly httpClient: ProviderHttpClient | undefined;
  private readonly now: () => Date;

  constructor(options: ApifyInstagramProviderOptions) {
    this.availability = options.availability;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.apify.local/instagram";
    this.httpClient = options.httpClient;
    this.now = options.now ?? (() => new Date(0));
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    return {
      providerId: this.id,
      platform: this.platform,
      ok: this.availability.enabled,
      checkedAt: this.now().toISOString(),
      message: this.availability.message
    };
  }

  async fetchRecentPosts(source: Source, options: ProviderFetchOptions = {}): Promise<ProviderFetchResponse> {
    assertSourceTypeSupported(this, source.sourceType);
    assertProviderAvailable(this.availability);
    return this.fetchFromSandbox(source.value, source.sourceType, options);
  }

  async fetchByDirectUrl(url: string, options: ProviderFetchOptions = {}): Promise<ProviderFetchResponse> {
    assertProviderAvailable(this.availability);
    return this.fetchFromSandbox(url, "direct_url", options);
  }

  private async fetchFromSandbox(value: string, sourceType: SourceType, options: ProviderFetchOptions): Promise<ProviderFetchResponse> {
    if (!this.httpClient) {
      throw providerError({
        category: "provider_error",
        providerId: this.id,
        message: "Apify Instagram sandbox provider requires an injected ProviderHttpClient."
      });
    }

    const response = await this.httpClient.postJson<unknown>(this.baseUrl, {
      sourceType,
      value,
      limit: options.limit ?? options.backfillLimit ?? 10,
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.since === undefined ? {} : { since: options.since })
    }, {
      headers: this.apiKey === undefined ? {} : { authorization: `Bearer ${this.apiKey}` },
      timeoutMs: 10_000
    });

    if (!response.ok) {
      throw new ProviderError({ ...response.error, providerId: this.id });
    }

    const mapped = mapApifyInstagramResponseToPosts(response.data, this.id);
    if (mapped.errors.length > 0) {
      throw providerError({
        category: "invalid_response",
        providerId: this.id,
        message: mapped.errors.join("; ")
      });
    }

    return {
      providerId: this.id,
      platform: this.platform,
      sourceType,
      posts: applyProviderLimit(mapped.posts, options),
      fetchedAt: this.now().toISOString()
    };
  }
}
