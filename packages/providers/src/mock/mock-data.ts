import type { NormalizedPost, Platform, SourceType } from "@curator/core";

export type CreateMockPostInput = { platform?: Platform; sourceType?: SourceType; provider?: string; sourcePostId?: string; canonicalUrl?: string; text?: string };

export function createMockNormalizedPost(input: CreateMockPostInput = {}): NormalizedPost {
  const platform = input.platform ?? "manual";
  const sourceType = input.sourceType ?? "manual";
  const sourcePostId = input.sourcePostId ?? "mock-post-001";
  return {
    provider: input.provider ?? "mock_social_provider",
    platform,
    sourceType,
    sourcePostId,
    canonicalUrl: input.canonicalUrl ?? `https://example.com/${platform}/${sourcePostId}`,
    publishedAt: "2025-01-01T00:00:00.000Z",
    authorHandle: "mock_author",
    text: input.text ?? "Mock provider post used for Phase 1 scaffold tests.",
    links: ["https://example.com/source"],
    media: [{ kind: "image", sourceUrl: "https://example.com/media/mock-image.jpg", canonicalUrl: "https://example.com/media/mock-image.jpg", mimeType: "image/jpeg", width: 1200, height: 630, altText: "Mock image" }],
    rawPayload: { mocked: true, sourcePostId }
  };
}
