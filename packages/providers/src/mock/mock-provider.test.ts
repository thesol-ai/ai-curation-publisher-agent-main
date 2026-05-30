import { describe, expect, it } from "vitest";
import type { Source } from "@curator/core";
import { MockSocialProvider } from "./mock-provider";

describe("MockSocialProvider", () => {
  const source: Source = {
    id: "source_001",
    platform: "instagram",
    sourceType: "profile",
    providerPriority: ["mock_social_provider"],
    value: "example_profile",
    status: "active",
    watermark: {},
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z"
  };

  it("returns normalized posts without calling a real provider", async () => {
    const provider = new MockSocialProvider({ now: () => new Date("2025-01-01T00:00:00.000Z") });
    const result = await provider.fetchSource({ source, limit: 10 });
    expect(result.provider).toBe("mock_social_provider");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.platform).toBe("instagram");
    expect(result.items[0]?.canonicalUrl).toContain("example_profile");
    expect(result.items[0]?.rawPayload).toMatchObject({ mocked: true });
  });

  it("reports healthy status", async () => {
    const provider = new MockSocialProvider();
    await expect(provider.healthCheck()).resolves.toMatchObject({ ok: true });
  });
});
