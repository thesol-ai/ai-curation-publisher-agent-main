import { describe, expect, it } from "vitest";
import type { Source } from "@curator/core";
import { ApifyInstagramProvider } from "./apify/apify-instagram-provider";
import { FirecrawlWebProvider } from "./firecrawl/firecrawl-web-provider";
import { GetXapiXProvider } from "./getxapi/getxapi-x-provider";
import { MockProviderHttpClient } from "./http/mock-provider-http-client";
import { ProviderError } from "./provider-errors";
import { createProviderAvailability } from "./provider-status";

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_local",
    platform: "instagram",
    sourceType: "profile",
    value: "openai",
    providerPriority: [],
    status: "active",
    watermark: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides
  };
}

describe("real provider stubs", () => {
  it("disabled Apify provider fails safely without external calls", async () => {
    const httpClient = new MockProviderHttpClient();
    const provider = new ApifyInstagramProvider({
      availability: createProviderAvailability({
        providerId: "apify_instagram",
        platform: "instagram",
        enabled: false,
        credentialConfigured: false,
        missingCredentialName: "APIFY_TOKEN"
      }),
      httpClient
    });

    await expect(provider.fetchRecentPosts(makeSource())).rejects.toMatchObject({
      name: "ProviderUnavailableError",
      providerId: "apify_instagram",
      status: "disabled"
    });
    expect(httpClient.requests).toEqual([]);
  });

  it("missing credentials fail safely without external calls", async () => {
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
      name: "ProviderUnavailableError",
      providerId: "getxapi",
      status: "missing_credentials"
    });
    expect(httpClient.requests).toEqual([]);
  });

  it("configured sandbox provider reports health and fails safely when mock HTTP response is absent", async () => {
    const httpClient = new MockProviderHttpClient();
    const provider = new FirecrawlWebProvider({
      availability: createProviderAvailability({
        providerId: "firecrawl",
        platform: "web",
        enabled: true,
        credentialConfigured: true,
        missingCredentialName: "FIRECRAWL_API_KEY"
      }),
      httpClient
    });

    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.providerId).toBe("firecrawl");

    await expect(provider.fetchByDirectUrl("https://source.local/article")).rejects.toBeInstanceOf(ProviderError);
    await expect(provider.fetchByDirectUrl("https://source.local/article")).rejects.toMatchObject({ category: "provider_error" });
    expect(httpClient.requests).toHaveLength(2);
  });

  it("configured Firecrawl sandbox provider maps fake response to normalized posts", async () => {
    const httpClient = new MockProviderHttpClient([
      {
        method: "POST",
        url: "https://firecrawl.sandbox.local/scrape",
        response: {
          data: {
            url: "https://source.local/article",
            title: "Sandbox article",
            markdown: "Sandbox article body",
            metadata: { author: "editor" }
          }
        }
      }
    ]);
    const provider = new FirecrawlWebProvider({
      availability: createProviderAvailability({
        providerId: "firecrawl",
        platform: "web",
        enabled: true,
        credentialConfigured: true,
        missingCredentialName: "FIRECRAWL_API_KEY"
      }),
      apiKey: "in-memory-key",
      baseUrl: "https://firecrawl.sandbox.local/scrape",
      timeoutMs: 1234,
      httpClient
    });

    const response = await provider.fetchByDirectUrl("https://source.local/article", { limit: 1 });

    expect(response.posts).toHaveLength(1);
    expect(response.posts[0]).toMatchObject({
      provider: "firecrawl",
      platform: "web",
      canonicalUrl: "https://source.local/article",
      authorHandle: "editor"
    });
    expect(response.posts[0]?.text).toContain("Sandbox article");
    expect(httpClient.requests).toHaveLength(1);
    expect(httpClient.requests[0]).toMatchObject({
      method: "POST",
      url: "https://firecrawl.sandbox.local/scrape",
      options: {
        headers: { authorization: "Bearer in-memory-key" },
        timeoutMs: 1234
      }
    });
  });

  it("unsupported Firecrawl source type returns a typed error before HTTP", async () => {
    const httpClient = new MockProviderHttpClient();
    const provider = new FirecrawlWebProvider({
      availability: createProviderAvailability({
        providerId: "firecrawl",
        platform: "web",
        enabled: true,
        credentialConfigured: true,
        missingCredentialName: "FIRECRAWL_API_KEY"
      }),
      httpClient
    });

    await expect(provider.fetchRecentPosts(makeSource({ platform: "web", sourceType: "profile" }))).rejects.toMatchObject({
      name: "UnsupportedSourceTypeError"
    });
    expect(httpClient.requests).toEqual([]);
  });
});
