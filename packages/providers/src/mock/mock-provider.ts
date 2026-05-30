import type { FetchSourceInput, Platform, ProviderCapabilities, ProviderFetchResult, ProviderHealthResult, SocialProvider } from "@curator/core";
import { createMockNormalizedPost } from "./mock-data";

export type MockSocialProviderOptions = { id?: string; platform?: Platform; now?: () => Date };

export class MockSocialProvider implements SocialProvider {
  readonly id: string;
  readonly platform: Platform;
  readonly capabilities: ProviderCapabilities = { supportsProfiles: true, supportsHashtags: true, supportsQueries: true, supportsDirectUrls: true, supportsWebUrls: true, supportsMediaMetadata: true };
  private readonly now: () => Date;

  constructor(options: MockSocialProviderOptions = {}) {
    this.id = options.id ?? "mock_social_provider";
    this.platform = options.platform ?? "manual";
    this.now = options.now ?? (() => new Date());
  }

  async fetchSource(input: FetchSourceInput): Promise<ProviderFetchResult> {
    const fetchedAt = this.now().toISOString();
    const post = createMockNormalizedPost({ provider: this.id, platform: input.source.platform, sourceType: input.source.sourceType, sourcePostId: `${input.source.id}-mock-001`, canonicalUrl: `https://example.com/${input.source.platform}/${encodeURIComponent(input.source.value)}/mock-001` });
    return { provider: this.id, items: [post].slice(0, input.limit), nextCursor: "mock-cursor-001", fetchedAt };
  }

  async fetchDirectUrl(url: string): Promise<ProviderFetchResult> {
    return { provider: this.id, items: [createMockNormalizedPost({ provider: this.id, platform: this.platform, sourceType: "direct_url", sourcePostId: "mock-direct-url-001", canonicalUrl: url })], fetchedAt: this.now().toISOString() };
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    return { provider: this.id, ok: true, checkedAt: this.now().toISOString(), message: "Mock provider is healthy" };
  }
}
