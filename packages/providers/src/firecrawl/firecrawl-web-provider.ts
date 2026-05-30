import type { Platform, Source, SourceType } from "@curator/core";
import type { ProviderAdapter, ProviderFetchOptions, ProviderFetchResponse, ProviderHealthStatus } from "../provider-adapter";
import { applyProviderLimit, assertSourceTypeSupported } from "../provider-adapter";
import { assertProviderAvailable, type ProviderAvailability } from "../provider-status";
import { ProviderError, providerError } from "../provider-errors";
import type { ProviderHttpClient } from "../http/provider-http-client";
import { mapFirecrawlResponseToPosts } from "./firecrawl-mapper";

export type FirecrawlWebProviderOptions = {
  availability: ProviderAvailability;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  httpClient?: ProviderHttpClient;
  now?: () => Date;
};

export class FirecrawlWebProvider implements ProviderAdapter {
  readonly id = "firecrawl";
  readonly name = "Firecrawl Web Provider Sandbox";
  readonly platform: Platform = "web";
  readonly supportedSourceTypes = ["web_url", "direct_url"] as const satisfies readonly SourceType[];

  private readonly availability: ProviderAvailability;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly httpClient: ProviderHttpClient | undefined;
  private readonly now: () => Date;

  constructor(options: FirecrawlWebProviderOptions) {
    this.availability = options.availability;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.firecrawl.dev/v1/scrape";
    this.timeoutMs = options.timeoutMs ?? 10_000;
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
    return this.fetchFromSandbox(url, "web_url", options);
  }

  private async fetchFromSandbox(value: string, sourceType: SourceType, options: ProviderFetchOptions): Promise<ProviderFetchResponse> {
    if (!this.httpClient) {
      throw providerError({
        category: "provider_error",
        providerId: this.id,
        message: "Firecrawl sandbox provider requires an injected ProviderHttpClient."
      });
    }

    const response = await this.httpClient.postJson<unknown>(this.baseUrl, {
      url: value,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: 0,
      timeout: this.timeoutMs,
      metadata: {
        sourceType,
        requestedLimit: options.limit ?? options.backfillLimit ?? 1
      }
    }, {
      headers: this.apiKey === undefined ? {} : { authorization: `Bearer ${this.apiKey}` },
      timeoutMs: this.timeoutMs
    });

    if (!response.ok) {
      throw new ProviderError({ ...response.error, providerId: this.id });
    }

    const mapped = mapFirecrawlResponseToPosts(response.data, this.id);
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
