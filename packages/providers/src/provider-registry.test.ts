import { describe, expect, it } from "vitest";
import type { Source } from "@curator/core";
import { MockInstagramProvider } from "./mock/mock-instagram-provider";
import { MockWebProvider } from "./mock/mock-web-provider";
import { MockXProvider } from "./mock/mock-x-provider";
import { createDefaultMockProviderPriority, ProviderRegistry } from "./provider-registry";

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

describe("ProviderRegistry", () => {
  it("resolves providers by source priority", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockInstagramProvider());
    registry.register(new MockXProvider());

    const providers = registry.resolveProviderPriority(makeSource({ providerPriority: ["mock_instagram"] }));

    expect(providers.map((provider) => provider.id)).toEqual(["mock_instagram"]);
  });

  it("uses default mock priority by platform", () => {
    const registry = new ProviderRegistry({ defaultPriority: createDefaultMockProviderPriority() });
    registry.register(new MockInstagramProvider());
    registry.register(new MockXProvider());
    registry.register(new MockWebProvider());

    expect(registry.resolveProviderPriority(makeSource()).map((provider) => provider.id)).toEqual(["mock_instagram"]);
    expect(registry.resolveProviderPriority(makeSource({ platform: "x", sourceType: "query" })).map((provider) => provider.id)).toEqual(["mock_x"]);
    expect(registry.resolveProviderPriority(makeSource({ platform: "web", sourceType: "web_url" })).map((provider) => provider.id)).toEqual(["mock_web"]);
  });

  it("returns health status for all providers", async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockInstagramProvider());
    registry.register(new MockXProvider({ scenario: "failure" }));

    const health = await registry.healthCheckAll();

    expect(health).toHaveLength(2);
    expect(health.find((entry) => entry.providerId === "mock_instagram")?.ok).toBe(true);
    expect(health.find((entry) => entry.providerId === "mock_x")?.ok).toBe(false);
  });
});
