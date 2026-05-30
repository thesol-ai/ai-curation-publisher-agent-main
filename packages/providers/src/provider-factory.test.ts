import { describe, expect, it } from "vitest";
import { MockProviderHttpClient } from "./http/mock-provider-http-client";
import { createProvidersFromConfig } from "./provider-factory";

describe("createProvidersFromConfig", () => {
  it("returns mock providers by default", () => {
    const result = createProvidersFromConfig();

    expect(result.summary.providersMode).toBe("mock");
    expect(result.providers.map((provider) => provider.id)).toEqual(["mock_instagram", "mock_x", "mock_web"]);
  });

  it("keeps disabled real providers out of polling provider list", () => {
    const result = createProvidersFromConfig({
      env: {
        PROVIDERS_MODE: "mixed"
      }
    });

    expect(result.providers.map((provider) => provider.id)).toEqual(["mock_instagram", "mock_x", "mock_web"]);
    expect(result.summary.disabledProviderIds).toEqual(["apify_instagram", "getxapi", "firecrawl"]);
  });

  it("mixed mode includes mock providers and enabled stubs", () => {
    const result = createProvidersFromConfig({
      env: {
        PROVIDERS_MODE: "mixed",
        ENABLE_APIFY_PROVIDER: "true",
        APIFY_TOKEN: "in-memory-token"
      },
      httpClient: new MockProviderHttpClient()
    });

    expect(result.providers.map((provider) => provider.id)).toEqual([
      "mock_instagram",
      "mock_x",
      "mock_web",
      "apify_instagram"
    ]);
    expect(result.summary.enabledProviderIds).toEqual(["apify_instagram"]);
  });

  it("real mode does not crash when credentials are missing", () => {
    const result = createProvidersFromConfig({
      env: {
        PROVIDERS_MODE: "real",
        ENABLE_APIFY_PROVIDER: "true",
        ENABLE_GETXAPI_PROVIDER: "true"
      }
    });

    expect(result.providers).toHaveLength(2);
    expect(result.summary.missingCredentialProviderIds).toEqual(["apify_instagram", "getxapi"]);
  });
});
