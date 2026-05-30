import type { Platform, Source, SourceType } from "@curator/core";
import type { ProviderAdapter, ProviderFetchOptions, ProviderFetchResponse, ProviderHealthStatus } from "../provider-adapter";
import { assertSourceTypeSupported } from "../provider-adapter";
import { fetchMockDirectUrl, fetchMockRecentPosts, type MockProviderOptions, type MockProviderScenario } from "./mock-provider-utils";

export class MockXProvider implements ProviderAdapter {
  readonly id = "mock_x";
  readonly name = "Mock X Provider";
  readonly platform: Platform = "x";
  readonly supportedSourceTypes = ["profile", "hashtag", "query", "direct_url"] as const satisfies readonly SourceType[];

  private readonly scenario: MockProviderScenario;
  private readonly now: () => Date;

  constructor(options: MockProviderOptions = {}) {
    this.scenario = options.scenario ?? "normal";
    this.now = options.now ?? (() => new Date(0));
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    return {
      providerId: this.id,
      platform: this.platform,
      ok: this.scenario !== "failure",
      checkedAt: this.now().toISOString(),
      message: this.scenario === "failure" ? "Mock X provider is unhealthy" : "Mock X provider is healthy"
    };
  }

  async fetchRecentPosts(source: Source, options: ProviderFetchOptions = {}): Promise<ProviderFetchResponse> {
    assertSourceTypeSupported(this, source.sourceType);
    return fetchMockRecentPosts({
      provider: this,
      source,
      supportedSourceTypes: this.supportedSourceTypes,
      scenario: this.scenario,
      now: this.now,
      limit: options.limit,
      backfillLimit: options.backfillLimit
    });
  }

  async fetchByDirectUrl(url: string): Promise<ProviderFetchResponse> {
    return fetchMockDirectUrl({
      provider: this,
      url,
      sourceType: "direct_url",
      scenario: this.scenario,
      now: this.now
    });
  }
}
