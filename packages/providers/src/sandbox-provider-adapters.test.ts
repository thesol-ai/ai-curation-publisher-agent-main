import { describe, expect, it } from "vitest";
import type { Source } from "@curator/core";
import { ApifyInstagramProvider } from "./apify/apify-instagram-provider";
import { FirecrawlWebProvider } from "./firecrawl/firecrawl-web-provider";
import { GetXapiXProvider } from "./getxapi/getxapi-x-provider";
import { MockProviderHttpClient } from "./http/mock-provider-http-client";
import { createProviderAvailability } from "./provider-status";

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_local",
    platform: "instagram",
    sourceType: "profile",
    value: "demo",
    providerPriority: [],
    status: "active",
    watermark: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides
  };
}

function enabledAvailability(providerId: string, platform: "instagram" | "x" | "web") {
  return createProviderAvailability({
    providerId,
    platform,
    enabled: true,
    credentialConfigured: true
  });
}

describe("sandbox provider adapters", () => {
  it("enabled Apify provider with mock HTTP client returns normalized posts", async () => {
    const httpClient = new MockProviderHttpClient([
      {
        method: "POST",
        url: "https://sandbox.local/apify",
        response: {
          items: [
            {
              id: "ig_1",
              url: "https://instagram.com/p/abc",
              caption: "caption"
            }
          ]
        }
      }
    ]);
    const provider = new ApifyInstagramProvider({
      availability: enabledAvailability("apify_instagram", "instagram"),
      apiKey: "in-memory-key",
      baseUrl: "https://sandbox.local/apify",
      httpClient
    });

    const result = await provider.fetchRecentPosts(makeSource(), { limit: 1 });

    expect(result.providerId).toBe("apify_instagram");
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.canonicalUrl).toBe("https://instagram.com/p/abc");
    expect(httpClient.requests).toHaveLength(1);
    expect(httpClient.requests[0]?.options?.headers?.authorization).toBe("Bearer in-memory-key");
  });

  it("enabled GetXAPI provider with mock HTTP client returns normalized posts", async () => {
    const httpClient = new MockProviderHttpClient([
      {
        method: "POST",
        url: "https://sandbox.local/getxapi",
        response: {
          tweets: [
            {
              id: "tweet_1",
              text: "tweet body"
            }
          ]
        }
      }
    ]);
    const provider = new GetXapiXProvider({
      availability: enabledAvailability("getxapi", "x"),
      apiKey: "in-memory-key",
      baseUrl: "https://sandbox.local/getxapi",
      httpClient
    });

    const result = await provider.fetchRecentPosts(makeSource({ platform: "x", sourceType: "query" }), { limit: 1 });

    expect(result.providerId).toBe("getxapi");
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.canonicalUrl).toBe("https://x.com/i/web/status/tweet_1");
    expect(httpClient.requests).toHaveLength(1);
  });

  it("enabled Firecrawl provider with mock HTTP client returns normalized posts", async () => {
    const httpClient = new MockProviderHttpClient([
      {
        method: "POST",
        url: "https://sandbox.local/firecrawl",
        response: {
          data: {
            url: "https://source.local/article",
            title: "Article",
            markdown: "Body"
          }
        }
      }
    ]);
    const provider = new FirecrawlWebProvider({
      availability: enabledAvailability("firecrawl", "web"),
      apiKey: "in-memory-key",
      baseUrl: "https://sandbox.local/firecrawl",
      httpClient
    });

    const result = await provider.fetchByDirectUrl("https://source.local/article", { limit: 1 });

    expect(result.providerId).toBe("firecrawl");
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.canonicalUrl).toBe("https://source.local/article");
    expect(httpClient.requests).toHaveLength(1);
  });

  it("disabled providers fail safely without HTTP calls", async () => {
    const httpClient = new MockProviderHttpClient();
    const provider = new ApifyInstagramProvider({
      availability: createProviderAvailability({
        providerId: "apify_instagram",
        platform: "instagram",
        enabled: false,
        credentialConfigured: false
      }),
      httpClient
    });

    await expect(provider.fetchRecentPosts(makeSource())).rejects.toMatchObject({
      status: "disabled"
    });
    expect(httpClient.requests).toEqual([]);
  });

  it("missing credentials fail safely without HTTP calls", async () => {
    const httpClient = new MockProviderHttpClient();
    const provider = new GetXapiXProvider({
      availability: createProviderAvailability({
        providerId: "getxapi",
        platform: "x",
        enabled: true,
        credentialConfigured: false,
        missingCredentialName: "GETXAPI_KEY"
      }),
      httpClient
    });

    await expect(provider.fetchRecentPosts(makeSource({ platform: "x", sourceType: "query" }))).rejects.toMatchObject({
      status: "missing_credentials"
    });
    expect(httpClient.requests).toEqual([]);
  });
});
